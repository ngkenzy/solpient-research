// V1 §22 analytics gate: allowlist validation + never-throws contract.
// lib/analytics.ts is a server-only TS module, so this test asserts its
// contract from source text (plain `node`, no build step).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(repoRoot, "lib", "analytics.ts"), "utf8");

// 1) The allowlist is defined as a single ANALYTICS_EVENTS const.
const match = source.match(/export const ANALYTICS_EVENTS\s*=\s*\[([\s\S]*?)\] as const/);
assert.ok(match, "ANALYTICS_EVENTS const must be exported from lib/analytics.ts");

const listed = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

// 2) Allowlist holds exactly the instrumented §22 events — nothing more,
//    nothing less. Week-1/4/8/12 retention events are excluded by design
//    (computed later from history, never faked).
const EXPECTED = [
  "account_created",
  "portfolio_created",
  "position_added",
  "position_removed",
  "what_matters_opened",
  "material_item_opened",
  "material_item_positive_feedback",
  "material_item_negative_feedback",
  "missed_event_reported",
  "research_opened",
  "research_requested",
];
assert.deepEqual([...listed].sort(), [...EXPECTED].sort(), "allowlist must equal the instrumented §22 event set");
assert.ok(!listed.some((e) => /week_|retention|retained/.test(e)), "retention events must not be in the allowlist");

// 3) Never-throws contract: track() wraps its body in try/catch and degrades
//    to console.warn, so instrumentation can never break product flows.
assert.ok(/export async function track\(/.test(source), "track(eventName, properties?) must be exported");
assert.ok(/try\s*\{/.test(source), "track must wrap work in try/catch");
assert.ok(/catch\s*\(/.test(source), "track must catch errors");
assert.ok(!/throw\s/.test(source), "track must never throw");
assert.ok(source.includes("console.warn"), "track must degrade to console.warn");

// 4) RLS-safe: inserts run under the caller's session (user_id from claims),
//    and anonymous traffic is skipped silently instead of failing on NOT NULL.
assert.ok(/auth\.getClaims\(\)/.test(source), "track must derive user_id from the caller session");
assert.ok(/if\s*\(!userId\)\s*return/.test(source), "track must skip anonymous traffic silently");
assert.ok(/from\("analytics_events"\)/.test(source), "track must write to analytics_events");
assert.ok(/properties\s*,/.test(source) || /properties\s*}/.test(source), "track must insert properties");

console.log("test-analytics: ok (" + listed.length + " allowlisted events, never-throws contract holds)");
