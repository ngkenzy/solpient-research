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
) {
  const pageSize = 1000;
  const rows: any[] = [];
  for (let page = 0; page < 4; page++) {
    let query = supabase
      .from("market_snapshots")
      .select("trading_date,price")
      .eq("symbol", symbol)
      .order("trading_date", { ascending: true })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (companyId) query = query.eq("company_id", companyId);
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
}: {
  companyId: string;
  ticker: string;
  benchmarkTicker?: string;
}) {
  const supabase = getSupabase();
  if (!supabase) return null;

  const [
    marketRows,
    benchmarkRows,
    metricsResult,
    valuationResult,
    capitalResult,
    peerMetricResult,
    runResult,
  ] = await Promise.all([
    fetchMarketHistory(supabase, ticker, companyId),
    fetchMarketHistory(supabase, benchmarkTicker),
    supabase
      .from("company_metric_history")
      .select("metric_key,period_end,fiscal_year,period_type,value_numeric,unit")
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
      ])
      .order("fiscal_year", { ascending: true }),
    supabase
      .from("valuation_history")
      .select("trading_date,price_to_fcf,fcf_yield,pe,forward_pe")
      .eq("company_id", companyId)
      .order("trading_date", { ascending: true })
      .limit(2000),
    supabase
      .from("capital_allocation_history")
      .select("fiscal_year,period_end,dividends_paid,buybacks,stock_based_compensation,acquisitions,debt_issued,debt_repaid,ending_share_count")
      .eq("company_id", companyId)
      .order("period_end", { ascending: true }),
    supabase
      .from("peer_metric_snapshots")
      .select("peer_ticker,metric_key,as_of_date,value_numeric")
      .eq("company_id", companyId)
      .in("metric_key", ["revenue_growth_yoy","fcf_margin","price_to_fcf","fcf_yield"])
      .order("as_of_date", { ascending: false }),
    supabase
      .from("research_runs")
      .select("id")
      .eq("company_id", companyId)
      .eq("status", "published")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
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

  const annualMap = new Map<number, Record<string, number | null>>();
  for (const row of metricsResult.data ?? []) {
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

  const valuation = monthlyLast(
    (valuationResult.data ?? []).map((row: any) => ({
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

  const quarterLabel = (periodEnd: string | null | undefined, fiscalYear: number) => {
    if (!periodEnd) return String(fiscalYear);
    const month = Number(periodEnd.slice(5, 7));
    const quarter = month === 3 ? "Q1" : month === 6 ? "Q2" : month === 9 ? "Q3" : month === 12 ? "Q4" : "";
    return quarter ? quarter + " " + fiscalYear : periodEnd.slice(0, 7);
  };

  const capital = (capitalResult.data ?? []).map((row: any) => ({
    period: quarterLabel(row.period_end, Number(row.fiscal_year)),
    periodEnd: row.period_end,
    year: Number(row.fiscal_year),
    dividends: n(row.dividends_paid),
    buybacks: n(row.buybacks),
    sbc: n(row.stock_based_compensation),
    acquisitions: n(row.acquisitions),
    debtIssued: n(row.debt_issued),
    debtRepaid: n(row.debt_repaid),
    shares: n(row.ending_share_count),
  }));

  const peerMap = new Map<string, any>();
  for (const row of peerMetricResult.data ?? []) {
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
      .select("revenue_growth,fcf_margin")
      .eq("research_run_id", runResult.data.id)
      .maybeSingle();
    selfMetrics = data;
  }

  const latestValuation = valuation.at(-1);
  const peers = [
    {
      ticker,
      revenueGrowth: n(selfMetrics?.revenue_growth),
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
