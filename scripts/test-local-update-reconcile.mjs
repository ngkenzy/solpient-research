import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireLock,
  releaseLock,
  cadenceForCommand,
  governedMustNotRunAsDaily,
  authoritativeSnapshotPolicy,
} from "../lib/pipeline-lock.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solpient-lock-"));
const file = path.join(dir, "solpient_daily.lock");

acquireLock(file, { pid: 1, pipeline: "solpient_daily" });
assert.throws(() => acquireLock(file, { pid: 2, pipeline: "solpient_daily" }), (error) => error.code === "PIPELINE_LOCKED");
releaseLock(file);
acquireLock(file, { pid: 3, pipeline: "solpient_daily" });
releaseLock(file);

assert.equal(cadenceForCommand("npm run local:daily"), "daily");
assert.equal(cadenceForCommand("npm run local:governed"), "governed");
assert.equal(cadenceForCommand("scripts/local-update-engine.mjs"), "legacy_retired");

assert.equal(governedMustNotRunAsDaily(["--as-daily"]).ok, false);
assert.equal(governedMustNotRunAsDaily(["--dry-run"]).ok, true);

const blocked = authoritativeSnapshotPolicy({ incomingState: "partial", previousAuthoritative: "run_yesterday" });
assert.equal(blocked.publish, false);
assert.equal(blocked.keep, "run_yesterday");

const ok = authoritativeSnapshotPolicy({ incomingState: "succeeded", previousAuthoritative: "run_yesterday" });
assert.equal(ok.publish, true);

console.log("test-local-update-reconcile: passed");
