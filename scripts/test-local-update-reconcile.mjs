import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireLock,
  releaseLock,
  readLock,
  cadenceForCommand,
  governedMustNotRunAsDaily,
  authoritativeSnapshotPolicy,
} from "../lib/pipeline-lock.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solpient-lock-"));
const file = path.join(dir, "solpient_daily.lock");

// A live owner blocks a second writer.
acquireLock(file, { pid: process.pid, pipeline: "solpient_daily" });
assert.throws(
  () => acquireLock(file, { pid: process.pid + 1, pipeline: "solpient_daily" }),
  (error) => error.code === "PIPELINE_LOCKED",
);
assert.equal(releaseLock(file), true);

// A stale/dead owner is recovered instead of locking Solpient forever.
fs.writeFileSync(
  file,
  JSON.stringify({ pid: 999999999, pipeline: "solpient_daily", acquired_at: "2000-01-01T00:00:00.000Z" }),
);
acquireLock(file, { pid: process.pid, pipeline: "solpient_daily" });
assert.equal(readLock(file).pid, process.pid);
assert.equal(releaseLock(file), true);

// One process cannot release another process's live lock.
acquireLock(file, { pid: process.pid, pipeline: "solpient_daily" });
assert.equal(releaseLock(file, { pid: process.pid + 1 }), false);
assert.equal(fs.existsSync(file), true);
assert.equal(releaseLock(file), true);

assert.equal(cadenceForCommand("npm run local:daily"), "daily");
assert.equal(cadenceForCommand("npm run local:governed"), "governed");
assert.equal(cadenceForCommand("scripts/local-update-engine.mjs"), "legacy_retired");

assert.equal(governedMustNotRunAsDaily(["--as-daily"]).ok, false);
assert.equal(governedMustNotRunAsDaily(["--dry-run"]).ok, true);

const blocked = authoritativeSnapshotPolicy({ incomingState: "partial", previousAuthoritative: "run_yesterday" });
assert.equal(blocked.publish, false);
assert.equal(blocked.keep, "run_yesterday");

const failed = authoritativeSnapshotPolicy({ incomingState: "failed", previousAuthoritative: "run_yesterday" });
assert.equal(failed.publish, false);
assert.equal(failed.keep, "run_yesterday");

const ok = authoritativeSnapshotPolicy({ incomingState: "succeeded", previousAuthoritative: "run_yesterday" });
assert.equal(ok.publish, true);

console.log("test-local-update-reconcile: passed");
