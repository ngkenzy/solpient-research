import fs from "node:fs";
import path from "node:path";

export const DEFAULT_LOCK_DIR = path.resolve("data/locks");
export const DAILY_LOCK = "solpient_daily.lock";
export const GOVERNED_LOCK = "solpient_governed.lock";

export function lockPath(name, dir = DEFAULT_LOCK_DIR) {
  return path.join(dir, name);
}

export function readLock(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function lockedError(file, existing) {
  const error = new Error("pipeline_locked");
  error.code = "PIPELINE_LOCKED";
  error.file = file;
  error.existing = existing;
  return error;
}

export function acquireLock(file, { pid = process.pid, pipeline } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const payload = {
      pid,
      pipeline,
      acquired_at: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), { flag: "wx" });
      return payload;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;

      const existing = readLock(file);
      if (existing && processAlive(Number(existing.pid))) {
        throw lockedError(file, existing);
      }

      // A malformed lock or a lock owned by a dead PID is stale. Remove it and
      // retry exactly once. The second atomic "wx" write still protects races.
      try {
        fs.unlinkSync(file);
      } catch (unlinkError) {
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      }
    }
  }

  throw lockedError(file, readLock(file));
}

export function releaseLock(file, { pid = process.pid } = {}) {
  const existing = readLock(file);
  if (existing && Number(existing.pid) !== Number(pid)) return false;
  try {
    fs.unlinkSync(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function cadenceForCommand(command) {
  const name = String(command ?? "");
  if (name.includes("local:daily") || name.includes("run-solpient-daily")) return "daily";
  if (name.includes("local:governed") || name.includes("run-solpient-governed")) return "governed";
  if (name.includes("local-update")) return "legacy_retired";
  return "unknown";
}

export function governedMustNotRunAsDaily(flags = []) {
  if (flags.includes("--as-daily") || flags.includes("--daily")) {
    return { ok: false, reason: "governed_cycle_cannot_run_as_daily" };
  }
  return { ok: true, reason: "ok" };
}

export function authoritativeSnapshotPolicy({ incomingState, previousAuthoritative }) {
  if (incomingState === "partial" || incomingState === "failed" || incomingState === "running") {
    return { publish: false, keep: previousAuthoritative ?? null, reason: "incomplete_cannot_replace_authoritative" };
  }
  return { publish: true, keep: previousAuthoritative ?? null, reason: "ok" };
}
