import process from "node:process";
import { spawn } from "node:child_process";
import { acquireLock, releaseLock, lockPath, DAILY_LOCK } from "../lib/pipeline-lock.mjs";

function arg(name, fallback) {
  const prefix = "--" + name + "=";
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const lockName = arg("lock", DAILY_LOCK);
const sep = process.argv.indexOf("--");
const childArgs = sep >= 0 ? process.argv.slice(sep + 1) : ["scripts/run-solpient-daily.mjs"];
const file = lockPath(lockName);

try {
  acquireLock(file, { pipeline: lockName });
} catch (error) {
  if (error?.code === "PIPELINE_LOCKED") {
    console.error(JSON.stringify({ ok: false, reason: "pipeline_locked", existing: error.existing }, null, 2));
    process.exit(2);
  }
  throw error;
}

let released = false;
function cleanup() {
  if (released) return;
  releaseLock(file);
  released = true;
}

const cmd = childArgs[0] === "node" || childArgs[0] === process.execPath ? childArgs[0] : process.execPath;
const args = childArgs[0] === "node" || childArgs[0] === process.execPath ? childArgs.slice(1) : childArgs;
const child = spawn(cmd, args, { cwd: process.cwd(), env: process.env, stdio: "inherit" });

child.on("exit", (code, signal) => {
  cleanup();
  if (signal) {
    console.error(JSON.stringify({ ok: false, reason: "pipeline_child_signaled", signal }, null, 2));
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  cleanup();
  console.error(error);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    // Keep the lock until the child exits. Releasing it before the child stops
    // could allow a second writer while the first writer is still active.
    if (!child.killed) child.kill(signal);
  });
}

process.on("exit", cleanup);
