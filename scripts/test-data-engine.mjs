import assert from "node:assert/strict";

function selectAuthoritativeRun(runs) {
  const successful = runs.filter((run) => run.state === "succeeded" || run.state === "unchanged");
  if (!successful.length) return null;
  return successful
    .slice()
    .sort((a, b) => Date.parse(b.completedAt ?? b.startedAt) - Date.parse(a.completedAt ?? a.startedAt))[0];
}

function canPublishSnapshot(run) {
  if (run.state === "partial" || run.state === "failed" || run.state === "running") {
    return { ok: false, reason: "incomplete_or_failed_run_cannot_be_authoritative" };
  }
  const commit = run.stages.find((stage) => stage.name === "snapshot_commit");
  if (!commit || commit.status !== "succeeded") {
    return { ok: false, reason: "snapshot_commit_not_succeeded" };
  }
  if (run.failures.some((failure) => failure.fatalToSnapshot)) {
    return { ok: false, reason: "fatal_failure_blocks_snapshot" };
  }
  return { ok: true, reason: "ok" };
}

function tickerFailureCorruptsSnapshot(run, ticker) {
  return run.failures.some((failure) => failure.ticker === ticker && failure.fatalToSnapshot);
}

function applyIdenticalInputHash(previous, incomingHash) {
  if (previous && previous.inputHash === incomingHash && previous.state === "succeeded") return "unchanged";
  return "succeeded";
}

const yesterday = {
  id: "y",
  state: "succeeded",
  completedAt: "2026-09-22T10:00:00Z",
  startedAt: "2026-09-22T09:00:00Z",
  inputHash: "h-y",
  stages: [{ name: "snapshot_commit", status: "succeeded" }],
  failures: [],
};
const todayPartial = {
  id: "t",
  state: "partial",
  completedAt: "2026-09-23T10:00:00Z",
  startedAt: "2026-09-23T09:00:00Z",
  inputHash: "h-t",
  stages: [{ name: "snapshot_commit", status: "failed" }],
  failures: [{ ticker: "XYZQ", stage: "normalization", fatalToSnapshot: false }],
};

assert.equal(selectAuthoritativeRun([todayPartial, yesterday]).id, "y");
assert.equal(canPublishSnapshot(todayPartial).ok, false);
assert.equal(canPublishSnapshot(yesterday).ok, true);
assert.equal(tickerFailureCorruptsSnapshot(todayPartial, "XYZQ"), false);

const midWrite = {
  state: "partial",
  stages: [{ name: "snapshot_commit", status: "failed" }],
  failures: [{ ticker: null, stage: "snapshot_commit", fatalToSnapshot: true }],
};
assert.equal(canPublishSnapshot(midWrite).ok, false);
assert.equal(applyIdenticalInputHash(yesterday, "h-y"), "unchanged");
assert.equal(applyIdenticalInputHash(yesterday, "h-new"), "succeeded");

console.log("test-data-engine: passed (failed ticker does not publish; partial never authoritative)");
