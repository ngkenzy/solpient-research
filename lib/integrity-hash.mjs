import { createHash } from "node:crypto";

export const CANONICALIZATION_VERSION = "solpient-canonical-json-v1";
export const HASH_ALGORITHM = "sha256";

function normalize(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = normalize(value[key]);
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function canonicalSha256(value) {
  return createHash(HASH_ALGORITHM).update(canonicalJson(value), "utf8").digest("hex");
}
