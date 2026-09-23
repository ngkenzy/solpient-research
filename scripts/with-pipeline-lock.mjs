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

let held = false;
try {
  acquireLock(file, { pipeline: lockName });
  held = true;
} catch (error) {
  if (error.code === "PIPELINE_LOCKED") {
    console.error(JSON.stringify({ ok: false, reason: "pipeline_locked", existing: error.existing }, null, 2));
    process.exit(2);
  }
  throw error;
}

const cmd = childArgs[0] === "node" || childArgs[0] === process.execPath ? childArgs[0] : process.execPath;
const args = childArgs[0] === "node" || childArgs[0] === process.execPath ? childArgs.slice(1) : childArgs;

const child = spawn(cmd, args, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
child.on("exit", (code) => {
  if (held) releaseLock(file);
  process.exit(code ?? 1);
});
child.on("error", (error) => {
  if (held) releaseLock(file);
  console.error(error);
  process.exit(1);
});
process.on("SIGINT", () => {
  if (held) releaseLock(file);
  process.exit(130);
});
