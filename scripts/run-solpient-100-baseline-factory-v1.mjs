import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import {
  closePostgresPool,
  postgresConfigured,
} from "../lib/postgres-node.mjs";
import {
  deriveSolpient100BaselinePlan,
  selectSolpient100BaselineWork,
  summarizeSolpient100BaselineStates,
  SOLPIENT_100_BASELINE_FACTORY_VERSION,
} from "../lib/solpient-100-baseline-factory-v1.mjs";
import { loadLatestSolpient100BaselineStates } from "../lib/solpient-100-baseline-factory-pg.mjs";

function arg(name, fallback = null) {
  const prefix = "--" + name + "=";
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function runNode(script, args = [], extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", (error) =>
      resolve({
        ok: false,
        script,
        error: error instanceof Error ? error.message : String(error),
        stdout,
        stderr,
      }),
    );
    child.on("close", (code) =>
      resolve({
        ok: code === 0,
        script,
        code,
        stdout,
        stderr,
        summary: (stdout + "\n" + stderr)
          .trim()
          .split("\n")
          .slice(-16)
          .join("\n"),
      }),
    );
  });
}

async function required(label, script, args = [], env = {}) {
  console.log("\n=== Solpient 100 Baseline Factory · " + label + " ===");
  const result = await runNode(script, args, env);
  if (!result.ok) {
    throw new Error(
      label +
        " failed: " +
        (result.summary || result.error || "exit " + String(result.code)),
    );
  }
  return result;
}

async function optional(label, script, args = [], env = {}) {
  console.log("\n=== Solpient 100 Baseline Factory · " + label + " ===");
  const result = await runNode(script, args, env);
  return {
    label,
    ok: result.ok,
    code: result.code ?? null,
    summary: result.ok ? null : result.summary ?? result.error ?? null,
  };
}

async function atomicWriteJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + ".tmp-" + process.pid;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(temp, file);
}

function stepCommand(step, { ticker, factoryRunId }) {
  const env = {
    COVERAGE_TICKER: ticker,
    RESEARCH_FACTORY_TICKER: ticker,
    RESEARCH_FACTORY_RUN_ID: factoryRunId ?? "",
  };

  switch (step) {
    case "assign_industry":
      return {
        label: ticker + " · assign industry module",
        script: "scripts/assign-research-factory-industry-v2-1.mjs",
        args: [
          "--factory-run-id=" + factoryRunId,
          "--ticker=" + ticker,
        ],
        env,
      };
    case "sync_sec_fundamentals":
      return {
        label: ticker + " · SEC fundamentals",
        script: "scripts/sync-sec-companyfacts-backfill.mjs",
        args: [],
        env,
      };
    case "sync_yahoo_fundamentals":
      return {
        label: ticker + " · Yahoo fundamentals fallback",
        script: "scripts/sync-yahoo-fundamentals-fallback.mjs",
        args: [],
        env,
      };
    case "sync_market_history":
      return {
        label: ticker + " · market history",
        script: "scripts/sync-market-history.mjs",
        args: [],
        env,
      };
    case "build_historical_peer_context":
      return {
        label: ticker + " · historical and peer context",
        script: "scripts/build-historical-peer-context.mjs",
        args: [],
        env,
      };
    case "build_baseline_draft":
      return {
        label: ticker + " · baseline evidence draft",
        script: "scripts/build-baseline-draft.mjs",
        args: [ticker],
        env,
      };
    case "build_coverage":
      return {
        label: ticker + " · Coverage V2",
        script: "scripts/build-data-coverage.mjs",
        args: [],
        env,
      };
    case "build_valuation_evidence":
      return {
        label: ticker + " · valuation evidence",
        script: "scripts/build-research-factory-valuation-drafts.mjs",
        args: [
          "--factory-run-id=" + factoryRunId,
          "--ticker=" + ticker,
        ],
        env,
      };
    default:
      return null;
  }
}

const dryRun = process.argv.includes("--dry-run");
const all = process.argv.includes("--all");
const tickerArg = arg("ticker", null);
const maxArg = Number(arg("max", all ? "100" : "5"));
const maxItems = Math.max(
  1,
  Math.min(100, Number.isFinite(maxArg) ? Math.floor(maxArg) : 5),
);

if (!postgresConfigured()) {
  throw new Error("SOLPIENT_DATABASE_URL is not configured.");
}

try {
  if (!dryRun) {
    await required(
      "materialize canonical Research Factory",
      "scripts/materialize-research-factory-v1.mjs",
    );
    await required(
      "resolve canonical company identities",
      "scripts/onboard-research-factory-v1.mjs",
    );
  }

  let loaded = await loadLatestSolpient100BaselineStates();
  const beforeSummary = summarizeSolpient100BaselineStates(loaded.states);
  const selected = selectSolpient100BaselineWork(loaded.states, {
    ticker: tickerArg,
    maxItems,
  });

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          factory_version: SOLPIENT_100_BASELINE_FACTORY_VERSION,
          mode: "dry_run",
          source_candidate_pipeline_run_id: loaded.candidateRun.id,
          research_factory_run_id: loaded.factoryRun?.id ?? null,
          before: beforeSummary,
          selected: selected.map(({ state, plan, priority }) => ({
            ticker: state.ticker,
            ordinal: state.ordinal,
            priority,
            plan,
          })),
          auto_publish: false,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  if (!loaded.factoryRun?.id) {
    throw new Error(
      "Research Factory V1 is unavailable after materialization.",
    );
  }

  if (!selected.length) {
    console.log(
      JSON.stringify(
        {
          factory_version: SOLPIENT_100_BASELINE_FACTORY_VERSION,
          status: "noop",
          before: beforeSummary,
          message:
            "No incomplete Solpient 100 baseline items are currently eligible for autonomous work.",
          auto_publish: false,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  const factoryRunId = loaded.factoryRun.id;
  const tickerResults = [];
  const reviewTickers = [];

  for (const selection of selected) {
    const ticker = String(selection.state.ticker).toUpperCase();
    const attempted = new Set();
    const steps = [];

    console.log(
      "\n######## " +
        ticker +
        " · Solpient 100 baseline completion ########",
    );

    for (let iteration = 0; iteration < 12; iteration += 1) {
      const currentLoaded = await loadLatestSolpient100BaselineStates({
        ticker,
      });
      const current = currentLoaded.states[0];
      if (!current) {
        steps.push({
          label: ticker + " · state reload",
          ok: false,
          summary: "Ticker disappeared from the governed Solpient 100 snapshot.",
        });
        break;
      }

      const plan = deriveSolpient100BaselinePlan(current);
      if (plan.status === "published" || plan.complete) break;

      const nextStep = plan.steps.find(
        (step) =>
          step !== "compose_and_persist_baseline" &&
          step !== "onboard_identity" &&
          !attempted.has(step),
      );
      if (!nextStep) break;

      attempted.add(nextStep);
      const command = stepCommand(nextStep, {
        ticker,
        factoryRunId,
      });
      if (!command) continue;

      const result = await optional(
        command.label,
        command.script,
        command.args,
        command.env,
      );
      steps.push({
        step: nextStep,
        ...result,
      });
    }

    const afterPrepLoaded = await loadLatestSolpient100BaselineStates({
      ticker,
    });
    const afterPrep = afterPrepLoaded.states[0] ?? selection.state;
    const afterPlan = deriveSolpient100BaselinePlan(afterPrep);

    if (
      afterPlan.needs_composition ||
      !afterPrep.composition_id ||
      afterPrep.composition_valid !== true ||
      !afterPrep.review_id
    ) {
      reviewTickers.push(ticker);
    }

    tickerResults.push({
      ticker,
      ordinal: afterPrep.ordinal,
      steps,
      pre_compose_plan: afterPlan,
    });
  }

  const reviewPackageResults = [];

  for (const ticker of reviewTickers) {
    const composed = await optional(
      ticker + " · compose private Research Standard V2 package",
      "scripts/compose-research-drafts.mjs",
      ["--ticker=" + ticker],
      { COVERAGE_TICKER: ticker },
    );
    reviewPackageResults.push({
      ticker,
      step: "compose_review_package",
      ...composed,
    });
    if (!composed.ok) continue;

    const prepared = await optional(
      ticker + " · stage package in /review",
      "scripts/prepare-generated-review-package-v1.mjs",
      ["--ticker=" + ticker],
      { COVERAGE_TICKER: ticker },
    );
    reviewPackageResults.push({
      ticker,
      step: "prepare_review_package",
      ...prepared,
    });
  }

  await optional(
    "refresh canonical Research Factory state",
    "scripts/refresh-research-factory-v1.mjs",
    ["--factory-run-id=" + factoryRunId],
    {
      RESEARCH_FACTORY_RUN_ID: factoryRunId,
    },
  );

  loaded = await loadLatestSolpient100BaselineStates();
  const afterSummary = summarizeSolpient100BaselineStates(loaded.states);
  const selectedAfter = new Map(
    loaded.states
      .filter((state) =>
        tickerResults.some((result) => result.ticker === state.ticker),
      )
      .map((state) => [state.ticker, state]),
  );

  const finalResults = tickerResults.map((result) => {
    const state = selectedAfter.get(result.ticker) ?? null;
    const plan = state
      ? deriveSolpient100BaselinePlan(state)
      : result.pre_compose_plan;
    const covered =
      Boolean(state?.published_research_run_id) ||
      Boolean(
        state?.composition_id &&
        state?.composition_valid &&
        state?.review_id
      );
    return {
      ...result,
      final: state
        ? {
            industry_module: state.industry_module,
            fundamental_rows: state.fundamental_rows,
            sec_fundamental_rows: state.sec_fundamental_rows,
            market_days: state.market_days,
            baseline_draft_id: state.baseline_draft_id,
            coverage_status: state.coverage_status,
            coverage_overall_pct: state.coverage_overall_pct,
            valuation_draft_id: state.valuation_draft_id,
            composition_id: state.composition_id,
            composition_valid: state.composition_valid,
            composition_public_ready: state.composition_public_ready,
            review_id: state.review_id,
            review_status: state.review_status,
            review_promotion_ready: state.review_promotion_ready,
            review_human_verified_at: state.review_human_verified_at,
            published_research_run_id: state.published_research_run_id,
          }
        : null,
      final_plan: plan,
      covered,
    };
  });

  const coveredCount = finalResults.filter((row) => row.covered).length;
  const status =
    coveredCount === finalResults.length
      ? "success"
      : coveredCount > 0
        ? "partial"
        : "failed";

  const artifact = {
    factory_version: SOLPIENT_100_BASELINE_FACTORY_VERSION,
    generated_at: new Date().toISOString(),
    status,
    source_candidate_pipeline_run_id: loaded.candidateRun.id,
    research_factory_run_id: factoryRunId,
    selected_count: selected.length,
    covered_count: coveredCount,
    before: beforeSummary,
    after: afterSummary,
    review_package_results: reviewPackageResults,
    results: finalResults,
    auto_publish: false,
  };

  const root = path.resolve("data/baseline-research/factory-runs");
  const stamp = artifact.generated_at.replace(/[^0-9]/g, "").slice(0, 14);
  await atomicWriteJson(
    path.join(root, "solpient-100-baseline-" + stamp + ".json"),
    artifact,
  );
  await atomicWriteJson(path.join(root, "latest.json"), artifact);

  console.log(JSON.stringify(artifact, null, 2));

  if (status !== "success") process.exitCode = 1;
} finally {
  await closePostgresPool();
}
