import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { pgQuery, closePostgresPool } from "../lib/postgres-node.mjs";

const dryRun = process.argv.includes("--dry-run");
const skipSec = process.argv.includes("--skip-sec");
const skipMarket = process.argv.includes("--skip-market");
const skipResearch = process.argv.includes("--skip-research");
const skipPrivateScores = process.argv.includes("--skip-private-scores");
const skipRanking = process.argv.includes("--skip-ranking");
const skipLists = process.argv.includes("--skip-lists");

const root = process.cwd();
const marketArtifact = path.resolve("data/rankings/market-sync-latest.json");
const listArtifact = path.resolve("data/rankings/solpient-lists-latest.json");

const steps = [
  ...(!skipSec
    ? [{
        name: "sec_refresh",
        script: "scripts/sync-sec-companyfacts-backfill.mjs",
        args: ["--solpient-100"],
      }]
    : []),
  ...(!skipMarket
    ? [{
        name: "market_refresh",
        script: "scripts/sync-market-history.mjs",
        args: ["--solpient-100", "--output", marketArtifact],
      }]
    : []),
  ...(!skipResearch
    ? [{
        name: "research_refresh",
        script: "scripts/run-solpient-100-baseline-factory-v1.mjs",
        args: ["--all", "--continue-on-partial"],
      }]
    : []),
  ...(!skipPrivateScores
    ? [{
        name: "private_phase3_scores",
        script: "scripts/refresh-solpient-100-private-scores-v1.mjs",
        args: [],
      }]
    : []),
  ...(!skipRanking
    ? [{ name: "published_phase3_ranking", script: "scripts/refresh-rankings.mjs", args: [] }]
    : []),
  ...(!skipLists
    ? [{
        name: "solpient_lists",
        script: "scripts/refresh-solpient-lists.mjs",
        args: ["--output=" + listArtifact],
      }]
    : []),
];

function runStep(step) {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const child = spawn(process.execPath, [step.script, ...step.args], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      const result = {
        name: step.name,
        script: step.script,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        exit_code: code,
        signal: signal ?? null,
        status: code === 0 ? "success" : "failed",
      };
      if (code === 0) resolve(result);
      else {
        const error = new Error(step.name + " failed with exit code " + code + ".");
        error.stepResult = result;
        reject(error);
      }
    });
  });
}

async function startRun() {
  const rows = await pgQuery(
    "insert into public.automation_runs(pipeline,status,details) " +
      "values('solpient_daily','running',$1::jsonb) returning id",
    [JSON.stringify({ steps: steps.map((step) => step.name), local_first: true })],
  );
  return rows[0]?.id ?? null;
}

async function finishRun(id, status, message, details) {
  if (!id) return;
  await pgQuery(
    "update public.automation_runs " +
      "set status=$2, records_written=$3, message=$4, details=$5::jsonb, completed_at=now() " +
      "where id=$1",
    [
      id,
      status,
      details?.records_written ?? 0,
      message,
      JSON.stringify(details ?? {}),
    ],
  );
}

if (dryRun) {
  console.log(JSON.stringify({
    dry_run: true,
    local_first: true,
    steps,
    note:
      "Daily V2 deliberately does not rerun the governed broad-universe screen. " +
      "It checks SEC and market data for the immutable Solpient 100, rebuilds only stale private analysis, " +
      "scores all 100 with Phase 3, refreshes released/public ranking, and regenerates derived 20/5.",
  }, null, 2));
  process.exit(0);
}

const runId = await startRun();
const results = [];

try {
  for (const step of steps) {
    results.push(await runStep(step));
  }

  let marketSummary = null;
  let listSummary = null;
  let scoreSummary = null;
  try {
    marketSummary = JSON.parse(await fs.readFile(marketArtifact, "utf8"));
  } catch {}
  try {
    listSummary = JSON.parse(await fs.readFile(listArtifact, "utf8"));
  } catch {}
  try {
    const scoreRows = await pgQuery(
      "select status,details,completed_at from public.automation_runs " +
        "where pipeline='solpient_100_daily_scores_v1' " +
        "order by started_at desc limit 1"
    );
    scoreSummary = scoreRows[0] ?? null;
  } catch {}

  const marketFailures = Array.isArray(marketSummary?.summary)
    ? marketSummary.summary.filter((row) => row?.status === "failed").length
    : null;

  const details = {
    local_first: true,
    daily_research_engine: "solpient-100-daily-analysis-score-v1",
    steps: results,
    market: marketSummary
      ? {
          generated_at: marketSummary.generated_at,
          scope: marketSummary.scope ?? null,
          failures: marketFailures,
        }
      : null,
    scores: scoreSummary
      ? {
          status: scoreSummary.status,
          scored: scoreSummary.details?.scored ?? null,
          unscored: scoreSummary.details?.unscored ?? null,
          private_review_sources: scoreSummary.details?.private_review_sources ?? null,
          published_sources: scoreSummary.details?.published_sources ?? null,
          building_sources: scoreSummary.details?.building_sources ?? null,
        }
      : null,
    lists: listSummary
      ? {
          generated_at: listSummary.generated_at,
          input_hash: listSummary.input_hash,
          counts: listSummary.counts,
          complete: listSummary.complete,
          solpient_5: listSummary.solpient_5?.map((row) => row.ticker) ?? [],
        }
      : null,
    records_written:
      (listSummary?.counts?.solpient_100 ?? 0) +
      (listSummary?.counts?.solpient_20 ?? 0) +
      (listSummary?.counts?.solpient_5 ?? 0),
  };

  const unscored = Number(scoreSummary?.details?.unscored ?? 0);
  const dailyStatus = marketFailures || unscored > 0 ? "partial" : "success";
  const messageParts = [];
  if (marketFailures) messageParts.push(String(marketFailures) + " market-data ticker failure(s)");
  if (unscored > 0) messageParts.push(String(unscored) + " company score(s) still building");
  const message = messageParts.length
    ? "Daily Solpient 100 update completed with " + messageParts.join(" and ") + "."
    : "Daily Solpient 100 analysis and scoring completed successfully.";

  await finishRun(
    runId,
    dailyStatus,
    message,
    details,
  );

  console.log(JSON.stringify({ pipeline: "solpient_daily", status: dailyStatus, ...details }, null, 2));
} catch (error) {
  const failedStep = error?.stepResult ?? null;
  const details = {
    local_first: true,
    steps: [...results, ...(failedStep ? [failedStep] : [])],
    failed_step: failedStep?.name ?? null,
    records_written: 0,
  };
  await finishRun(
    runId,
    "failed",
    error instanceof Error ? error.message : String(error),
    details,
  );
  throw error;
} finally {
  await closePostgresPool();
}
