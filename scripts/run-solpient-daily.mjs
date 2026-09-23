import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { pgQuery, closePostgresPool } from "../lib/postgres-node.mjs";

const dryRun = process.argv.includes("--dry-run");
const skipMarket = process.argv.includes("--skip-market");
const skipRanking = process.argv.includes("--skip-ranking");
const skipLists = process.argv.includes("--skip-lists");

const root = process.cwd();
const marketArtifact = path.resolve("data/rankings/market-sync-latest.json");
const listArtifact = path.resolve("data/rankings/solpient-lists-latest.json");

const steps = [
  ...(!skipMarket
    ? [{
        name: "market_refresh",
        script: "scripts/sync-market-history.mjs",
        args: ["--solpient-100", "--output", marketArtifact],
      }]
    : []),
  ...(!skipRanking
    ? [{ name: "phase3_ranking", script: "scripts/refresh-rankings.mjs", args: [] }]
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
      "Daily V1 deliberately does not rerun the governed broad-universe screen. " +
      "It refreshes the existing immutable Solpient 100, Phase 3 ranking, and derived 20/5.",
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
  try {
    marketSummary = JSON.parse(await fs.readFile(marketArtifact, "utf8"));
  } catch {}
  try {
    listSummary = JSON.parse(await fs.readFile(listArtifact, "utf8"));
  } catch {}

  const marketFailures = Array.isArray(marketSummary?.summary)
    ? marketSummary.summary.filter((row) => row?.status === "failed").length
    : null;

  const details = {
    local_first: true,
    steps: results,
    market: marketSummary
      ? {
          generated_at: marketSummary.generated_at,
          scope: marketSummary.scope ?? null,
          failures: marketFailures,
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

  await finishRun(
    runId,
    "success",
    marketFailures
      ? "Daily Solpient ranking completed with " + marketFailures + " market-data ticker failures."
      : "Daily Solpient ranking completed successfully.",
    details,
  );

  console.log(JSON.stringify({ pipeline: "solpient_daily", status: "success", ...details }, null, 2));
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
