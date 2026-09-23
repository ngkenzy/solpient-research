import assert from "node:assert/strict";
import {
  BASELINE_FACTORY_TARGETS,
  deriveSolpient100BaselinePlan,
  selectSolpient100BaselineWork,
  summarizeSolpient100BaselineStates,
} from "../lib/solpient-100-baseline-factory-v1.mjs";
import {
  assignAutonomousIndustryModule,
} from "../lib/autonomous-research-factory-v2-1.mjs";

function base(ticker, ordinal = 1) {
  return {
    ticker,
    ordinal,
    company_id: "company-" + ticker.toLowerCase(),
    industry_assignment_id: "assignment-" + ticker.toLowerCase(),
    industry_module: "generic_corporate",
    fundamental_rows: 24,
    sec_fundamental_rows: 20,
    latest_fundamental_observed_at: "2026-09-20T12:00:00Z",
    market_days: 1260,
    latest_market_observed_at: "2026-09-20T12:00:00Z",
    context_pack_id: "context-" + ticker.toLowerCase(),
    context_generated_at: "2026-09-21T12:00:00Z",
    context_knowledge_cutoff_at: "2026-09-20T23:59:59Z",
    baseline_draft_id: "draft-" + ticker.toLowerCase(),
    baseline_generated_at: "2026-09-21T13:00:00Z",
    baseline_source_cutoff_at: "2026-09-21T12:00:00Z",
    baseline_industry_module: "generic_corporate",
    coverage_report_id: "coverage-" + ticker.toLowerCase(),
    coverage_generated_at: "2026-09-21T14:00:00Z",
    coverage_status: "sufficient",
    coverage_overall_pct: 82,
    valuation_draft_id: "valuation-" + ticker.toLowerCase(),
    valuation_created_at: "2026-09-21T15:00:00Z",
    composition_id: "composition-" + ticker.toLowerCase(),
    composition_draft_id: "draft-" + ticker.toLowerCase(),
    composition_generated_at: "2026-09-21T16:00:00Z",
    composition_valid: true,
    composition_public_ready: false,
    review_id: "review-" + ticker.toLowerCase(),
    review_draft_id: "draft-" + ticker.toLowerCase(),
    review_status: "editing",
    review_promotion_ready: false,
    review_human_verified_at: null,
    published_research_run_id: null,
  };
}

// Already-composed baseline: no work.
const complete = deriveSolpient100BaselinePlan(base("COMPLETE"));
assert.equal(complete.complete, true);
assert.equal(complete.status, "staged_for_review");
assert.deepEqual(complete.steps, []);

// Published research is authoritative and needs no baseline factory work.
const publishedState = {
  ...base("ADBE", 1),
  published_research_run_id: "research-adbe",
  published_research_researched_at: "2026-09-22T12:00:00Z",
};
const published = deriveSolpient100BaselinePlan(publishedState);
assert.equal(published.status, "published");
assert.equal(published.complete, true);
assert.deepEqual(published.steps, []);


const publishedWithNewEvidence = {
  ...publishedState,
  latest_fundamental_observed_at: "2026-09-23T12:00:00Z",
};
const reopenedPublished = deriveSolpient100BaselinePlan(publishedWithNewEvidence);
assert.equal(reopenedPublished.status, "work_required");
assert.ok(
  reopenedPublished.warnings.includes("published_research_has_newer_durable_evidence"),
);
assert.ok(reopenedPublished.steps.includes("build_historical_peer_context"));
assert.ok(reopenedPublished.steps.includes("build_baseline_draft"));

// JPM-like missing research gets the full deterministic completion path.
const jpm = {
  ...base("JPM", 2),
  industry_assignment_id: null,
  industry_module: null,
  fundamental_rows: 2,
  sec_fundamental_rows: 2,
  market_days: 30,
  context_pack_id: null,
  context_generated_at: null,
  context_knowledge_cutoff_at: null,
  baseline_draft_id: null,
  baseline_generated_at: null,
  baseline_source_cutoff_at: null,
  baseline_industry_module: null,
  coverage_report_id: null,
  coverage_generated_at: null,
  valuation_draft_id: null,
  valuation_created_at: null,
  composition_id: null,
  composition_draft_id: null,
  composition_valid: false,
  review_id: null,
  review_draft_id: null,
};
const jpmPlan = deriveSolpient100BaselinePlan(jpm);
for (const step of [
  "assign_industry",
  "sync_sec_fundamentals",
  "sync_yahoo_fundamentals",
  "sync_market_history",
  "build_historical_peer_context",
  "build_baseline_draft",
  "build_coverage",
  "build_valuation_evidence",
  "compose_review_package",
  "prepare_review_package",
]) {
  assert.ok(jpmPlan.steps.includes(step), "missing JPM step: " + step);
}
assert.equal(jpmPlan.needs_composition, true);

// New evidence invalidates an older baseline draft and its composition.
const stale = {
  ...base("STALE", 3),
  latest_fundamental_observed_at: "2026-09-23T12:00:00Z",
};
const stalePlan = deriveSolpient100BaselinePlan(stale);
assert.ok(stalePlan.steps.includes("build_historical_peer_context"));
assert.ok(stalePlan.steps.includes("build_baseline_draft"));
assert.equal(stalePlan.steps.includes("compose_review_package"), false);
assert.equal(stalePlan.steps.includes("prepare_review_package"), false);

// An industry assignment change rebuilds sector-specific baseline evidence.
const sectorChanged = {
  ...base("XOM", 4),
  industry_assignment_id: "assignment-xom",
  industry_module: "energy_integrated",
  baseline_industry_module: "generic_corporate",
};
const sectorPlan = deriveSolpient100BaselinePlan(sectorChanged);
assert.ok(sectorPlan.steps.includes("build_baseline_draft"));
assert.equal(sectorPlan.steps.includes("compose_review_package"), false);
assert.equal(sectorPlan.steps.includes("prepare_review_package"), false);

const rebuiltForSector = {
  ...sectorChanged,
  baseline_draft_id: "draft-xom-v2",
  baseline_generated_at: "2026-09-23T15:00:00Z",
  baseline_source_cutoff_at: "2026-09-23T14:00:00Z",
  baseline_industry_module: "energy_integrated",
  review_draft_id: "draft-xom",
  composition_draft_id: "draft-xom",
};
const rebuiltSectorPlan = deriveSolpient100BaselinePlan(rebuiltForSector);
assert.ok(rebuiltSectorPlan.steps.includes("compose_review_package"));
assert.ok(rebuiltSectorPlan.steps.includes("prepare_review_package"));

// Identity failures fail closed rather than producing orphan research.
const noIdentity = deriveSolpient100BaselinePlan({
  ticker: "NOID",
  ordinal: 5,
  company_id: null,
});
assert.equal(noIdentity.status, "blocked");
assert.ok(noIdentity.blockers.includes("canonical_identity_missing"));

// Selection prioritizes missing compositions over lower-priority repairs.
const work = selectSolpient100BaselineWork(
  [
    publishedState,
    base("READY", 2),
    jpm,
    {
      ...base("LOW", 4),
      industry_assignment_id: null,
      industry_module: null,
    },
  ],
  { maxItems: 2 },
);
assert.equal(work[0].state.ticker, "JPM");
assert.ok(work.every((entry) => entry.state.ticker !== "ADBE"));
assert.ok(work.every((entry) => entry.state.ticker !== "READY"));

// Summary always accounts for the full governed membership passed to it.
const summary = summarizeSolpient100BaselineStates([
  publishedState,
  base("READY", 2),
  jpm,
  { ticker: "NOID", ordinal: 4, company_id: null },
]);
assert.equal(summary.member_count, 4);
assert.equal(summary.published_count, 1);
assert.equal(summary.baseline_building_count, 1);
assert.equal(summary.work_required_count, 1);
assert.equal(summary.blocked_count, 1);
assert.equal(
  BASELINE_FACTORY_TARGETS.minimum_market_days,
  756,
);

// Sector coverage: these no longer stay unsupported by policy.
const classification = { confidence: "high", reviewRequired: false };

const energy = assignAutonomousIndustryModule({
  ticker: "XOM",
  screenProfile: "general",
  sector: "Energy",
  industry: "Integrated Oil & Gas",
  sectorClassification: classification,
});
assert.equal(energy.status, "applied");
assert.equal(energy.module, "energy_integrated");

const reit = assignAutonomousIndustryModule({
  ticker: "AMT",
  screenProfile: "general",
  sector: "Real Estate",
  industry: "Specialized REIT",
  sectorClassification: classification,
});
assert.equal(reit.status, "applied");
assert.equal(reit.module, "real_estate_reit");

const insurance = assignAutonomousIndustryModule({
  ticker: "PGR",
  screenProfile: "general",
  sector: "Financials",
  industry: "Property & Casualty Insurance",
  sectorClassification: classification,
});
assert.equal(insurance.status, "applied");
assert.equal(insurance.module, "financial_insurance");

const bank = assignAutonomousIndustryModule({
  ticker: "JPM",
  screenProfile: "general",
  sector: "Financials",
  industry: "Diversified Banks",
  sectorClassification: classification,
});
assert.equal(bank.status, "applied");
assert.equal(bank.module, "financial_bank");

console.log("Solpient 100 Baseline Factory V1 tests passed.");
