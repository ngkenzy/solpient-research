export type ResearchAIPack = {
  packVersion: "research-ai-pack-v1";
  company: {
    ticker: string;
    name: string;
    exchange: string | null;
    sector: string | null;
    industry: string | null;
  };
  research: {
    runId: string;
    version: number | null;
    researchedAt: string | null;
    cutoffAt: string | null;
    priceAtResearch: number | null;
  };
  scores: Record<string, number | null>;
  valuation: Record<string, number | null>;
  metrics: Record<string, number | null>;
  thesis: Array<{
    name: string;
    expectation: string | null;
    observedValue: string | null;
    status: string | null;
    evidence: string | null;
    metricKey: string | null;
    thresholdValue: number | null;
    thresholdUnit: string | null;
    breakerCondition: string | null;
  }>;
  changes: Array<{
    category: string | null;
    label: string | null;
    direction: string | null;
    materiality: string | null;
    summary: string | null;
    oldValue: number | null;
    newValue: number | null;
    oldText: string | null;
    newText: string | null;
  }>;
  triggers: Array<{
    label: string | null;
    group: string | null;
    status: string | null;
    severity: string | null;
    currentValue: number | null;
    currentText: string | null;
    thresholdValue: number | null;
    thresholdUnit: string | null;
    effect: string | null;
    rationale: string | null;
  }>;
  sources: Array<{
    ref: string;
    type: string | null;
    title: string | null;
    filingDate: string | null;
    retrievedAt: string | null;
  }>;
};

function num(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickNumbers(row: Record<string, unknown> | null | undefined, keys: string[]) {
  const out: Record<string, number | null> = {};
  for (const key of keys) out[key] = num(row?.[key]);
  return out;
}

export function buildResearchAIPack(input: {
  company: Record<string, any>;
  run: Record<string, any>;
  scores?: Record<string, any> | null;
  valuation?: Record<string, any> | null;
  metrics?: Record<string, any> | null;
  thesis?: Array<Record<string, any>>;
  changes?: Array<Record<string, any>>;
  triggers?: Array<Record<string, any>>;
  sources?: Array<Record<string, any>>;
}): ResearchAIPack {
  return {
    packVersion: "research-ai-pack-v1",
    company: {
      ticker: String(input.company.ticker ?? ""),
      name: String(input.company.company_name ?? input.company.ticker ?? ""),
      exchange: input.company.exchange ?? null,
      sector: input.company.sector ?? null,
      industry: input.company.industry ?? null,
    },
    research: {
      runId: String(input.run.id),
      version: Number.isInteger(Number(input.run.version)) ? Number(input.run.version) : null,
      researchedAt: input.run.researched_at ?? null,
      cutoffAt: input.run.data_cutoff_at ?? input.run.researched_at ?? null,
      priceAtResearch: num(input.run.price_at_research),
    },
    scores: pickNumbers(input.scores, [
      "quality_score",
      "growth_score",
      "valuation_score",
      "financial_strength_score",
      "moat_score",
      "thesis_integrity_score",
      "overall_score",
    ]),
    valuation: pickNumbers(input.valuation, [
      "dcf_value",
      "owner_earnings_value",
      "earnings_multiple_value",
      "historical_multiple_value",
      "peer_value",
      "bear_value",
      "base_value",
      "bull_value",
      "mos_25_price",
      "mos_35_price",
      "mos_50_price",
      "discount_rate",
      "terminal_growth",
      "revenue_growth_assumption",
      "margin_assumption",
    ]),
    metrics: pickNumbers(input.metrics, [
      "revenue",
      "revenue_growth_1y",
      "revenue_cagr_5y",
      "gross_margin",
      "operating_margin",
      "net_margin",
      "free_cash_flow",
      "fcf_growth",
      "fcf_margin",
      "cash",
      "total_debt",
      "current_ratio",
      "debt_to_equity",
      "roe",
      "roic",
      "eps",
      "eps_growth_1y",
      "shares_outstanding",
      "pe",
      "forward_pe",
      "price_to_fcf",
      "fcf_yield",
    ]),
    thesis: (input.thesis ?? []).slice(0, 12).map((row) => ({
      name: String(row.variable_name ?? "Thesis variable"),
      expectation: row.expectation ?? null,
      observedValue: row.observed_value ?? null,
      status: row.status ?? null,
      evidence: row.evidence ?? null,
      metricKey: row.metric_key ?? null,
      thresholdValue: num(row.threshold_value),
      thresholdUnit: row.threshold_unit ?? null,
      breakerCondition: row.breaker_condition ?? null,
    })),
    changes: (input.changes ?? []).slice(0, 12).map((row) => ({
      category: row.category ?? null,
      label: row.label ?? null,
      direction: row.direction ?? null,
      materiality: row.materiality ?? null,
      summary: row.summary ?? null,
      oldValue: num(row.old_value),
      newValue: num(row.new_value),
      oldText: row.old_text ?? null,
      newText: row.new_text ?? null,
    })),
    triggers: (input.triggers ?? []).slice(0, 12).map((row) => ({
      label: row.label ?? null,
      group: row.trigger_group ?? null,
      status: row.evaluation_status ?? null,
      severity: row.severity ?? null,
      currentValue: num(row.current_value),
      currentText: row.current_text ?? null,
      thresholdValue: num(row.threshold_value),
      thresholdUnit: row.threshold_unit ?? null,
      effect: row.decision_effect ?? null,
      rationale: row.rationale ?? null,
    })),
    sources: (input.sources ?? []).slice(0, 16).map((row, index) => ({
      ref: "S" + String(index + 1),
      type: row.source_type ?? null,
      title: row.title ?? null,
      filingDate: row.filing_date ?? null,
      retrievedAt: row.retrieved_at ?? null,
    })),
  };
}
