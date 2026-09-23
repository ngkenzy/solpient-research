import assert from "node:assert/strict";
import {
  BASELINE_COMPOSER_OUTPUT_VERSION,
  BASELINE_QUALITATIVE_SECTIONS,
  buildBaselineEvidencePack,
  validateBaselineComposerOutput,
  baselineResearchState,
} from "../lib/baseline-research-contract-v1.mjs";
import { INDUSTRY_MODULES } from "../lib/industry-modules.mjs";
import { V2_CORE_METRIC_KEYS } from "../lib/research-standard-v2.mjs";

const sufficientCoverage = (module) => ({
  engine_version: "coverage-v2",
  as_of_date: "2026-09-23",
  status: "sufficient",
  fundamentals_pct: 95,
  balance_sheet_pct: 90,
  history_pct: 100,
  market_history_pct: 90,
  industry_pct: 100,
  peer_pct: 80,
  valuation_history_pct: 80,
  capital_allocation_pct: 80,
  consensus_pct: 40,
  research_structure_pct: 0,
  decision_readiness_pct: 82,
  overall_pct: 84,
  missing_fields: [],
  coverage_details: { industry_module: module },
});

function metricRows(module, { omitSector = [] } = {}) {
  const universal = V2_CORE_METRIC_KEYS.map((metric_key, index) => ({
    module: "universal",
    metric_key,
    label: metric_key,
    status: "available",
    basis: "derived",
    value_numeric: index + 1,
    unit: "unit",
    period_end: "2026-06-30",
    source_title: "SEC filing",
    source_url: "https://www.sec.gov/example",
  }));
  const sector = (INDUSTRY_MODULES[module]?.requiredMetricKeys ?? [])
    .filter((metric_key) => !omitSector.includes(metric_key))
    .map((metric_key, index) => ({
      module,
      metric_key,
      label: metric_key,
      status: "available",
      basis: "reported",
      value_numeric: 10 + index,
      unit: "unit",
      period_end: "2026-06-30",
      source_title: "Primary evidence",
      source_url: "https://www.sec.gov/example-sector",
    }));
  return [...universal, ...sector];
}

function draft(module, options = {}) {
  return {
    id: "draft-" + module,
    draft_payload: {
      metric_observations: metricRows(module, options),
      sources: [
        {
          source_type: "10-K",
          title: "Annual report",
          url: "https://www.sec.gov/example-10k",
          accession_number: "0000000000-26-000001",
          filing_date: "2026-02-01",
        },
      ],
    },
  };
}

function candidate() {
  return {
    stage: "research_building",
    readiness_state: "building",
    shortlist_rank: 1,
    universe_rank: 10,
    screen_score: 90,
    quality_core_score: 88,
    evidence_coverage_pct: 85,
  };
}

function company(ticker, sector = "Test") {
  return {
    id: "company-" + ticker.toLowerCase(),
    ticker,
    company_name: ticker + " Corp",
    sector,
    industry: sector,
  };
}

function packFor(ticker, module, options = {}) {
  return buildBaselineEvidencePack({
    company: company(ticker),
    candidate: candidate(),
    coverage: sufficientCoverage(module),
    baselineDraft: draft(module, options),
    industryModule: module,
    latestMarket: { price: 100 },
    publishedValuation: {
      bear_value: 80,
      base_value: 125,
      bull_value: 160,
      mos_25_price: 93.75,
      mos_35_price: 81.25,
    },
    generatedAt: "2026-09-23T17:00:00.000Z",
  });
}

function supportedOutput(pack) {
  const ref = pack.evidence_items[0].id;
  return {
    output_version: BASELINE_COMPOSER_OUTPUT_VERSION,
    evidence_pack_hash: pack.evidence_pack_hash,
    company: { ticker: pack.company.ticker },
    sections: Object.fromEntries(
      BASELINE_QUALITATIVE_SECTIONS.map((key) => [
        key,
        {
          status: "supported",
          claims: [{ text: key + " evidence-grounded observation.", evidence_refs: [ref] }],
          limitation: null,
        },
      ]),
    ),
    evidence_gaps: [],
  };
}

// Software: complete evidence becomes public-baseline ready.
const adobe = packFor("ADBE", "software_platform");
assert.equal(adobe.baseline_gate.public_baseline_ready, true);
assert.equal(adobe.sector_evidence.coverage_pct, 100);
assert.match(adobe.evidence_pack_hash, /^[0-9a-f]{64}$/);
assert.equal(adobe.deterministic_summary.current_price, 100);
assert.equal(adobe.deterministic_summary.base_fair_value, 125);
assert.equal(adobe.deterministic_summary.valuation_gap_pct, 20);

const adobeOutput = supportedOutput(adobe);
const adobeValidation = validateBaselineComposerOutput(adobe, adobeOutput);
assert.equal(adobeValidation.valid, true);
assert.equal(adobeValidation.public_baseline_ready, true);
assert.equal(
  baselineResearchState({
    evidencePack: adobe,
    composerValidation: adobeValidation,
    candidateReadinessState: "building",
  }),
  "baseline_ready",
);

// Biopharma: missing sector-critical evidence keeps the public baseline in Building.
const pfe = packFor("PFE", "biopharma", {
  omitSector: ["patent_expiry_revenue_exposure"],
});
assert.equal(pfe.baseline_gate.public_baseline_ready, false);
assert.ok(
  pfe.baseline_gate.blockers.some((value) => value.startsWith("sector_metric_coverage_")),
);
assert.ok(
  pfe.evidence_gaps.some(
    (gap) =>
      gap.kind === "missing_sector_metric" &&
      gap.metric_key === "patent_expiry_revenue_exposure",
  ),
);

// Bank: uses its sector-specific metric contract rather than a generic FCF rule.
const jpm = packFor("JPM", "financial_bank");
assert.equal(jpm.baseline_gate.public_baseline_ready, true);
assert.equal(jpm.sector_evidence.required_metric_count, 6);

// Generic operating company can be supported when the reviewed factory assignment is explicit.
const xom = packFor("XOM", "generic_corporate");
assert.equal(xom.baseline_gate.public_baseline_ready, true);

// Unknown/unreviewed sector: analysis can be composed privately, but cannot masquerade as baseline-ready.
const amt = buildBaselineEvidencePack({
  company: company("AMT", "Real Estate"),
  candidate: candidate(),
  coverage: {
    ...sufficientCoverage(null),
    coverage_details: { industry_module: null },
  },
  baselineDraft: {
    id: "draft-amt",
    draft_payload: {
      metric_observations: metricRows("generic_corporate"),
      sources: [],
    },
  },
  generatedAt: "2026-09-23T17:00:00.000Z",
});
assert.equal(amt.baseline_gate.composer_allowed, true);
assert.equal(amt.baseline_gate.public_baseline_ready, false);
assert.ok(amt.baseline_gate.blockers.includes("industry_module_unreviewed"));
assert.ok(amt.evidence_gaps.some((gap) => gap.kind === "industry_module_review"));

// Unsupported prose is rejected.
const tampered = supportedOutput(adobe);
tampered.sections.company_overview.claims[0].evidence_refs = ["source:not-real"];
const tamperedValidation = validateBaselineComposerOutput(adobe, tampered);
assert.equal(tamperedValidation.valid, false);
assert.ok(
  tamperedValidation.errors.some((value) => value.includes("unknown_evidence_ref")),
);

// A composer cannot silently analyze against a different evidence snapshot.
const wrongHash = supportedOutput(adobe);
wrongHash.evidence_pack_hash = "0".repeat(64);
const wrongHashValidation = validateBaselineComposerOutput(adobe, wrongHash);
assert.equal(wrongHashValidation.valid, false);
assert.ok(wrongHashValidation.errors.includes("evidence_pack_hash_mismatch"));

// Higher governed readiness states remain authoritative.
assert.equal(
  baselineResearchState({
    evidencePack: adobe,
    composerValidation: adobeValidation,
    candidateReadinessState: "research_ready",
  }),
  "research_ready",
);
assert.equal(
  baselineResearchState({
    evidencePack: adobe,
    composerValidation: adobeValidation,
    candidateReadinessState: "decision_ready",
  }),
  "decision_ready",
);

console.log("Baseline Research Contract V1 tests passed.");
