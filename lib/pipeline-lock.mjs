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

export function acquireLock(file, { pid = process.pid, pipeline } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const error = new Error("pipeline_locked");
    error.code = "PIPELINE_LOCKED";
    error.existing = readLock(file);
    throw error;
  }
  const payload = {
    pid,
    pipeline,
    acquired_at: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), { flag: "wx" });
  return payload;
}

export function releaseLock(file) {
  try {
    fs.unlinkSync(file);
  } catch {}
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
