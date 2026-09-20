import assert from "node:assert/strict";
import { buildResearchChanges } from "../lib/research-changes.mjs";

const base = {
  companyId: "company-1",
  currentRunId: "run-2",
  previousRun: { id: "run-1", price_at_research: 100 },
  previousMetrics: {
    revenue_growth_1y: 10,
    gross_margin: 80,
    total_debt: 100,
  },
  previousScores: {
    overall_score: 80,
    quality_score: 90,
  },
  previousValuation: {
    base_value: 150,
    bear_value: 120,
  },
  previousThesis: [
    {
      variable_name: "AI monetization",
      status: "unchanged",
      observed_value: "Early traction",
      expectation: "AI should increase monetization",
    },
  ],
};

const changedPayload = {
  research: { price_at_research: 104 },
  financial_metrics: {
    revenue_growth_1y: 12,
    gross_margin: 80.2,
    total_debt: 105,
  },
  scores: {
    overall_score: 84,
    quality_score: 91,
  },
  valuations: {
    base_value: 160,
    bear_value: 121,
  },
  thesis_variables: [
    {
      variable_name: "AI monetization",
      status: "strengthened",
      observed_value: "Material ARR growth",
      expectation: "AI should increase monetization",
    },
  ],
};

const changes = buildResearchChanges({ ...base, payload: changedPayload });

assert.ok(
  changes.some((c) => c.category === "market" && c.metric_key === "price_at_research"),
  "4% price change should be detected"
);

assert.ok(
  changes.some((c) => c.category === "financial" && c.metric_key === "revenue_growth_1y"),
  "2pp revenue-growth change should be detected"
);

assert.ok(
  !changes.some((c) => c.metric_key === "gross_margin"),
  "0.2pp gross-margin change should stay below threshold"
);

assert.ok(
  !changes.some((c) => c.metric_key === "total_debt"),
  "5% debt change should stay below 10% threshold"
);

assert.ok(
  changes.some((c) => c.category === "score" && c.metric_key === "overall_score"),
  "4-point overall-score change should be detected"
);

assert.ok(
  !changes.some((c) => c.metric_key === "quality_score"),
  "1-point quality-score change should stay below threshold"
);

assert.ok(
  changes.some((c) => c.category === "valuation" && c.metric_key === "base_value"),
  "6.7% base-value change should be detected"
);

assert.ok(
  !changes.some((c) => c.metric_key === "bear_value"),
  "0.8% bear-value change should stay below threshold"
);

assert.ok(
  changes.some(
    (c) =>
      c.category === "thesis" &&
      c.metric_key === "thesis:ai monetization" &&
      c.change_type === "status"
  ),
  "Thesis status change should be detected"
);

const unchangedPayload = {
  research: { price_at_research: 100 },
  financial_metrics: { ...base.previousMetrics },
  scores: { ...base.previousScores },
  valuations: { ...base.previousValuation },
  thesis_variables: base.previousThesis.map((item) => ({ ...item })),
};

const unchanged = buildResearchChanges({ ...base, payload: unchangedPayload });

assert.equal(
  unchanged.length,
  0,
  "Identical versions must not create false-positive change records"
);

assert.deepEqual(
  buildResearchChanges({
    ...base,
    previousRun: null,
    payload: changedPayload,
  }),
  [],
  "Version 1 must be treated as the baseline with no change records"
);

console.log(`Version change engine passed: ${changes.length} material changes detected in test fixture.`);
