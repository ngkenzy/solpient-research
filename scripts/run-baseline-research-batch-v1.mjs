import path from "node:path";
import process from "node:process";
import { closePostgresPool } from "../lib/postgres-node.mjs";
import { runBaselineResearchBatch } from "../lib/baseline-research-batch-v1.mjs";

function arg(name, fallback = null) {
  const prefix = "--" + name + "=";
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const tickers = new Set(
  String(arg("tickers", ""))
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean),
);
const parsedLimit = Number(arg("limit", "0"));
const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : null;
const persist = process.argv.includes("--persist");
const force = process.argv.includes("--force");

try {
  const summary = await runBaselineResearchBatch({
    inputDir: path.resolve(arg("input-dir", "data/baseline-research")),
    outputDir: path.resolve(arg("output-dir", "data/baseline-research/compositions")),
    checkpointPath: path.resolve(
      arg("checkpoint", "data/baseline-research/batch-checkpoint-v1.json"),
    ),
    tickers,
    limit,
    persist,
    force,
  });
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.authoritative) process.exitCode = 1;
} finally {
  await closePostgresPool();
}
