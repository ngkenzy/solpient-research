import { industryModuleForTicker, INDUSTRY_MODULES } from "./industry-modules.mjs";
import { REQUIRED_METRIC_KEYS, RECOMMENDED_METRIC_KEYS, validateResearchStandard } from "./research-standard-v1.mjs";

export const BASELINE_FACTORY_VERSION = "baseline-v1";

const PROVIDER_PRIORITY = { sec_companyfacts: 0, fmp: 1, alpha_vantage: 2, unknown: 9 };
const SENSITIVE_QUERY_KEYS = ["apikey", "api_key", "key", "token", "access_token"];

export function sanitizeSourceUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    for (const key of SENSITIVE_QUERY_KEYS) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return value;
  }
}

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ratio(numerator, denominator, scale = 1) {
  const a = n(numerator);
  const b = n(denominator);
  if (a == null || b == null || b === 0) return null;
  return (a / b) * scale;
}

function pctChange(current, previous) {
  const c = n(current);
  const p = n(previous);
  if (c == null || p == null || p === 0) return null;
  return ((c / p) - 1) * 100;
}

function rawIncome(row) {
  return row?.raw_payload?.income ?? {};
}

function rawCash(row) {
  return row?.raw_payload?.cash_flow ?? {};
}

function rawBalance(row) {
  return row?.raw_payload?.balance_sheet ?? {};
}

function valueFromRaw(row, section, key) {
  const source = section === "income" ? rawIncome(row) : section === "balance" ? rawBalance(row) : rawCash(row);
  return n(source?.[key]);
}

function selectFundamentals(rows = []) {
  const sorted = [...rows].sort((a, b) => {
    const byDate = String(b.period_end ?? "").localeCompare(String(a.period_end ?? ""));
    if (byDate !== 0) return byDate;
    return (PROVIDER_PRIORITY[a.provider] ?? 8) - (PROVIDER_PRIORITY[b.provider] ?? 8);
  });

  const seen = new Set();
  return sorted.filter((row) => {
    const key = String(row.period_end ?? "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceTitle(row) {
  const provider = String(row?.provider ?? "provider").toUpperCase();
  const period = [row?.fiscal_period, row?.fiscal_year].filter(Boolean).join(" ");
  return [provider, period || row?.period_end].filter(Boolean).join(" · ");
}

function observation({
  module = "universal",
  metricKey,
  label,
  value,
  unit = null,
  periodEnd = null,
  periodType = null,
  basis = "derived",
  source = null,
  calculationMethod = null,
  notes = null,
}) {
  const available = value !== null && value !== undefined && value !== "";
  return {
    module,
    metric_key: metricKey,
    label,
    value_numeric: typeof value === "number" && Number.isFinite(value) ? value : null,
    value_text: typeof value === "string" ? value : null,
    unit,
    period_end: periodEnd,
    period_type: periodType,
    basis,
    status: available ? "available" : "not_available",
    source_title: source ? sourceTitle(source) : null,
    source_url: sanitizeSourceUrl(source?.source_url),
    calculation_method: calculationMethod,
    notes: available ? notes : (notes ?? "Baseline Factory could not support this metric from the current stored evidence."),
  };
}

function unavailable(module, metricKey, label, notes) {
  return observation({ module, metricKey, label, value: null, basis: "reported", notes });
}

function ttm(rows) {
  const quarters = rows.slice(0, 4);
  if (quarters.length < 4) return null;
  const sum = (key) => {
    const values = quarters.map((row) => n(row[key]));
    return values.some((value) => value == null) ? null : values.reduce((acc, value) => acc + value, 0);
  };
  const rawSum = (section, key) => {
    const values = quarters.map((row) => valueFromRaw(row, section, key));
    return values.some((value) => value == null) ? null : values.reduce((acc, value) => acc + value, 0);
  };

  return {
    rows: quarters,
    revenue: sum("revenue"),
    netIncome: sum("net_income"),
    operatingCashFlow: sum("operating_cash_flow"),
    freeCashFlow: sum("free_cash_flow"),
    capex: quarters.some((row) => n(row.capital_expenditure) == null)
      ? null
      : quarters.reduce((acc, row) => acc + Math.abs(n(row.capital_expenditure)), 0),
    stockBasedCompensation: rawSum("cash", "stockBasedCompensation"),
    researchAndDevelopment: rawSum("income", "researchAndDevelopmentExpenses"),
    operatingIncome: rawSum("income", "operatingIncome"),
    grossProfit: rawSum("income", "grossProfit"),
    dividendsPaid: rawSum("cash", "commonDividendsPaid"),
    shareRepurchases: rawSum("cash", "commonStockRepurchased"),
  };
}

function comparablePrior(rows, latest) {
  if (!latest) return null;
  return rows.find((row) =>
    row.period_end !== latest.period_end &&
    row.fiscal_period === latest.fiscal_period &&
    n(row.fiscal_year) === n(latest.fiscal_year) - 1
  ) ?? null;
}

function moduleObservation(module, key, context) {
  const {
    latest, prior, ttmData, universalByKey,
  } = context;

  const lookup = (metricKey) => universalByKey.get(metricKey)?.value_numeric ?? null;
  const latestRevenue = n(latest?.revenue);
  const currentShares = n(latest?.shares_outstanding);
  const priorShares = n(prior?.shares_outstanding);

  const definitions = {
    rd_to_revenue: () => observation({
      module, metricKey:key, label:"R&D / revenue",
      value: ratio(ttmData?.researchAndDevelopment, ttmData?.revenue, 100),
      unit:"percent", periodEnd:latest?.period_end, periodType:"ttm",
      source:latest, calculationMethod:"TTM research and development expense / TTM revenue.",
    }),
    sbc_to_revenue: () => observation({
      module, metricKey:key, label:"SBC / revenue",
      value: ratio(ttmData?.stockBasedCompensation, ttmData?.revenue, 100),
      unit:"percent", periodEnd:latest?.period_end, periodType:"ttm",
      source:latest, calculationMethod:"TTM stock-based compensation / TTM revenue.",
    }),
    capex_to_revenue: () => observation({
      module, metricKey:key, label:"Capex / revenue",
      value: ratio(ttmData?.capex, ttmData?.revenue, 100),
      unit:"percent", periodEnd:latest?.period_end, periodType:"ttm",
      source:latest, calculationMethod:"Absolute TTM capital expenditures / TTM revenue.",
    }),
    operating_margin: () => observation({
      module, metricKey:key, label:"Operating margin",
      value: ratio(ttmData?.operatingIncome, ttmData?.revenue, 100),
      unit:"percent", periodEnd:latest?.period_end, periodType:"ttm",
      source:latest, calculationMethod:"TTM operating income / TTM revenue.",
    }),
    fcf_conversion: () => observation({
      module, metricKey:key, label:"FCF conversion",
      value: lookup("fcf_conversion"), unit:"percent",
      periodEnd:latest?.period_end, periodType:"ttm",
      source:latest, calculationMethod:"TTM free cash flow / TTM net income.",
    }),
    share_count_change_yoy: () => observation({
      module, metricKey:key, label:"Share-count change YoY",
      value:pctChange(currentShares, priorShares), unit:"percent",
      periodEnd:latest?.period_end, periodType:"quarter",
      source:latest, calculationMethod:"Current comparable-period diluted shares / prior-year comparable period - 1.",
    }),
    revenue_growth: () => observation({
      module, metricKey:key, label:"Revenue growth",
      value:lookup("revenue_growth_1y"), unit:"percent",
      periodEnd:latest?.period_end, periodType:"quarter",
      source:latest, calculationMethod:"Latest quarter revenue versus comparable prior-year quarter.",
    }),
    gross_margin: () => observation({
      module, metricKey:key, label:"Gross margin",
      value:lookup("gross_margin"), unit:"percent",
      periodEnd:latest?.period_end, periodType:"quarter",
      source:latest, calculationMethod:"Quarter gross profit / quarter revenue.",
    }),
  };

  if (definitions[key]) return definitions[key]();
  return unavailable(module, key, key.replaceAll("_", " "), "Industry-specific evidence requires analyst/source enrichment.");
}

function uniqueSources(fundamentals, filings, market) {
  const sources = [];
  const seen = new Set();
  for (const row of fundamentals) {
    const url = sanitizeSourceUrl(row.source_url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({
      source_type: row.form ?? "Fundamental provider",
      title: sourceTitle(row),
      url,
      filing_date: row.filed_at ?? null,
      accession_number: null,
    });
  }
  for (const filing of filings ?? []) {
    const url = sanitizeSourceUrl(filing.filing_url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({
      source_type: filing.form_type ?? "Filing",
      title: filing.title ?? [filing.form_type, filing.filed_at].filter(Boolean).join(" "),
      url,
      filing_date: filing.filed_at ?? null,
      accession_number: filing.accession_number ?? null,
    });
  }
  const marketUrl = sanitizeSourceUrl(market?.source_url);
  if (marketUrl && !seen.has(marketUrl)) {
    sources.push({
      source_type: "Market data",
      title: "Point-in-time market snapshot",
      url: marketUrl,
      filing_date: market?.trading_date ?? null,
      accession_number: null,
    });
  }
  return sources;
}

export function buildBaselineDraft({
  company,
  market,
  fundamentals = [],
  filings = [],
  generatedAt = new Date().toISOString(),
}) {
  if (!company?.ticker) throw new Error("Company ticker is required.");
  const ticker = String(company.ticker).toUpperCase();
  const rows = selectFundamentals(fundamentals);
  const latest = rows[0] ?? null;
  const prior = comparablePrior(rows, latest);
  const ttmData = ttm(rows);
  const module = industryModuleForTicker(ticker);

  const price = n(market?.price);
  const marketCap = n(market?.market_cap);
  const latestRevenue = n(latest?.revenue);
  const grossProfit = valueFromRaw(latest, "income", "grossProfit");
  const operatingIncome = valueFromRaw(latest, "income", "operatingIncome");
  const balance = rawBalance(latest);
  const priorBalance = rawBalance(prior);
  const latestCash = valueFromRaw(latest, "cash", "cashAtEndOfPeriod") ?? n(balance.cashAndCashEquivalents);
  const totalDebt = n(balance.totalDebt);
  const netDebt = totalDebt != null && latestCash != null ? totalDebt - latestCash : null;
  const enterpriseValue = marketCap != null && totalDebt != null && latestCash != null ? marketCap + totalDebt - latestCash : null;
  const currentAssets = n(balance.currentAssets);
  const currentLiabilities = n(balance.currentLiabilities);
  const inventory = n(balance.inventory);
  const equity = n(balance.stockholdersEquity);
  const priorEquity = n(priorBalance.stockholdersEquity);
  const averageEquity = equity != null && priorEquity != null ? (equity + priorEquity) / 2 : equity;
  const retainedEarnings = n(balance.retainedEarnings);
  const currentShares = n(latest?.shares_outstanding);
  const fiveYearPrior = rows.find((row) =>
    row.fiscal_period === latest?.fiscal_period &&
    n(row.fiscal_year) === n(latest?.fiscal_year) - 5
  );
  const fiveYearPriorShares = n(fiveYearPrior?.shares_outstanding);
  const shareCountCagr5y = currentShares != null && fiveYearPriorShares != null && currentShares > 0 && fiveYearPriorShares > 0
    ? (Math.pow(currentShares / fiveYearPriorShares, 1 / 5) - 1) * 100
    : null;

  const universal = [
    observation({
      metricKey:"revenue_growth_1y", label:"Revenue growth",
      value:pctChange(latestRevenue, prior?.revenue), unit:"percent",
      periodEnd:latest?.period_end, periodType:"quarter", source:latest,
      calculationMethod:"Latest quarter revenue versus comparable prior-year quarter.",
    }),
    observation({
      metricKey:"gross_margin", label:"Gross margin",
      value:ratio(grossProfit, latestRevenue, 100), unit:"percent",
      periodEnd:latest?.period_end, periodType:"quarter", source:latest,
      calculationMethod:"Quarter gross profit / quarter revenue.",
    }),
    observation({
      metricKey:"operating_margin", label:"Operating margin",
      value:ratio(operatingIncome, latestRevenue, 100), unit:"percent",
      periodEnd:latest?.period_end, periodType:"quarter", source:latest,
      calculationMethod:"Quarter operating income / quarter revenue.",
    }),
    observation({
      metricKey:"net_margin", label:"Net margin",
      value:ratio(latest?.net_income, latestRevenue, 100), unit:"percent",
      periodEnd:latest?.period_end, periodType:"quarter", source:latest,
      calculationMethod:"Quarter net income / quarter revenue.",
    }),
    observation({
      metricKey:"operating_cash_flow", label:"Operating cash flow",
      value:ttmData?.operatingCashFlow ?? null, unit:"USD",
      periodEnd:latest?.period_end, periodType:"ttm", source:latest,
      calculationMethod:"Sum of the latest four quarterly operating cash-flow observations.",
    }),
    observation({
      metricKey:"free_cash_flow", label:"Free cash flow",
      value:ttmData?.freeCashFlow ?? null, unit:"USD",
      periodEnd:latest?.period_end, periodType:"ttm", source:latest,
      calculationMethod:"Sum of the latest four quarterly free-cash-flow observations.",
    }),
    observation({
      metricKey:"fcf_margin", label:"FCF margin",
      value:ratio(ttmData?.freeCashFlow, ttmData?.revenue, 100), unit:"percent",
      periodEnd:latest?.period_end, periodType:"ttm", source:latest,
      calculationMethod:"TTM free cash flow / TTM revenue.",
    }),
    observation({
      metricKey:"fcf_per_share", label:"FCF per share",
      value:ratio(ttmData?.freeCashFlow, currentShares), unit:"USD/share",
      periodEnd:latest?.period_end, periodType:"ttm", source:latest,
      calculationMethod:"TTM free cash flow / latest diluted share count.",
    }),
    observation({
      metricKey:"fcf_conversion", label:"FCF / net income",
      value:ratio(ttmData?.freeCashFlow, ttmData?.netIncome, 100), unit:"percent",
      periodEnd:latest?.period_end, periodType:"ttm", source:latest,
      calculationMethod:"TTM free cash flow / TTM net income.",
    }),
    observation({
      metricKey:"cash", label:"Cash at period end",
      value:latestCash, unit:"USD",
      periodEnd:latest?.period_end, periodType:"quarter", basis:"reported", source:latest,
      calculationMethod:"Provider cash-flow statement cash at end of period.",
    }),
    observation({
      metricKey:"total_debt", label:"Total debt",
      value:totalDebt, unit:"USD",
      periodEnd:latest?.period_end, periodType:"quarter", basis:"reported", source:latest,
      calculationMethod:"Normalized balance-sheet debt from the highest-priority provider.",
      notes:totalDebt == null ? "No defensible normalized debt value is available for the latest period." : null,
    }),
    observation({
      metricKey:"net_debt", label:"Net debt",
      value:netDebt, unit:"USD",
      periodEnd:latest?.period_end, periodType:"quarter", source:latest,
      calculationMethod:"Total debt less cash and cash equivalents. Short-term investments are excluded unless separately enriched.",
    }),
    observation({
      metricKey:"shares_outstanding", label:"Diluted shares",
      value:currentShares, unit:"shares",
      periodEnd:latest?.period_end, periodType:"quarter", basis:"reported", source:latest,
      calculationMethod:"Provider diluted weighted-average share count.",
    }),
    unavailable("universal","forward_pe","Forward P/E","Forward consensus/guidance estimates are not yet normalized in the Baseline Factory."),
    observation({
      metricKey:"price_to_fcf", label:"Price / FCF",
      value:ratio(marketCap, ttmData?.freeCashFlow), unit:"x",
      periodEnd:market?.trading_date ?? latest?.period_end, periodType:"spot", source:latest,
      calculationMethod:"Point-in-time market capitalization / TTM free cash flow.",
    }),
    observation({
      metricKey:"fcf_yield", label:"FCF yield",
      value:ratio(ttmData?.freeCashFlow, marketCap, 100), unit:"percent",
      periodEnd:market?.trading_date ?? latest?.period_end, periodType:"spot", source:latest,
      calculationMethod:"TTM free cash flow / point-in-time market capitalization.",
    }),
    observation({
      metricKey:"enterprise_value", label:"Enterprise value",
      value:enterpriseValue, unit:"USD",
      periodEnd:market?.trading_date ?? latest?.period_end, periodType:"spot", source:latest,
      calculationMethod:"Market capitalization + total debt - cash and cash equivalents.",
    }),
    unavailable("universal","ev_to_ebitda","EV / EBITDA","Requires normalized enterprise value."),
    unavailable("universal","roic","ROIC","Invested capital is not yet normalized by the Baseline Factory."),
    unavailable("universal","roic_5y_median","5Y median ROIC","Requires multi-year normalized invested-capital history."),
    unavailable("universal","incremental_roic","Incremental ROIC","Requires multi-year normalized invested-capital history."),
    observation({
      metricKey:"interest_coverage", label:"Interest coverage",
      value:ratio(operatingIncome, valueFromRaw(latest,"income","interestExpense")), unit:"x",
      periodEnd:latest?.period_end, periodType:"quarter", source:latest,
      calculationMethod:"Quarter operating income / quarter interest expense.",
    }),
    observation({
      metricKey:"share_count_growth_1y", label:"Share-count growth YoY",
      value:pctChange(currentShares, prior?.shares_outstanding), unit:"percent",
      periodEnd:latest?.period_end, periodType:"quarter", source:latest,
      calculationMethod:"Latest comparable-period diluted shares / prior-year comparable-period diluted shares - 1.",
    }),
    observation({
      metricKey:"share_count_cagr_5y", label:"Share-count CAGR 5Y",
      value:shareCountCagr5y, unit:"percent",
      periodEnd:latest?.period_end, periodType:"five_year", source:latest,
      calculationMethod:"Five-year CAGR in diluted weighted-average shares for comparable fiscal periods.",
    }),
    observation({
      metricKey:"stock_based_compensation", label:"Stock-based compensation",
      value:ttmData?.stockBasedCompensation ?? null, unit:"USD",
      periodEnd:latest?.period_end, periodType:"ttm", source:latest,
      calculationMethod:"Sum of stock-based compensation from the latest four quarterly cash-flow observations.",
    }),
    observation({
      metricKey:"sbc_to_revenue", label:"SBC / revenue",
      value:ratio(ttmData?.stockBasedCompensation, ttmData?.revenue, 100), unit:"percent",
      periodEnd:latest?.period_end, periodType:"ttm", source:latest,
      calculationMethod:"TTM stock-based compensation / TTM revenue.",
    }),
    observation({
      metricKey:"sbc_to_fcf", label:"SBC / FCF",
      value:ratio(ttmData?.stockBasedCompensation, ttmData?.freeCashFlow, 100), unit:"percent",
      periodEnd:latest?.period_end, periodType:"ttm", source:latest,
      calculationMethod:"TTM stock-based compensation / TTM free cash flow.",
    }),
    observation({
      metricKey:"capex_to_revenue", label:"Capex / revenue",
      value:ratio(ttmData?.capex, ttmData?.revenue, 100), unit:"percent",
      periodEnd:latest?.period_end, periodType:"ttm", source:latest,
      calculationMethod:"Absolute TTM capital expenditures / TTM revenue.",
    }),
    unavailable("universal","organic_revenue_growth","Organic revenue growth","Organic growth requires company-specific disclosure and is not inferred from total revenue."),
    observation({
      metricKey:"debt_to_equity", label:"Debt / equity",
      value:ratio(totalDebt,equity), unit:"x",
      periodEnd:latest?.period_end, periodType:"quarter", source:latest,
      calculationMethod:"Total debt / latest stockholders' equity.",
    }),
    observation({
      metricKey:"current_ratio", label:"Current ratio",
      value:ratio(currentAssets,currentLiabilities), unit:"x",
      periodEnd:latest?.period_end, periodType:"quarter", source:latest,
      calculationMethod:"Current assets / current liabilities.",
    }),
    observation({
      metricKey:"quick_ratio", label:"Quick ratio",
      value:currentAssets != null && inventory != null ? ratio(currentAssets-inventory,currentLiabilities) : null, unit:"x",
      periodEnd:latest?.period_end, periodType:"quarter", source:latest,
      calculationMethod:"(Current assets - inventory) / current liabilities.",
    }),
    observation({
      metricKey:"retained_earnings", label:"Retained earnings",
      value:retainedEarnings, unit:"USD",
      periodEnd:latest?.period_end, periodType:"quarter", basis:"reported", source:latest,
      calculationMethod:"Normalized retained earnings / accumulated deficit.",
    }),
    observation({
      metricKey:"roe", label:"Return on equity",
      value:ratio(ttmData?.netIncome,averageEquity,100), unit:"percent",
      periodEnd:latest?.period_end, periodType:"ttm", source:latest,
      calculationMethod:"TTM net income / average comparable-period stockholders' equity when available.",
    }),
    observation({
      metricKey:"payout_ratio", label:"Dividend payout ratio",
      value:ratio(Math.abs(ttmData?.dividendsPaid ?? 0),ttmData?.netIncome,100), unit:"percent",
      periodEnd:latest?.period_end, periodType:"ttm", source:latest,
      calculationMethod:"Absolute TTM common dividends paid / TTM net income.",
    }),
  ];

  const universalByKey = new Map(universal.map((row) => [row.metric_key, row]));
  const moduleRows = [];
  const definition = module ? INDUSTRY_MODULES[module] : null;
  if (definition) {
    for (const key of definition.requiredMetricKeys) {
      moduleRows.push(moduleObservation(module, key, { latest, prior, ttmData, universalByKey }));
    }
  }

  const requiredUniversalRows = REQUIRED_METRIC_KEYS.map((key) => universalByKey.get(key)).filter(Boolean);
  const requiredModuleRows = moduleRows;
  const requiredRows = [...requiredUniversalRows, ...requiredModuleRows];
  const availableRequired = requiredRows.filter((row) =>
    row.status === "available" || row.status === "not_applicable"
  ).length;
  const evidenceCompletenessPct = requiredRows.length
    ? Math.round((availableRequired / requiredRows.length) * 1000) / 10
    : 0;

  const sources = uniqueSources(rows, filings, market);
  const timestamps = [
    market?.observed_at,
    ...rows.map((row) => row.observed_at),
  ].filter(Boolean).sort();
  const sourceCutoffAt = timestamps.at(-1) ?? generatedAt;

  const payload = {
    ticker,
    company_name: company.company_name,
    cik: company.cik ?? null,
    exchange: company.exchange ?? null,
    sector: company.sector ?? null,
    industry: company.industry ?? null,
    description: company.description ?? null,
    research: {
      researched_at: generatedAt,
      data_cutoff_at: sourceCutoffAt,
      standard_version: "solpient-v1",
      benchmark_ticker: "SPY",
      industry_modules: module ? [module] : [],
      price_at_research: price,
      market_cap: marketCap,
      source_period: latest
        ? [latest.fiscal_period, latest.fiscal_year, latest.period_end].filter(Boolean).join(" · ")
        : "No normalized fundamental period available",
      status: "draft",
      summary: "Factory-generated evidence draft. Not published research. Qualitative business assessment, risks, thesis breakers, valuation scenarios and source-specific gaps require review before promotion.",
      full_report: null,
    },
    business_assessment: {
      business_quality_rating: null,
      moat_rating: null,
      pricing_power: null,
      revenue_model: null,
      recurring_revenue_pct: null,
      customer_concentration: null,
      geographic_exposure: null,
      market_position: null,
      growth_runway: null,
      cyclicality: null,
      capital_intensity: null,
      ai_opportunity: null,
      ai_threat: null,
      management_quality: null,
      capital_allocation_assessment: null,
      bull_thesis: null,
      bear_thesis: null,
      capital_allocation_test: null,
      biggest_unknown: null,
      evidence: [],
    },
    metric_observations: [...universal, ...moduleRows],
    risk_register: [],
    expected_return_scenarios: [],
    thesis_variables: [],
    sources,
    scores: {},
    valuations: {},
    ranking: {},
  };

  const validation = validateResearchStandard(payload);
  const evidenceGaps = requiredRows
    .filter((row) => row.status === "not_available")
    .map((row) => ({
      module: row.module,
      metric_key: row.metric_key,
      label: row.label,
      reason: row.notes,
    }));

  payload.factory = {
    generation_version: BASELINE_FACTORY_VERSION,
    generated_at: generatedAt,
    source_cutoff_at: sourceCutoffAt,
    industry_module: module,
    auto_publish: false,
    review_required: true,
    evidence_completeness_pct: evidenceCompletenessPct,
    evidence_gaps: evidenceGaps,
    review_queue: [
      "Verify primary-source provenance and replace provider-only evidence where material.",
      "Complete the business-quality and moat assessment.",
      "Complete missing industry-module evidence.",
      "Build bear/base/bull valuation and expected-return scenarios.",
      "Define material risks and measurable thesis breakers.",
      "Assign scores only after evidence and valuation review.",
      "Run Research Standard v1 validation before publishing.",
    ],
    standard_validation: validation,
  };

  return {
    payload,
    validation,
    evidenceCompletenessPct,
    sourceCutoffAt,
    industryModule: module,
    evidenceSummary: {
      normalized_fundamental_periods: rows.length,
      filing_events: filings?.length ?? 0,
      sources: sources.length,
      required_metrics: requiredRows.length,
      required_metrics_available: availableRequired,
      required_metrics_missing: requiredRows.length - availableRequired,
      market_snapshot_date: market?.trading_date ?? null,
      latest_fundamental_period: latest?.period_end ?? null,
      latest_provider: latest?.provider ?? null,
    },
  };
}
