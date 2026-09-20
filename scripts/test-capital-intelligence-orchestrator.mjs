import assert from "node:assert/strict";
import {
  CAPITAL_ORCHESTRATOR_VERSION,
  dedupeCapitalRecords,
  feedFreshness,
  materialityForCapitalActivity,
  normalizeCapitalRecord,
  providerHealthRow,
  summarizeCapitalCoverage,
} from "../lib/capital-intelligence-orchestrator.mjs";

const companies = [
  { id: "msft-id", ticker: "MSFT", company_name: "Microsoft Corporation" },
  { id: "adbe-id", ticker: "ADBE", company_name: "Adobe Inc." },
];
const companyByTicker = new Map(companies.map((c) => [c.ticker, c]));

const good = normalizeCapitalRecord({
  ticker: "msft",
  activity_type: "insider",
  actor_name: "Example Officer",
  actor_detail: "CFO",
  action: "Buy",
  shares: "100",
  price: "500",
  value: "50000",
  transaction_date: "2026-09-19",
  disclosure_date: "2026-09-20",
  source_url: "https://example.test/form4",
  source_key: "msft:example:1",
}, { provider: "web_verified", verifiedAt: "2026-09-20T20:00:00Z", companyByTicker });

assert.equal(good.valid, true);
assert.equal(good.row.company_id, "msft-id");
assert.equal(good.row.shares, 100);
assert.equal(good.row.provider, "web_verified");

const bad = normalizeCapitalRecord({
  ticker: "UNKNOWN",
  activity_type: "rumor",
  actor_name: "",
  action: "",
}, { provider: "web_verified", companyByTicker });
assert.equal(bad.valid, false);
assert.ok(bad.errors.length >= 4);

const deduped = dedupeCapitalRecords([
  { provider: "manual", source_key: "same", verified_at: "2026-09-20T10:00:00Z", action: "Reported" },
  { provider: "manual", source_key: "same", verified_at: "2026-09-20T12:00:00Z", action: "Increased" },
  { provider: "web_verified", source_key: "other", verified_at: "2026-09-20T12:00:00Z", action: "Buy" },
]);
assert.equal(deduped.length, 2);
assert.equal(deduped.find((x) => x.source_key === "same")?.action, "Increased");

assert.equal(materialityForCapitalActivity({ activity_type: "insider", action: "Buy", value: 250000 }), "high");
assert.equal(materialityForCapitalActivity({ activity_type: "insider", action: "Sell", value: 8000000 }), "review");
assert.equal(materialityForCapitalActivity({ activity_type: "institutional", action: "Exited", change_pct: -100 }), "review");
assert.equal(materialityForCapitalActivity({ activity_type: "political", action: "Purchase" }), "info");

const health = providerHealthRow({
  provider: "web_verified",
  feedType: "insider",
  status: "healthy",
  lastSuccessAt: "2026-09-20T20:00:00Z",
  rowsWritten: 2,
  companiesCovered: 1,
});
assert.equal(health.feed_type, "insider");
assert.equal(health.metadata.orchestrator_version, CAPITAL_ORCHESTRATOR_VERSION);

const coverage = summarizeCapitalCoverage([
  { company_id: "msft-id", activity_type: "insider", verified_at: "2026-09-20T20:00:00Z" },
  { company_id: "msft-id", activity_type: "institutional", verified_at: "2026-09-20T19:00:00Z" },
], companies);
assert.equal(coverage.find((x) => x.ticker === "MSFT")?.categories_covered, 2);
assert.equal(coverage.find((x) => x.ticker === "ADBE")?.categories_covered, 0);

assert.equal(feedFreshness({ lastSuccessAt: "2026-09-20T18:00:00Z", now: new Date("2026-09-20T20:00:00Z"), staleAfterHours: 36 }), "healthy");
assert.equal(feedFreshness({ lastSuccessAt: "2026-09-18T18:00:00Z", now: new Date("2026-09-20T20:00:00Z"), staleAfterHours: 36 }), "stale");

console.log("Capital Intelligence Orchestrator tests passed.");
