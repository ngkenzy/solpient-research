import { INDUSTRY_MODULES } from "./industry-modules.mjs";
export { INDUSTRY_MODULES } from "./industry-modules.mjs";

export const SOLPIENT_STANDARD_VERSION = "solpient-v1";

export const REQUIRED_METRIC_KEYS = [
  "revenue_growth_1y",
  "gross_margin",
  "operating_margin",
  "net_margin",
  "operating_cash_flow",
  "free_cash_flow",
  "fcf_margin",
  "fcf_per_share",
  "fcf_conversion",
  "cash",
  "total_debt",
  "net_debt",
  "shares_outstanding",
  "forward_pe",
  "price_to_fcf",
  "fcf_yield"
];

export const RECOMMENDED_METRIC_KEYS = [
  "enterprise_value",
  "ev_to_ebitda",
  "roic",
  "roic_5y_median",
  "incremental_roic",
  "interest_coverage",
  "share_count_growth_1y",
  "share_count_cagr_5y",
  "stock_based_compensation",
  "sbc_to_revenue",
  "sbc_to_fcf",
  "capex_to_revenue",
  "organic_revenue_growth",
];

const REQUIRED_SECTIONS = [
  "business_assessment",
  "metric_observations",
  "risk_register",
  "expected_return_scenarios",
  "thesis_variables",
  "sources",
];

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

export function validateResearchStandard(payload) {
  const notes = [];
  const research = payload?.research ?? {};
  const isV1 = research.standard_version === SOLPIENT_STANDARD_VERSION;

  if (!isV1) {
    return {
      applies: false,
      valid: true,
      status: "legacy",
      completenessPct: null,
      metricCoveragePct: null,
      notes: [],
    };
  }

  const missingSections = REQUIRED_SECTIONS.filter((key) => {
    const value = payload?.[key];
    if (Array.isArray(value)) return value.length === 0;
    return !value || typeof value !== "object";
  });

  if (!hasValue(research.data_cutoff_at)) notes.push("research.data_cutoff_at is missing.");
  if (!hasValue(research.benchmark_ticker)) notes.push("research.benchmark_ticker is missing.");

  const observations = Array.isArray(payload.metric_observations)
    ? payload.metric_observations
    : [];
  const byKey = new Map(observations.map((item) => [item.metric_key, item]));

  const missingMetricRecords = REQUIRED_METRIC_KEYS.filter((key) => !byKey.has(key));
  const unavailableRequired = REQUIRED_METRIC_KEYS.filter((key) => {
    const item = byKey.get(key);
    return item && item.status === "not_available";
  });

  const requestedIndustryModules = Array.isArray(research.industry_modules)
    ? research.industry_modules
    : [];
  const industryMissing = [];
  let industryRequiredCount = 0;
  let industryAvailableCount = 0;

  for (const module of requestedIndustryModules) {
    const definition = INDUSTRY_MODULES[module];
    if (!definition) {
      notes.push("Unknown industry module: " + module + ".");
      industryMissing.push(module + ":unknown");
      continue;
    }
    for (const key of definition.requiredMetricKeys) {
      industryRequiredCount += 1;
      const item = observations.find(
        (row) => row.module === module && row.metric_key === key
      );
      if (!item) {
        industryMissing.push(module + ":" + key);
      } else if (item.status === "available" || item.status === "not_applicable") {
        industryAvailableCount += 1;
      }
    }
  }

  const invalidMetricRows = observations.filter((item) => {
    if (!item?.metric_key || !item?.label) return true;
    if (!["available", "not_available", "not_applicable"].includes(item.status ?? "available")) return true;
    if (!["reported", "derived", "estimate", "assumption", "assessment"].includes(item.basis ?? "reported")) return true;
    if ((item.status ?? "available") === "available" && !hasValue(item.value_numeric) && !hasValue(item.value_text)) return true;
    return false;
  });

  const business = payload.business_assessment ?? {};
  for (const key of [
    "business_quality_rating",
    "moat_rating",
    "bull_thesis",
    "bear_thesis",
    "capital_allocation_test",
    "biggest_unknown",
  ]) {
    if (!hasValue(business[key])) notes.push("business_assessment." + key + " is missing.");
  }

  const risks = Array.isArray(payload.risk_register) ? payload.risk_register : [];
  if (risks.length < 3) notes.push("At least three material risks are required.");

  const expected = Array.isArray(payload.expected_return_scenarios)
    ? payload.expected_return_scenarios
    : [];
  const scenarios = new Set(expected.map((row) => row.scenario + ":" + row.horizon_years));
  for (const horizon of [3, 5, 10]) {
    for (const scenario of ["bear", "base", "bull"]) {
      if (!scenarios.has(scenario + ":" + horizon)) {
        notes.push("Missing expected-return scenario " + scenario + " for " + horizon + " years.");
      }
    }
  }

  const thesis = Array.isArray(payload.thesis_variables) ? payload.thesis_variables : [];
  const monitoredThesis = thesis.filter((item) => hasValue(item.breaker_condition));
  if (monitoredThesis.length < Math.min(3, thesis.length)) {
    notes.push("At least three thesis conditions should include explicit breaker conditions.");
  }

  if (missingSections.length) notes.push("Missing standard sections: " + missingSections.join(", ") + ".");
  if (industryMissing.length) notes.push("Missing industry-module metric records: " + industryMissing.join(", ") + ".");
  if (missingMetricRecords.length) notes.push("Missing required metric records: " + missingMetricRecords.join(", ") + ".");
  if (unavailableRequired.length) notes.push("Required metrics explicitly unavailable: " + unavailableRequired.join(", ") + ".");
  if (invalidMetricRows.length) notes.push("One or more metric observations are invalid.");

  const requiredPresent = REQUIRED_METRIC_KEYS.length - missingMetricRecords.length;
  const availableRequired = REQUIRED_METRIC_KEYS.filter((key) => {
    const item = byKey.get(key);
    if (!item) return false;
    return item.status === "available" || item.status === "not_applicable";
  }).length;

  const structuralChecks = [
    missingSections.length === 0,
    hasValue(research.data_cutoff_at),
    hasValue(research.benchmark_ticker),
    hasValue(business.business_quality_rating),
    hasValue(business.moat_rating),
    risks.length >= 3,
    expected.length >= 9,
    thesis.length >= 3,
    missingMetricRecords.length === 0,
    invalidMetricRows.length === 0,
  ];
  const structuralPct = (structuralChecks.filter(Boolean).length / structuralChecks.length) * 100;
  const metricCoveragePct = REQUIRED_METRIC_KEYS.length
    ? (availableRequired / REQUIRED_METRIC_KEYS.length) * 100
    : 100;

  const industryCoveragePct = industryRequiredCount
    ? (industryAvailableCount / industryRequiredCount) * 100
    : 100;

  const completenessPct = requestedIndustryModules.length
    ? Math.round((structuralPct * 0.5 + metricCoveragePct * 0.3 + industryCoveragePct * 0.2) * 10) / 10
    : Math.round((structuralPct * 0.6 + metricCoveragePct * 0.4) * 10) / 10;

  const valid =
    missingSections.length === 0 &&
    missingMetricRecords.length === 0 &&
    industryMissing.length === 0 &&
    invalidMetricRows.length === 0 &&
    expected.length >= 9 &&
    risks.length >= 3 &&
    thesis.length >= 3;

  return {
    applies: true,
    valid,
    status:
      valid &&
      metricCoveragePct >= 80 &&
      industryCoveragePct >= 80
        ? "complete"
        : "partial",
    completenessPct,
    metricCoveragePct: Math.round(metricCoveragePct * 10) / 10,
    industryModuleCoveragePct: Math.round(industryCoveragePct * 10) / 10,
    requiredMetricRecordsPresent: requiredPresent,
    notes,
  };
}
