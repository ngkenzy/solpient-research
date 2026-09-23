import fs from "node:fs";
import path from "node:path";

export const RELIABILITY_DIR = path.resolve("data/rankings");
export const FAILURE_JOURNAL = path.join(RELIABILITY_DIR, "ticker-failures-latest.json");
export const CHECKPOINT_FILE = path.join(RELIABILITY_DIR, "daily-checkpoint.json");

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

export function extractFailedTickers(marketSummary) {
  const rows = Array.isArray(marketSummary?.summary)
    ? marketSummary.summary
    : Array.isArray(marketSummary?.failures)
      ? marketSummary.failures
      : [];
  return rows
    .filter((row) => {
      const status = String(row?.status ?? row?.state ?? "").toLowerCase();
      return status === "failed" || status === "error" || row?.ok === false;
    })
    .map((row) => ({
      ticker: String(row.ticker ?? row.symbol ?? "").toUpperCase(),
      reason: row.reason ?? row.error ?? row.message ?? "failed",
    }))
    .filter((row) => row.ticker);
}

export function writeFailureJournal(failures, source = "market_refresh") {
  ensureDir(FAILURE_JOURNAL);
  const payload = {
    source,
    written_at: new Date().toISOString(),
    count: failures.length,
    tickers: failures,
  };
  fs.writeFileSync(FAILURE_JOURNAL, JSON.stringify(payload, null, 2));
  return payload;
}

export function readFailureJournal() {
  try {
    return JSON.parse(fs.readFileSync(FAILURE_JOURNAL, "utf8"));
  } catch {
    return { count: 0, tickers: [] };
  }
}

export function writeCheckpoint(step, extra = {}) {
  ensureDir(CHECKPOINT_FILE);
  const payload = {
    step,
    updated_at: new Date().toISOString(),
    ...extra,
  };
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(payload, null, 2));
  return payload;
}

export function readCheckpoint() {
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function nextStepAfter(step) {
  const order = ["market_refresh", "phase3_ranking", "solpient_lists"];
  const index = order.indexOf(step);
  if (index < 0 || index === order.length - 1) return null;
  return order[index + 1];
}

export function resumeFlags(checkpoint) {
  if (!checkpoint?.step) return [];
  if (checkpoint.step === "market_refresh") return ["--skip-market"];
  if (checkpoint.step === "phase3_ranking") return ["--skip-market", "--skip-ranking"];
  return ["--skip-market", "--skip-ranking", "--skip-lists"];
}
