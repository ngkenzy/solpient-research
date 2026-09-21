import { validateResearchStandard } from "./research-standard.mjs";

function clone(value) {
  return structuredClone(value ?? {});
}

function numeric(value) {
  if(value===null||value===undefined||(typeof value==="string"&&value.trim()==="")) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeObjects(base, patch) {
  return { ...(base ?? {}), ...(patch ?? {}) };
}

function mergeMetrics(base = [], patch = []) {
  const map = new Map();
  for (const row of base) map.set(`${row.module ?? "universal"}:${row.metric_key}`, clone(row));
  for (const row of patch) {
    if (!row?.metric_key) continue;
    const key = `${row.module ?? "universal"}:${row.metric_key}`;
    map.set(key, mergeObjects(map.get(key), row));
  }
  return [...map.values()];
}

function mergeSources(base = [], patch = []) {
  const map = new Map();
  for (const source of [...base, ...patch]) {
    const key = [source?.url ?? "", source?.title ?? "", source?.source_type ?? ""].join("|");
    if (!key.replaceAll("|", "")) continue;
    map.set(key, clone(source));
  }
  return [...map.values()];
}

export function materializeFinancialMetrics(payload) {
  const observations = Array.isArray(payload?.metric_observations) ? payload.metric_observations : [];
  const universal = new Map(
    observations
      .filter((row) => (row.module ?? "universal") === "universal")
      .map((row) => [row.metric_key, row])
  );

  const value = (key) => {
    const row = universal.get(key);
    if (!row || row.status !== "available") return null;
    return numeric(row.value_numeric);
  };

  return {
    revenue_growth_1y: value("revenue_growth_1y"),
    gross_margin: value("gross_margin"),
    operating_margin: value("operating_margin"),
    net_margin: value("net_margin"),
    operating_cash_flow: value("operating_cash_flow"),
    free_cash_flow: value("free_cash_flow"),
    fcf_margin: value("fcf_margin"),
    cash: value("cash"),
    total_debt: value("total_debt"),
    shares_outstanding: value("shares_outstanding"),
    forward_pe: value("forward_pe"),
    price_to_fcf: value("price_to_fcf"),
    fcf_yield: value("fcf_yield"),
  };
}

export function mergeReviewPatches(basePatch = {}, nextPatch = {}) {
  const result = clone(basePatch);
  for (const key of ["research", "business_assessment", "scores", "valuations", "ranking", "financial_metrics", "investment_thesis", "financial_quality", "competitive_position", "valuation_analysis", "historical_valuation", "investment_lenses", "decision_dashboard", "final_conclusion"]) {
    if (nextPatch[key] && typeof nextPatch[key] === "object" && !Array.isArray(nextPatch[key])) {
      result[key] = mergeObjects(result[key], nextPatch[key]);
    }
  }
  if (Array.isArray(nextPatch.metric_observations)) result.metric_observations = mergeMetrics(result.metric_observations ?? [], nextPatch.metric_observations);
  for (const key of ["risk_register", "expected_return_scenarios", "thesis_variables", "fundamental_scorecard"]) {
    if (Array.isArray(nextPatch[key])) result[key] = clone(nextPatch[key]);
  }
  if (Array.isArray(nextPatch.sources)) result.sources = mergeSources(result.sources ?? [], nextPatch.sources);
  return result;
}

export function applyReviewPatch(basePayload, reviewPatch = {}) {
  const result = clone(basePayload);

  for (const key of ["research", "business_assessment", "scores", "valuations", "ranking", "financial_metrics", "investment_thesis", "financial_quality", "competitive_position", "valuation_analysis", "historical_valuation", "investment_lenses", "decision_dashboard", "final_conclusion"]) {
    if (reviewPatch[key] && typeof reviewPatch[key] === "object" && !Array.isArray(reviewPatch[key])) {
      result[key] = mergeObjects(result[key], reviewPatch[key]);
    }
  }

  if (Array.isArray(reviewPatch.metric_observations)) {
    result.metric_observations = mergeMetrics(
      Array.isArray(result.metric_observations) ? result.metric_observations : [],
      reviewPatch.metric_observations
    );
  }

  for (const key of ["risk_register", "expected_return_scenarios", "thesis_variables", "fundamental_scorecard"]) {
    if (Array.isArray(reviewPatch[key])) result[key] = clone(reviewPatch[key]);
  }

  if (Array.isArray(reviewPatch.sources)) {
    result.sources = mergeSources(
      Array.isArray(result.sources) ? result.sources : [],
      reviewPatch.sources
    );
  }

  result.financial_metrics = {
    ...materializeFinancialMetrics(result),
    ...(result.financial_metrics ?? {}),
  };

  if (result.research) result.research.status = "draft";
  if (result.prediction) delete result.prediction;
  return result;
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function hasNumber(value) {
  return numeric(value) !== null;
}

export function validatePromotionReadiness(payload) {
  const standard = validateResearchStandard(payload);
  const blockers = [];

  if (!standard.valid) blockers.push("Research Standard structural validation has not passed.");
  if (standard.status !== "complete") blockers.push("Research Standard status must be complete before promotion.");
  if (standard.applies && standard.decisionGradeReady === false) {
    blockers.push(...(standard.decisionGradeBlockers ?? ["Decision-grade evidence requirements have not passed."]));
  }

  const summary = payload?.research?.summary;
  if (!hasText(summary) || summary.includes("Factory-generated evidence draft")) {
    blockers.push("Replace the factory placeholder with a reviewed research summary.");
  }

  const business = payload?.business_assessment ?? {};
  for (const key of [
    "business_quality_rating","moat_rating","pricing_power","revenue_model",
    "market_position","growth_runway","management_quality","capital_allocation_assessment",
    "bull_thesis","bear_thesis","capital_allocation_test","biggest_unknown",
  ]) {
    if (!hasText(business[key])) blockers.push("Complete business assessment: " + key + ".");
  }

  const scores = payload?.scores ?? {};
  for (const key of [
    "quality_score","growth_score","valuation_score","financial_strength_score",
    "moat_score","thesis_integrity_score","overall_score",
  ]) {
    if (!hasNumber(scores[key])) blockers.push("Assign reviewed score: " + key + ".");
  }

  const valuations = payload?.valuations ?? {};
  for (const key of ["bear_value","base_value","bull_value"]) {
    if (!hasNumber(valuations[key])) blockers.push("Complete reviewed valuation: " + key + ".");
  }

  const risks = Array.isArray(payload?.risk_register) ? payload.risk_register : [];
  if (risks.filter((row) => hasText(row?.thesis_breaker)).length < 3) {
    blockers.push("At least three risks need explicit thesis breakers.");
  }

  const thesis = Array.isArray(payload?.thesis_variables) ? payload.thesis_variables : [];
  if (thesis.filter((row) => hasText(row?.breaker_condition)).length < 3) {
    blockers.push("At least three thesis conditions need explicit breaker conditions.");
  }

  const sources = Array.isArray(payload?.sources) ? payload.sources : [];
  const hasPrimary = sources.some((source) =>
    hasText(source?.url) &&
    String(source.url).includes("sec.gov") &&
    /10-K|10-Q|8-K/i.test(String(source?.source_type ?? ""))
  );
  if (!hasPrimary) blockers.push("Verify at least one material primary SEC filing source before promotion.");
  if (payload?.prediction) blockers.push("Predictions must be locked separately after research publication.");

  return { ready: blockers.length === 0, standard, blockers };
}

export function defaultReviewTemplate(payload) {
  const business = payload?.business_assessment ?? {};
  return {
    research: { summary: "", full_report: "" },
    business_assessment: {
      business_quality_rating: business.business_quality_rating ?? "",
      moat_rating: business.moat_rating ?? "",
      pricing_power: business.pricing_power ?? "",
      revenue_model: business.revenue_model ?? "",
      recurring_revenue_pct: business.recurring_revenue_pct ?? null,
      customer_concentration: business.customer_concentration ?? "",
      geographic_exposure: business.geographic_exposure ?? "",
      market_position: business.market_position ?? "",
      growth_runway: business.growth_runway ?? "",
      cyclicality: business.cyclicality ?? "",
      capital_intensity: business.capital_intensity ?? "",
      ai_opportunity: business.ai_opportunity ?? "",
      ai_threat: business.ai_threat ?? "",
      management_quality: business.management_quality ?? "",
      capital_allocation_assessment: business.capital_allocation_assessment ?? "",
      bull_thesis: business.bull_thesis ?? "",
      bear_thesis: business.bear_thesis ?? "",
      capital_allocation_test: business.capital_allocation_test ?? "",
      biggest_unknown: business.biggest_unknown ?? "",
      evidence: business.evidence ?? [],
    },
    metric_observations: [],
    scores: {
      quality_score: null, growth_score: null, valuation_score: null,
      financial_strength_score: null, moat_score: null,
      thesis_integrity_score: null, overall_score: null,
    },
    valuations: {
      bear_value: null, base_value: null, bull_value: null, dcf_value: null,
      owner_earnings_value: null, earnings_multiple_value: null,
      historical_multiple_value: null, peer_value: null, mos_25_price: null,
      mos_35_price: null, mos_50_price: null, discount_rate: null,
      terminal_growth: null, revenue_growth_assumption: null, margin_assumption: null,
    },
    risk_register: [],
    thesis_variables: [],
    expected_return_scenarios: [],
    sources: [],
  };
}
