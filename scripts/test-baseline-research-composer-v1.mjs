import assert from "node:assert/strict";
import {
  buildBaselineEvidencePack,
  validateBaselineComposerOutput,
} from "../lib/baseline-research-contract-v1.mjs";
import { INDUSTRY_MODULES } from "../lib/industry-modules.mjs";
import { V2_CORE_METRIC_KEYS } from "../lib/research-standard-v2.mjs";
import { composeBaselineResearch } from "../lib/baseline-research-composer-v1.mjs";

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

function summarize(ticker, pack, output, validation) {
  const insufficient = Object.entries(output.sections)
    .filter(([, section]) => section.status === "insufficient_evidence")
    .map(([key]) => key);
  return {
    ticker,
    valid: validation.valid,
    pack_public_baseline_ready: pack.baseline_gate.public_baseline_ready,
    composer_public_baseline_ready: validation.public_baseline_ready,
    insufficient_sections: insufficient,
    errors: validation.errors,
    warnings: validation.warnings,
  };
}

const adobe = packFor("ADBE", "software_platform");
const adobeOut = composeBaselineResearch(adobe);
const adobeVal = validateBaselineComposerOutput(adobe, adobeOut);
assert.equal(adobeVal.valid, true, adobeVal.errors.join(","));

const pfe = packFor("PFE", "biopharma", {
  omitSector: ["patent_expiry_revenue_exposure"],
});
const pfeOut = composeBaselineResearch(pfe);
const pfeVal = validateBaselineComposerOutput(pfe, pfeOut);
assert.equal(pfeVal.valid, true, pfeVal.errors.join(","));
assert.equal(pfe.baseline_gate.public_baseline_ready, false);

const jpm = packFor("JPM", "financial_bank");
const jpmOut = composeBaselineResearch(jpm);
const jpmVal = validateBaselineComposerOutput(jpm, jpmOut);
assert.equal(jpmVal.valid, true, jpmVal.errors.join(","));
const jpmText = JSON.stringify(jpmOut);
assert.equal(jpmText.includes("fcf_yield"), false);

const xom = packFor("XOM", "generic_corporate");
const xomOut = composeBaselineResearch(xom);
const xomVal = validateBaselineComposerOutput(xom, xomOut);
assert.equal(xomVal.valid, true, xomVal.errors.join(","));

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
const amtOut = composeBaselineResearch(amt);
const amtVal = validateBaselineComposerOutput(amt, amtOut);
assert.equal(amtVal.valid, true, amtVal.errors.join(","));
assert.equal(amt.baseline_gate.public_baseline_ready, false);
assert.equal(amtVal.public_baseline_ready, false);

const results = [
  summarize("ADBE", adobe, adobeOut, adobeVal),
  summarize("PFE", pfe, pfeOut, pfeVal),
  summarize("JPM", jpm, jpmOut, jpmVal),
  summarize("XOM", xom, xomOut, xomVal),
  summarize("AMT", amt, amtOut, amtVal),
];

console.log(JSON.stringify({ passed: true, results }, null, 2));
