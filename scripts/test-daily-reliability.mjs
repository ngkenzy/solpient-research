import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  extractFailedTickers,
  writeFailureJournal,
  readFailureJournal,
  writeCheckpoint,
  readCheckpoint,
  nextStepAfter,
  resumeFlags,
  FAILURE_JOURNAL,
  CHECKPOINT_FILE,
} from "../lib/daily-reliability.mjs";

const failed = extractFailedTickers({
  summary: [
    { ticker: "ok", status: "success" },
    { ticker: "xyzq", status: "failed", reason: "malformed" },
    { symbol: "halt", status: "error" },
  ],
});
assert.deepEqual(failed.map((row) => row.ticker), ["XYZQ", "HALT"]);

fs.mkdirSync(path.dirname(FAILURE_JOURNAL), { recursive: true });
writeFailureJournal(failed);
assert.equal(readFailureJournal().count, 2);

writeCheckpoint("market_refresh");
assert.equal(readCheckpoint().step, "market_refresh");
assert.equal(nextStepAfter("market_refresh"), "phase3_ranking");
assert.deepEqual(resumeFlags({ step: "market_refresh" }), ["--skip-market"]);
assert.deepEqual(resumeFlags({ step: "phase3_ranking" }), ["--skip-market", "--skip-ranking"]);

console.log("test-daily-reliability: passed");
