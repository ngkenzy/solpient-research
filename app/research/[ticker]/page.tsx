import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { ConsumerHeader } from "@/components/ConsumerHeader";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/* Pure metric helpers. The same logic (JS version) is covered by the   */
/* node test in scripts/test-research-page-metrics.mjs — keep them in   */
/* sync if either changes.                                              */
/* ------------------------------------------------------------------ */

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function field(row: Record<string, unknown> | null | undefined, key: string): number | null {
  if (row == null) return null;
  return asNumber(row[key]);
}

function rawPath(obj: unknown, keys: string[]): number | null {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[k];
  }
  return asNumber(cur);
}

type FundSnap = {
  period_end: string;
  form: string | null;
  revenue: number | null;
  net_income: number | null;
  free_cash_flow: number | null;
  eps_diluted: number | null;
  gross_profit: number | null;
  operating_income: number | null;
};

function normalizeFundSnap(row: Record<string, unknown>): FundSnap {
  return {
    period_end: typeof row?.period_end === "string" ? (row.period_end as string) : "",
    form: typeof row?.form === "string" ? (row.form as string) : null,
    revenue: field(row, "revenue"),
    net_income: field(row, "net_income"),
    free_cash_flow: field(row, "free_cash_flow"),
    eps_diluted: field(row, "eps_diluted") ?? rawPath(row?.raw_payload, ["income", "eps_diluted"]),
    gross_profit:
      field(row, "gross_profit") ?? rawPath(row?.raw_payload, ["income", "grossProfit"]),
    operating_income:
      field(row, "operating_income") ??
      rawPath(row?.raw_payload, ["income", "operatingIncome"]),
  };
}

function dedupePeriods(rows: FundSnap[]): FundSnap[] {
  const byPeriod = new Map<string, FundSnap>();
  for (const r of rows) {
    if (!r.period_end) continue;
    const existing = byPeriod.get(r.period_end);
    if (!existing) {
      byPeriod.set(r.period_end, r);
    } else if (existing.form !== "10-Q" && r.form === "10-Q") {
      byPeriod.set(r.period_end, r);
    }
  }
  return [...byPeriod.values()].sort((a, b) =>
    a.period_end < b.period_end ? 1 : a.period_end > b.period_end ? -1 : 0,
  );
}

function sumQuarterlyWindow(
  series: FundSnap[],
  get: (s: FundSnap) => number | null,
  start: number,
  count: number,
): number | null {
  const window = series.slice(start, start + count);
  if (window.length < count) return null;
  if (window.some((s) => s.form !== "10-Q")) return null;
  let total = 0;
  for (const s of window) {
    const v = get(s);
    if (v == null) return null;
    total += v;
  }
  return total;
}

function latestAnnual(
  series: FundSnap[],
  get: (s: FundSnap) => number | null,
): number | null {
  const row = series.find((s) => s.form === "10-K");
  return row ? get(row) : null;
}

function ttmField(
  series: FundSnap[],
  get: (s: FundSnap) => number | null,
): number | null {
  const quarterly = sumQuarterlyWindow(series, get, 0, 4);
  if (quarterly != null) return quarterly;
  return latestAnnual(series, get);
}

function yoyPct(
  series: FundSnap[],
  get: (s: FundSnap) => number | null,
): number | null {
  const current = sumQuarterlyWindow(series, get, 0, 4);
  const prior = sumQuarterlyWindow(series, get, 4, 4);
  if (current != null && prior != null && prior !== 0) {
    return ((current - prior) / Math.abs(prior)) * 100;
  }
  const annuals = series.filter((s) => s.form === "10-K");
  const a0 = annuals[0] ? get(annuals[0]) : null;
  const a1 = annuals[1] ? get(annuals[1]) : null;
  if (a0 != null && a1 != null && a1 !== 0) {
    return ((a0 - a1) / Math.abs(a1)) * 100;
  }
  return null;
}

function pctOf(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

function priceMultiple(price: number | null, perShare: number | null): number | null {
  if (price == null || perShare == null || perShare === 0) return null;
  return price / perShare;
}

type MktSnap = Record<string, unknown>;

function dayChangePct(marketRows: MktSnap[]): number | null {
  const latest = marketRows[0];
  if (!latest) return null;
  const price = asNumber(latest.price);
  const reference =
    asNumber(latest.previous_close) ?? asNumber(marketRows[1]?.price);
  if (price == null || reference == null || reference === 0) return null;
  return ((price - reference) / Math.abs(reference)) * 100;
}

function highLow52w(marketRows: MktSnap[]): { high: number; low: number } | null {
  const latest = marketRows[0];
  const tradingDate = typeof latest?.trading_date === "string" ? latest.trading_date : null;
  if (!tradingDate) return null;
  const cutoff = new Date(tradingDate + "T00:00:00Z").getTime() - 365 * 86400000;
  const prices: number[] = [];
  for (const row of marketRows) {
    const td = typeof row?.trading_date === "string" ? row.trading_date : null;
    if (!td) continue;
    if (new Date(td + "T00:00:00Z").getTime() < cutoff) continue;
    const p = asNumber(row.price);
    if (p != null) prices.push(p);
  }
  if (prices.length === 0) return null;
  return { high: Math.max(...prices), low: Math.min(...prices) };
}

function analystTarget(row: MktSnap | null | undefined): number | null {
  if (!row) return null;
  const raw = (row.raw_payload ?? {}) as Record<string, unknown>;
  return (
    asNumber(raw.analyst_target) ??
    asNumber(raw.analyst_price_target) ??
    asNumber(raw.price_target) ??
    null
  );
}

function dividendYield(row: MktSnap | null | undefined): number | null {
  if (!row) return null;
  const raw = (row.raw_payload ?? {}) as Record<string, unknown>;
  return asNumber(raw.dividend_yield_ttm) ?? asNumber(raw.dividend_yield) ?? null;
}

function targetGapPct(target: number | null, price: number | null): number | null {
  if (target == null || price == null || price === 0) return null;
  return ((target - price) / Math.abs(price)) * 100;
}

/* ------------------------------------------------------------------ */
/* Formatting (same approach as the previous page: plain Intl helpers).  */
/* ------------------------------------------------------------------ */

function formatMoney(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCompactMoney(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatNumber(value: number | null | undefined, suffix = "") {
  if (value == null) return "—";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}${suffix}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value + "T00:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC",
  });
}

function formatResearchDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
  });
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function changeValue(change: {
  old_value?: number | null;
  new_value?: number | null;
  old_text?: string | null;
  new_text?: string | null;
}) {
  if (change.old_value != null || change.new_value != null) {
    return `${formatNumber(change.old_value)} → ${formatNumber(change.new_value)}`;
  }
  if (change.old_text || change.new_text) {
    return `${change.old_text ?? "New"} → ${change.new_text ?? "Removed"}`;
  }
  return null;
}

function coverageLabel(level: string | null | undefined): string {
  switch (level) {
    case "DEEP_COVERAGE":
      return "Deep Coverage";
    case "RESEARCHED":
      return "Researched";
    case "MONITORED":
      return "Monitored";
    default:
      return "Monitored";
  }
}

/* ------------------------------------------------------------------ */
/* Small presentational components (existing CSS classes only).         */
/* ------------------------------------------------------------------ */

function Metric({
  label,
  value,
  asOf,
  tone,
}: {
  label: string;
  value: string;
  asOf?: string;
  tone?: "up" | "down";
}) {
  return (
    <article className="headlineMetric">
      <span>{label}</span>
      <strong
        className={
          tone === "up" ? "positiveText" : tone === "down" ? "negativeText" : undefined
        }
      >
        {value}
      </strong>
      {asOf ? <small>{asOf}</small> : null}
    </article>
  );
}

function MetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="metricTile">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default async function CompanyResearch({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { ticker: rawTicker } = await params;
  const { version: requestedVersion } = await searchParams;
  const ticker = rawTicker.toUpperCase();
  const supabase = getSupabase();

  if (!supabase) {
    return (
      <main className="researchShell">
        <Link className="backLink" href="/research">← Research</Link>
        <section className="emptyState">
          <strong>Supabase is not configured.</strong>
          <p>Add the public Supabase URL and publishable key to the app environment.</p>
        </section>
      </main>
    );
  }

  const { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("ticker", ticker)
    .maybeSingle();

  if (!company) notFound();

  /* ---- market + fundamental snapshots (independent of research runs) ---- */
  const [marketResult, fundamentalResult, coverageResult] = await Promise.all([
    supabase
      .from("market_snapshots")
      .select("price,previous_close,trading_date,market_cap,provider,observed_at,raw_payload")
      .eq("symbol", company.ticker)
      .order("trading_date", { ascending: false })
      .limit(260),
    supabase
      .from("fundamental_snapshots")
      .select(
        "period_end,fiscal_year,fiscal_period,form,filed_at,revenue,net_income,operating_cash_flow,capital_expenditure,free_cash_flow,shares_outstanding,eps_diluted,provider,raw_payload",
      )
      .eq("company_id", company.id)
      .order("period_end", { ascending: false })
      .limit(16),
    // research_coverage_states is service_role-only; this read is best-effort
    // and falls back to run-based logic below.
    supabase
      .from("research_coverage_states")
      .select("coverage_level,evaluated_at")
      .eq("company_id", company.id)
      .maybeSingle(),
  ]);

  const marketRows = (marketResult.data ?? []) as MktSnap[];
  const latestMarket = marketRows[0] ?? null;
  const price = asNumber(latestMarket?.price);
  const dayChange = dayChangePct(marketRows);
  const marketCap = asNumber(latestMarket?.market_cap);
  const range52w = highLow52w(marketRows);
  const target = analystTarget(latestMarket);
  const targetGap = targetGapPct(target, price);
  const divYield = dividendYield(latestMarket);
  const marketAsOf =
    typeof latestMarket?.trading_date === "string"
      ? `As of ${formatDate(latestMarket.trading_date)}`
      : undefined;

  const fundSeries = dedupePeriods(
    ((fundamentalResult.data ?? []) as Record<string, unknown>[]).map(normalizeFundSnap),
  );
  const revenueTtm = ttmField(fundSeries, (s) => s.revenue);
  const revenueYoY = yoyPct(fundSeries, (s) => s.revenue);
  const epsTtm = ttmField(fundSeries, (s) => s.eps_diluted);
  const grossTtm = ttmField(fundSeries, (s) => s.gross_profit);
  const opIncTtm = ttmField(fundSeries, (s) => s.operating_income);
  const fcfTtm = ttmField(fundSeries, (s) => s.free_cash_flow);
  const peTtm = priceMultiple(price, epsTtm);
  const grossMargin = pctOf(grossTtm, revenueTtm);
  const opMargin = pctOf(opIncTtm, revenueTtm);
  const fundAsOf = fundSeries[0]?.period_end
    ? `TTM to ${formatDate(fundSeries[0].period_end)}`
    : undefined;

  /* ---- research run (optional) ---- */
  let runQuery = supabase
    .from("research_runs")
    .select("*")
    .eq("company_id", company.id)
    .eq("status", "published");

  if (requestedVersion) {
    const parsedVersion = Number(requestedVersion);
    if (!Number.isInteger(parsedVersion) || parsedVersion < 1) notFound();
    runQuery = runQuery.eq("version", parsedVersion);
  } else {
    runQuery = runQuery.order("version", { ascending: false }).limit(1);
  }

  const { data: run } = await runQuery.maybeSingle();

  const coverageLevel =
    coverageResult.data?.coverage_level ??
    (run ? "RESEARCHED" : "MONITORED");

  const headerBadge = (
    <span className="versionStatus">{coverageLabel(coverageLevel)}</span>
  );

  const metricsGrid = (
    <section className="headlineGrid" aria-label="Key metrics">
      <Metric label="Price" value={formatMoney(price)} asOf={marketAsOf} />
      <Metric
        label="Day change"
        value={dayChange == null ? "—" : `${dayChange >= 0 ? "+" : ""}${dayChange.toFixed(2)}%`}
        asOf={marketAsOf}
        tone={dayChange == null ? undefined : dayChange >= 0 ? "up" : "down"}
      />
      <Metric label="Market cap" value={formatCompactMoney(marketCap)} asOf={marketAsOf} />
      <Metric label="P/E (TTM)" value={formatNumber(peTtm, "×")} asOf={fundAsOf} />
      <Metric label="EPS (TTM)" value={formatMoney(epsTtm)} asOf={fundAsOf} />
      <Metric label="Revenue (TTM)" value={formatCompactMoney(revenueTtm)} asOf={fundAsOf} />
      <Metric
        label="Revenue growth (YoY)"
        value={revenueYoY == null ? "—" : `${revenueYoY >= 0 ? "+" : ""}${revenueYoY.toFixed(1)}%`}
        asOf={fundAsOf}
        tone={revenueYoY == null ? undefined : revenueYoY >= 0 ? "up" : "down"}
      />
      <Metric label="Gross margin (TTM)" value={formatNumber(grossMargin, "%")} asOf={fundAsOf} />
      <Metric label="Operating margin (TTM)" value={formatNumber(opMargin, "%")} asOf={fundAsOf} />
      <Metric label="Free cash flow (TTM)" value={formatCompactMoney(fcfTtm)} asOf={fundAsOf} />
      <Metric
        label="Dividend yield"
        value={divYield == null ? "—" : `${divYield.toFixed(2)}%`}
        asOf={marketAsOf}
      />
      <Metric
        label="52-week range"
        value={
          range52w == null
            ? "—"
            : `${formatMoney(range52w.low)} – ${formatMoney(range52w.high)}`
        }
        asOf={marketAsOf}
      />
      <Metric
        label="Analyst target"
        value={formatMoney(target)}
        asOf={marketAsOf}
      />
      <Metric
        label="Target gap"
        value={
          targetGap == null
            ? "—"
            : `${targetGap >= 0 ? "+" : ""}${targetGap.toFixed(1)}%`
        }
        asOf={marketAsOf}
        tone={targetGap == null ? undefined : targetGap >= 0 ? "up" : "down"}
      />
    </section>
  );

  /* ---- no published research: metrics only ---- */
  if (!run) {
    return (
      <>
        <ConsumerHeader active="research" subtitle="Research" />
        <main className="researchShell">
          <Link className="backLink" href="/research">← All research</Link>

          <section className="researchHero">
            <div className="researchHeroCopy">
              <div className="eyebrow">{company.exchange ?? "EQUITY"} · {company.ticker}</div>
              <h1>{company.company_name}</h1>
              <p className="heroDescription">
                {company.description ?? "Company profile pending."}
              </p>
            </div>
            <aside className="versionPanel">
              <span>COVERAGE</span>
              {headerBadge}
            </aside>
          </section>

          {metricsGrid}

          <section className="emptyState">
            <strong>Full Solpient Research isn&apos;t available yet.</strong>
            <p>
              {company.ticker} is being monitored for market and fundamental data.
              A published research version will unlock the thesis, valuation, and
              change history sections.
            </p>
          </section>
        </main>
      </>
    );
  }

  /* ---- published run: thesis, changes, valuation, sources, history ---- */
  const [
    valuationResult,
    thesisResult,
    sourcesResult,
    historyResult,
    changesResult,
    v2Result,
  ] = await Promise.all([
    supabase.from("valuations").select("*").eq("research_run_id", run.id).maybeSingle(),
    supabase.from("thesis_variables").select("*").eq("research_run_id", run.id).order("created_at"),
    supabase.from("sources").select("*").eq("research_run_id", run.id).order("retrieved_at", { ascending: false }),
    supabase
      .from("research_runs")
      .select("id,version,researched_at,price_at_research,status")
      .eq("company_id", company.id)
      .eq("status", "published")
      .order("version", { ascending: false }),
    supabase
      .from("research_changes")
      .select("*")
      .eq("current_run_id", run.id)
      .order("category")
      .order("created_at"),
    supabase
      .from("research_v2_sections")
      .select("final_conclusion")
      .eq("research_run_id", run.id)
      .maybeSingle(),
  ]);

  const valuation = valuationResult.data;
  const thesis = thesisResult.data ?? [];
  const sources = sourcesResult.data ?? [];
  const history = historyResult.data ?? [];
  const changes = changesResult.data ?? [];
  const finalConclusion = (v2Result.data?.final_conclusion ?? {}) as Record<string, unknown>;

  const strengthened = thesis.filter((item) => item.status === "strengthened");
  const weakened = thesis.filter((item) => item.status === "weakened");
  const unchanged = thesis.filter((item) => item.status === "unchanged");
  const monitoring = thesis.filter(
    (item) => item.status === "monitor" || item.status === "unknown",
  );
  const riskVariables = thesis.filter((item) =>
    ["weakened", "monitor", "unknown"].includes(item.status ?? ""),
  );
  const impairmentRisks =
    typeof finalConclusion.impairment_risks === "string"
      ? (finalConclusion.impairment_risks as string)
      : null;

  const bearValue = asNumber(valuation?.bear_value);
  const baseValue = asNumber(valuation?.base_value);
  const bullValue = asNumber(valuation?.bull_value);
  const valuationGap =
    price != null && baseValue != null && baseValue !== 0
      ? ((baseValue - price) / baseValue) * 100
      : null;
  const valuationGapLabel =
    valuationGap == null
      ? "—"
      : Math.abs(valuationGap) < 1
        ? "Near fair value"
        : valuationGap > 0
          ? `${valuationGap.toFixed(1)}% undervalued`
          : `${Math.abs(valuationGap).toFixed(1)}% overvalued`;

  const rangeMin = Math.min(
    ...(bearValue != null ? [bearValue] : []),
    ...(price != null ? [price] : []),
    ...(baseValue != null ? [baseValue] : []),
    ...(bullValue != null ? [bullValue] : []),
  );
  const rangeMax = Math.max(
    ...(bearValue != null ? [bearValue] : []),
    ...(price != null ? [price] : []),
    ...(baseValue != null ? [baseValue] : []),
    ...(bullValue != null ? [bullValue] : []),
  );
  const hasValuationRange =
    Number.isFinite(rangeMin) && Number.isFinite(rangeMax) && rangeMax > rangeMin;
  const position = (value: number | null) => {
    if (!hasValuationRange || value == null) return 0;
    return clamp(((value - rangeMin) / (rangeMax - rangeMin)) * 100);
  };

  return (
    <>
      <ConsumerHeader active="research" subtitle="Research" />

      <main className="researchShell">
        <Link className="backLink" href="/research">← All research</Link>

        {/* 1. Header */}
        <section className="researchHero">
          <div className="researchHeroCopy">
            <div className="heroMeta">
              <span>{company.exchange ?? "EQUITY"}</span>
              {company.sector ? <span>{company.sector}</span> : null}
              {company.industry ? <span>{company.industry}</span> : null}
            </div>
            <div className="tickerLine">
              <div className="tickerMark">{company.ticker.slice(0, 2)}</div>
              <div>
                <div className="eyebrow">{company.ticker}</div>
                <h1>{company.company_name}</h1>
              </div>
            </div>
            <div className="heroThesis">
              <span>Latest price</span>
              <p>
                {formatMoney(price)}
                {dayChange != null ? (
                  <span
                    className={dayChange >= 0 ? "positiveText" : "negativeText"}
                  >
                    {" "}
                    {dayChange >= 0 ? "+" : ""}
                    {dayChange.toFixed(2)}%
                  </span>
                ) : null}
                {marketAsOf ? <small> · {marketAsOf}</small> : null}
              </p>
            </div>
          </div>
          <aside className="versionPanel">
            <span>COVERAGE</span>
            {headerBadge}
            <small>Research v{run.version}</small>
            <small>{formatResearchDate(run.researched_at)}</small>
          </aside>
        </section>

        {/* 2. Metrics grid */}
        {metricsGrid}

        {/* 3. Current Thesis */}
        <section className="dashboardPanel">
          <div className="panelHeader">
            <div>
              <span className="panelKicker">CURRENT THESIS</span>
              <h2>Research view · v{run.version}</h2>
            </div>
            <small>{thesis.length} tracked conditions</small>
          </div>
          <p>{run.summary ?? "Research summary pending."}</p>
          <div className="signalSummary">
            <div className="signalCount positiveSignal">
              <strong>{strengthened.length}</strong>
              <span>Strengthened</span>
            </div>
            <div className="signalCount neutralSignal">
              <strong>{unchanged.length}</strong>
              <span>Unchanged</span>
            </div>
            <div className="signalCount negativeSignal">
              <strong>{weakened.length}</strong>
              <span>Weakened</span>
            </div>
            <div className="signalCount neutralSignal">
              <strong>{monitoring.length}</strong>
              <span>Monitoring</span>
            </div>
          </div>
          <div className="thesisCompactList">
            {thesis.map((item) => (
              <div className="thesisCompactRow" key={item.id}>
                <span className={`signalDot ${item.status ?? "unknown"}`} />
                <div>
                  <strong>{item.variable_name}</strong>
                  <small>{item.observed_value ?? item.expectation ?? "Evidence pending."}</small>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 4. What Changed (deterministic research_changes ledger) */}
        <section className="dashboardPanel changeSection">
          <div className="panelHeader">
            <div>
              <span className="panelKicker">VERSION CONTROL</span>
              <h2>What changed</h2>
            </div>
            <small>vs. prior research</small>
          </div>

          {run.version === 1 ? (
            <div className="baselineNote">
              <strong>Baseline research version.</strong>
              <p>Version 1 establishes the starting thesis. Change detection begins with Version 2.</p>
            </div>
          ) : changes.length > 0 ? (
            <div className="changeList">
              {changes.map((change) => (
                <article className="changeRow" key={change.id}>
                  <div className="changeMeta">
                    <span className="changeCategory">{change.category}</span>
                    <span className={`changeDirection ${change.direction ?? "unknown"}`}>
                      {change.direction ?? change.change_type}
                    </span>
                  </div>
                  <div className="changeBody">
                    <strong>{change.label}</strong>
                    <p>{change.summary}</p>
                    {changeValue(change) ? <small>{changeValue(change)}</small> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="baselineNote">
              <strong>No material changes detected.</strong>
              <p>The current version did not cross SOLPIENT&apos;s deterministic change thresholds.</p>
            </div>
          )}
        </section>

        {/* 5. Valuation */}
        <section className="dashboardPanel valuationPanel">
          <div className="panelHeader">
            <div>
              <span className="panelKicker">VALUATION</span>
              <h2>Scenario range</h2>
            </div>
            <small>Bear / Base / Bull</small>
          </div>

          {hasValuationRange ? (
            <div className="valuationGraphic">
              <div className="valuationRail">
                {bearValue != null ? (
                  <i className="valuationDot bearDot" style={{ left: `${position(bearValue)}%` }} />
                ) : null}
                {baseValue != null ? (
                  <i className="valuationDot baseDot" style={{ left: `${position(baseValue)}%` }} />
                ) : null}
                {bullValue != null ? (
                  <i className="valuationDot bullDot" style={{ left: `${position(bullValue)}%` }} />
                ) : null}
                {price != null ? (
                  <i className="valuationPrice" style={{ left: `${position(price)}%` }}>
                    <span>Price</span>
                  </i>
                ) : null}
              </div>
              <div className="valuationLabels">
                <div><span>Bear</span><strong>{formatMoney(bearValue)}</strong></div>
                <div><span>Base</span><strong>{formatMoney(baseValue)}</strong></div>
                <div><span>Bull</span><strong>{formatMoney(bullValue)}</strong></div>
              </div>
            </div>
          ) : (
            <p className="muted">Valuation scenarios are not available for this version.</p>
          )}

          <div className="mosGrid">
            <MetricTile label="Valuation gap" value={valuationGapLabel} />
            <MetricTile label="25% MOS" value={formatMoney(valuation?.mos_25_price)} />
            <MetricTile label="35% MOS" value={formatMoney(valuation?.mos_35_price)} />
            <MetricTile label="50% MOS" value={formatMoney(valuation?.mos_50_price)} />
          </div>
        </section>

        {/* 6. Key Risks / Evidence / History */}
        <details className="dashboardPanel">
          <summary className="panelHeader">
            <div>
              <span className="panelKicker">KEY RISKS</span>
              <h2>What could break the thesis</h2>
            </div>
          </summary>
          {riskVariables.length > 0 || impairmentRisks ? (
            <div className="thesisCompactList">
              {impairmentRisks ? (
                <div className="thesisCompactRow">
                  <span className="signalDot weakened" />
                  <div>
                    <strong>Impairment risks</strong>
                    <small>{impairmentRisks}</small>
                  </div>
                </div>
              ) : null}
              {riskVariables.map((item) => (
                <div className="thesisCompactRow" key={item.id}>
                  <span className={`signalDot ${item.status ?? "unknown"}`} />
                  <div>
                    <strong>{item.variable_name}</strong>
                    <small>{item.observed_value ?? item.expectation ?? "Evidence pending."}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No key risks are currently flagged.</p>
          )}
        </details>

        <details className="dashboardPanel sourcePanel">
          <summary className="panelHeader">
            <div>
              <span className="panelKicker">EVIDENCE LEDGER</span>
              <h2>Primary sources</h2>
            </div>
            <small>{sources.length} sources</small>
          </summary>
          <div className="sourceList">
            {sources.map((source) => (
              <div className="sourceRow" key={source.id}>
                <div>
                  <strong>{source.title}</strong>
                  <span>
                    {source.source_type}
                    {source.filing_date ? ` · ${new Date(source.filing_date).toLocaleDateString("en-US")}` : ""}
                  </span>
                </div>
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer" aria-label={`Open ${source.title}`}>
                    ↗
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </details>

        <details className="dashboardPanel historyPanel">
          <summary className="panelHeader">
            <div>
              <span className="panelKicker">RESEARCH LEDGER</span>
              <h2>Version history</h2>
            </div>
          </summary>
          <div className="historyList">
            {history.map((item) => (
              <Link
                className={`historyRow ${item.version === run.version ? "activeVersion" : ""}`}
                href={`/research/${company.ticker}?version=${item.version}`}
                key={item.id}
              >
                <div>
                  <strong>Version {item.version}</strong>
                  <small>{formatResearchDate(item.researched_at)}</small>
                </div>
                <span>{formatMoney(item.price_at_research)}</span>
              </Link>
            ))}
          </div>
        </details>

        <details className="fullResearchPanel">
          <summary className="panelHeader">
            <div>
              <span className="panelKicker">FULL RESEARCH</span>
              <h2>Investment memo</h2>
            </div>
            <span className="researchVersionStamp">Version {run.version}</span>
          </summary>
          <p className="researchSummary">{run.summary ?? "Summary pending."}</p>
          <div className="fullReport">
            {run.full_report ? run.full_report : "Full report pending."}
          </div>
        </details>
      </main>
    </>
  );
}
