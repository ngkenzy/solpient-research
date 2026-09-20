import assert from "node:assert/strict";
import { validateResearchStandard, REQUIRED_METRIC_KEYS, INDUSTRY_MODULES } from "../lib/research-standard-v1.mjs";

const observations = REQUIRED_METRIC_KEYS.map((metric_key) => ({
  metric_key,
  label: metric_key,
  value_numeric: 1,
  status: "available",
  basis: "reported",
}));

const payload = {
  research: {
    standard_version: "solpient-v1",
    data_cutoff_at: "2026-09-20T00:00:00Z",
    benchmark_ticker: "SPY",
  },
  business_assessment: {
    business_quality_rating: "strong",
    moat_rating: "narrow",
    bull_thesis: "Bull",
    bear_thesis: "Bear",
    capital_allocation_test: "Test",
    biggest_unknown: "Unknown",
  },
  metric_observations: observations,
  risk_register: [
    { risk_key: "a" },
    { risk_key: "b" },
    { risk_key: "c" },
  ],
  expected_return_scenarios: [3,5,10].flatMap((horizon_years) =>
    ["bear","base","bull"].map((scenario) => ({ scenario, horizon_years }))
  ),
  thesis_variables: [
    { variable_name: "a", breaker_condition: "a" },
    { variable_name: "b", breaker_condition: "b" },
    { variable_name: "c", breaker_condition: "c" },
  ],
  sources: [{ title: "Primary source" }],
};

const result = validateResearchStandard(payload);
assert.equal(result.valid, true);
assert.equal(result.status, "complete");
assert.equal(result.metricCoveragePct, 100);

const consumer = structuredClone(payload);
consumer.research.industry_modules = ["consumer_brand"];
consumer.metric_observations = [
  ...consumer.metric_observations,
  ...INDUSTRY_MODULES.consumer_brand.requiredMetricKeys.map((metric_key) => ({
    module: "consumer_brand",
    metric_key,
    label: metric_key,
    value_numeric: 1,
    status: "available",
    basis: "reported",
  })),
];
const consumerResult = validateResearchStandard(consumer);
assert.equal(consumerResult.valid, true);
assert.equal(consumerResult.industryModuleCoveragePct, 100);

const brokenConsumer = structuredClone(consumer);
brokenConsumer.metric_observations = brokenConsumer.metric_observations.filter(
  (row) => row.metric_key !== "inventory_growth_yoy"
);
assert.equal(validateResearchStandard(brokenConsumer).valid, false);

const broken = structuredClone(payload);
broken.metric_observations = broken.metric_observations.filter((row) => row.metric_key !== "fcf_yield");
const brokenResult = validateResearchStandard(broken);
assert.equal(brokenResult.valid, false);

console.log("Research Standard v1 validation tests passed.");
