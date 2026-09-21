import { getSupabase } from "@/lib/supabase";
import { CompanyPerformanceCharts } from "@/components/CompanyPerformanceCharts";

function n(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function monthlyLast<T extends { trading_date?: string; as_of_date?: string }>(rows: T[]) {
  const byMonth = new Map<string, T>();
  for (const row of rows) {
    const date = row.trading_date ?? row.as_of_date;
    if (!date) continue;
    byMonth.set(date.slice(0, 7), row);
  }
  return [...byMonth.values()];
}

async function fetchMarketHistory(
  supabase: any,
  symbol: string,
  companyId?: string | null,
  asOf?: string | null,
) {
  const pageSize = 1000;
  const rows: any[] = [];
  for (let page = 0; page < 4; page++) {
    let query = supabase
      .from("market_snapshots")
      .select("trading_date,price,observed_at")
      .eq("symbol", symbol)
      .order("trading_date", { ascending: true })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (companyId) query = query.eq("company_id", companyId);
    if (asOf) {
      query = query
        .lte("trading_date", asOf.slice(0, 10))
        .lte("observed_at", asOf);
    }
    const { data, error } = await query;
    if (error) break;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

export async function CompanyPerformanceHistory({
  companyId,
  ticker,
  benchmarkTicker = "SPY",
  researchRunId = null,
  asOf = null,
}: {
  companyId: string;
  ticker: string;
  benchmarkTicker?: string;
  researchRunId?: string | null;
  asOf?: string | null;
}) {
  const supabase = getSupabase();
  if (!supabase) return null;

  const cutoffDate = asOf ? asOf.slice(0, 10) : null;

  let metricsQuery = supabase
    .from("company_metric_history")
    .select("metric_key,period_end,fiscal_year,period_type,value_numeric,unit,observed_at")
    .eq("company_id", companyId)
    .eq("period_type", "fiscal_year")
    .in("metric_key", [
      "revenue",
      "free_cash_flow",
      "gross_margin",
      "operating_margin",
      "fcf_margin",
      "eps_diluted",
      "fcf_per_share",
      "shares_outstanding",
    ]);
  let valuationQuery = supabase
    .from("valuation_history")
    .select("trading_date,price_to_fcf,fcf_yield,pe,forward_pe,observed_at")
    .eq("company_id", companyId);
  let capitalQuery = supabase
    .from("company_metric_history")
    .select("module,metric_key,period_end,fiscal_year,period_type,value_numeric,observed_at")
    .eq("company_id", companyId)
    .in("metric_key", ["dividends_paid","buybacks","stock_based_compensation","acquisitions","debt_issued","debt_repaid"]);
  let peerQuery = supabase
    .from("peer_metric_snapshots")
    .select("peer_ticker,metric_key,as_of_date,value_numeric,observed_at")
    .eq("company_id", companyId)
    .in("metric_key", ["revenue_growth_yoy","fcf_margin","price_to_fcf","fcf_yield"]);

  if (asOf) {
    metricsQuery = metricsQuery.lte("observed_at", asOf);
    valuationQuery = valuationQuery.lte("observed_at", asOf);
    capitalQuery = capitalQuery.lte("observed_at", asOf);
    peerQuery = peerQuery.lte("observed_at", asOf);
  }
  if (cutoffDate) {
    metricsQuery = metricsQuery.lte("period_end", cutoffDate);
    valuationQuery = valuationQuery.lte("trading_date", cutoffDate);
    capitalQuery = capitalQuery.lte("period_end", cutoffDate);
    peerQuery = peerQuery.lte("as_of_date", cutoffDate);
  }

  const [
    marketRows,
    benchmarkRows,
    metricsResult,
    valuationResult,
    capitalResult,
    peerMetricResult,
    runResult,
    historicalFactsResult,
  ] = await Promise.all([
    fetchMarketHistory(supabase, ticker, companyId, asOf),
    fetchMarketHistory(supabase, benchmarkTicker, null, asOf),
    metricsQuery.order("fiscal_year", { ascending: true }),
    valuationQuery.order("trading_date", { ascending: true }).limit(2000),
    capitalQuery.order("period_end", { ascending: true }),
    peerQuery.order("as_of_date", { ascending: false }),
    researchRunId
      ? supabase.from("research_runs").select("id").eq("id", researchRunId).maybeSingle()
      : supabase
          .from("research_runs")
          .select("id")
          .eq("company_id", companyId)
          .eq("status", "published")
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
    asOf && researchRunId
      ? supabase.rpc("get_public_research_history_as_of_v1", {
          p_research_run_id: researchRunId,
        })
      : Promise.resolve({ data: null, error: null }),
  ]);

  const market = monthlyLast(
    marketRows
      .map((row: any) => ({ date: row.trading_date, trading_date: row.trading_date, price: n(row.price) }))
      .filter((row: any) => row.price != null),
  ).map((row: any) => ({ date: row.date, price: row.price }));

  const benchmark = monthlyLast(
    benchmarkRows
      .map((row: any) => ({ date: row.trading_date, trading_date: row.trading_date, price: n(row.price) }))
      .filter((row: any) => row.price != null),
  ).map((row: any) => ({ date: row.date, price: row.price }));

  const historicalMode = Boolean(asOf && researchRunId);
  const canonicalFacts = historicalMode && !historicalFactsResult.error
    ? (historicalFactsResult.data ?? [])
    : [];

  // Historical research must not depend on mutable/current projection rows.
  // In historical mode we fail closed to the canonical bitemporal read model.
  const canonicalAnnualRows = canonicalFacts
    .filter((row: any) =>
      row.module === "universal" &&
      row.economic_period_type === "fiscal_year" &&
      row.economic_period_end
    )
    .map((row: any) => ({
      metric_key: row.metric_key,
      period_end: row.economic_period_end,
      fiscal_year: Number(String(row.economic_period_end).slice(0, 4)),
      period_type: "fiscal_year",
      value_numeric: row.value_numeric,
      unit: row.unit,
      observed_at: row.known_at,
    }));

  const metricRows = historicalMode ? canonicalAnnualRows : (metricsResult.data ?? []);

  const annualMap = new Map<number, Record<string, number | null>>();
  for (const row of metricRows) {
    const year = Number(row.fiscal_year);
    if (!Number.isInteger(year)) continue;
    const bucket = annualMap.get(year) ?? {};
    bucket[row.metric_key] = n(row.value_numeric);
    annualMap.set(year, bucket);
  }

  const annual = [...annualMap.entries()]
    .map(([year, values]) => ({
      year,
      revenue: values.revenue ?? null,
      freeCashFlow: values.free_cash_flow ?? null,
      grossMargin: values.gross_margin ?? null,
      operatingMargin: values.operating_margin ?? null,
      fcfMargin: values.fcf_margin ?? null,
      eps: values.eps_diluted ?? null,
      fcfPerShare: values.fcf_per_share ?? null,
      shares: values.shares_outstanding ?? null,
    }))
    .filter((row) => (row.revenue ?? 0) > 0)
    .slice(-6);

  const canonicalValuationByDate = new Map<string, any>();
  for (const row of canonicalFacts.filter((item: any) => item.module === "valuation_history")) {
    const date = row.economic_period_end;
    if (!date) continue;
    const bucket = canonicalValuationByDate.get(date) ?? { trading_date: date };
    bucket[row.metric_key] = n(row.value_numeric);
    canonicalValuationByDate.set(date, bucket);
  }

  const valuationRows = historicalMode
    ? [...canonicalValuationByDate.values()].sort((a, b) =>
        String(a.trading_date).localeCompare(String(b.trading_date)),
      )
    : (valuationResult.data ?? []);

  const valuation = monthlyLast(
    valuationRows.map((row: any) => ({
      ...row,
      price_to_fcf: n(row.price_to_fcf),
      fcf_yield: n(row.fcf_yield),
      pe: n(row.pe),
      forward_pe: n(row.forward_pe),
    })),
  ).map((row: any) => ({
    date: row.trading_date,
    priceToFcf: row.price_to_fcf,
    fcfYield: row.fcf_yield,
    pe: row.pe,
    forwardPe: row.forward_pe,
  }));

  const metricToCapitalKey: Record<string, string> = {
    dividends_paid: "dividends",
    buybacks: "buybacks",
    stock_based_compensation: "sbc",
    acquisitions: "acquisitions",
    debt_issued: "debtIssued",
    debt_repaid: "debtRepaid",
  };
  const annualCapital = new Map<number, Record<string, number | null>>();
  const quarterlyCapital = new Map<number, Record<string, number>>();

  const capitalRows = historicalMode
    ? canonicalFacts
        .filter((row: any) =>
          row.module === "universal" &&
          ["dividends_paid","buybacks","stock_based_compensation","acquisitions","debt_issued","debt_repaid"].includes(row.metric_key) &&
          row.economic_period_end
        )
        .map((row: any) => ({
          metric_key: row.metric_key,
          period_end: row.economic_period_end,
          fiscal_year: Number(String(row.economic_period_end).slice(0, 4)),
          period_type: row.economic_period_type,
          value_numeric: row.value_numeric,
          observed_at: row.known_at,
        }))
    : (capitalResult.data ?? []);

  for (const row of capitalRows) {
    const year = Number(row.fiscal_year);
    const key = metricToCapitalKey[row.metric_key];
    const value = n(row.value_numeric);
    if (!Number.isInteger(year) || !key || value == null) continue;

    if (row.period_type === "fiscal_year") {
      const bucket = annualCapital.get(year) ?? {};
      bucket[key] = value;
      annualCapital.set(year, bucket);
    } else if (row.period_type === "quarter") {
      const bucket = quarterlyCapital.get(year) ?? {};
      bucket[key] = (bucket[key] ?? 0) + value;
      quarterlyCapital.set(year, bucket);
    }
  }

  const capitalYears = [...new Set([
    ...annualCapital.keys(),
    ...quarterlyCapital.keys(),
  ])].sort((a, b) => a - b);

  const latestCapitalYear = capitalYears.at(-1);
  const completeCapitalYears = capitalYears.filter((year) => {
    const annualValues = annualCapital.get(year) ?? {};
    const quarterValues = quarterlyCapital.get(year) ?? {};
    const hasAnnualCashReturn = annualValues.dividends != null || annualValues.buybacks != null;
    const hasCurrentYtdCashReturn =
      year === latestCapitalYear &&
      (quarterValues.dividends != null || quarterValues.buybacks != null);
    return hasAnnualCashReturn || hasCurrentYtdCashReturn;
  });

  const capital = completeCapitalYears.map((year) => {
    const annualValues = annualCapital.get(year) ?? {};
    const quarterValues = quarterlyCapital.get(year) ?? {};
    const merged: Record<string, number | null> = {};
    for (const key of Object.values(metricToCapitalKey)) {
      merged[key] = annualValues[key] ?? quarterValues[key] ?? null;
    }
    const hasAnnualCashReturn = annualValues.dividends != null || annualValues.buybacks != null;
    return {
      period: hasAnnualCashReturn ? "FY" + year : year + " YTD",
      periodEnd: null,
      year,
      dividends: merged.dividends ?? null,
      buybacks: merged.buybacks ?? null,
      sbc: merged.sbc ?? null,
      acquisitions: merged.acquisitions ?? null,
      debtIssued: merged.debtIssued ?? null,
      debtRepaid: merged.debtRepaid ?? null,
      shares: null,
    };
  });

  const canonicalPeerRows = canonicalFacts
    .filter((row: any) => String(row.module ?? "").startsWith("peer:"))
    .map((row: any) => ({
      peer_ticker: String(row.module).slice(5),
      metric_key: row.metric_key,
      as_of_date: row.economic_period_end,
      value_numeric: row.value_numeric,
      observed_at: row.known_at,
    }))
    .sort((a: any, b: any) =>
      String(b.as_of_date ?? "").localeCompare(String(a.as_of_date ?? "")),
    );

  const peerRows = historicalMode ? canonicalPeerRows : (peerMetricResult.data ?? []);

  const peerMap = new Map<string, any>();
  for (const row of peerRows) {
    const peer = peerMap.get(row.peer_ticker) ?? {
      ticker: row.peer_ticker,
      revenueGrowth: null,
      fcfMargin: null,
      priceToFcf: null,
      fcfYield: null,
    };
    if (row.metric_key === "revenue_growth_yoy" && peer.revenueGrowth == null) peer.revenueGrowth = n(row.value_numeric);
    if (row.metric_key === "fcf_margin" && peer.fcfMargin == null) peer.fcfMargin = n(row.value_numeric);
    if (row.metric_key === "price_to_fcf" && peer.priceToFcf == null) peer.priceToFcf = n(row.value_numeric);
    if (row.metric_key === "fcf_yield" && peer.fcfYield == null) peer.fcfYield = n(row.value_numeric);
    peerMap.set(row.peer_ticker, peer);
  }

  let selfMetrics: any = null;
  if (runResult.data?.id) {
    const { data } = await supabase
      .from("financial_metrics")
      .select("revenue_growth_1y,fcf_margin")
      .eq("research_run_id", runResult.data.id)
      .maybeSingle();
    selfMetrics = data;
  }

  const latestValuation = valuation.at(-1);
  const peers = [
    {
      ticker,
      revenueGrowth: n(selfMetrics?.revenue_growth_1y),
      fcfMargin: n(selfMetrics?.fcf_margin),
      priceToFcf: latestValuation?.priceToFcf ?? null,
      fcfYield: latestValuation?.fcfYield ?? null,
    },
    ...[...peerMap.values()].sort((a, b) => a.ticker.localeCompare(b.ticker)),
  ];

  return (
    <section className="companyPerformanceSection">
      <div className="historicalHeading">
        <div>
          <span className="panelKicker">MARKET + FUNDAMENTAL HISTORY</span>
          <h2>Performance over time</h2>
          <p className="historicalHint">
            Price performance, business economics, valuation, capital allocation, and peer context from the stored point-in-time research database.
            {historicalMode ? " Historical research is reconstructed only from facts known by that research cutoff." : ""}
          </p>
        </div>
        <div className="historicalSummaryStats">
          <div><span>Price history</span><strong>{market.length ? "10Y" : "—"}</strong></div>
          <div><span>Annual periods</span><strong>{annual.length}</strong></div>
          <div><span>Valuation points</span><strong>{valuation.length}</strong></div>
        </div>
      </div>

      <CompanyPerformanceCharts
        ticker={ticker}
        benchmarkTicker={benchmarkTicker}
        market={market}
        benchmark={benchmark}
        annual={annual}
        valuation={valuation}
        capital={capital}
        peers={peers}
      />
    </section>
  );
}
