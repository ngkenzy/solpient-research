import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { HistoricalFinancials } from "@/components/HistoricalFinancials";
import { CompanyIntelligence } from "@/components/CompanyIntelligence";
import { ResearchControls } from "@/components/ResearchControls";
import { PredictionHistory } from "@/components/PredictionHistory";
import { SolpientBrand } from "@/components/SolpientBrand";
import { ResearchStandardV1 } from "@/components/ResearchStandardV1";

export const dynamic = "force-dynamic";

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

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

function ScoreRing({ label, value }: { label: string; value: number | null }) {
  const score = value == null ? 0 : clamp(value);
  const angle = score * 3.6;

  return (
    <div className="scoreRingWrap">
      <div
        className="scoreRing"
        style={{
          background: `conic-gradient(#58d68d 0deg ${angle}deg, #232833 ${angle}deg 360deg)`,
        }}
      >
        <div className="scoreRingInner">
          <strong>{value == null ? "—" : Math.round(value)}</strong>
        </div>
      </div>
      <div>
        <span>{label}</span>
        <small>{value == null ? "Pending" : value >= 85 ? "Strong" : value >= 70 ? "Solid" : "Watch"}</small>
      </div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  const score = value == null ? 0 : clamp(value);

  return (
    <div className="scoreBarRow">
      <span>{label}</span>
      <strong>{value == null ? "—" : Math.round(value)}</strong>
      <div className="scoreTrack" aria-hidden="true">
        <i style={{ width: `${score}%` }} />
      </div>
    </div>
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

  if (!run) {
    return (
      <main className="researchShell">
        <Link className="backLink" href="/research">← Research</Link>
        <section className="companyHeader">
          <div>
            <div className="eyebrow">{company.exchange ?? "EQUITY"} · {company.ticker}</div>
            <h1>{company.company_name}</h1>
            <p>{company.description ?? "Company profile pending."}</p>
          </div>
        </section>
        <section className="emptyState">
          <strong>No published research found.</strong>
          <p>The requested research version does not exist or has not been published.</p>
        </section>
      </main>
    );
  }

  const [
    scoresResult,
    valuationResult,
    metricsResult,
    thesisResult,
    sourcesResult,
    historyResult,
    changesResult,
  ] = await Promise.all([
    supabase.from("scores").select("*").eq("research_run_id", run.id).maybeSingle(),
    supabase.from("valuations").select("*").eq("research_run_id", run.id).maybeSingle(),
    supabase.from("financial_metrics").select("*").eq("research_run_id", run.id).maybeSingle(),
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
  ]);

  const { data: latestMarket } = await supabase
    .from("market_snapshots")
    .select("price,trading_date,provider")
    .eq("symbol", company.ticker)
    .order("trading_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const scores = scoresResult.data;
  const valuation = valuationResult.data;
  const metrics = metricsResult.data;
  const thesis = thesisResult.data ?? [];
  const sources = sourcesResult.data ?? [];
  const history = historyResult.data ?? [];
  const changes = changesResult.data ?? [];
  const isLatest = history[0]?.version === run.version;

  const researchPrice = asNumber(run.price_at_research);
  const currentPrice = asNumber(latestMarket?.price) ?? researchPrice;
  const price = currentPrice;
  const bearValue = asNumber(valuation?.bear_value);
  const baseValue = asNumber(valuation?.base_value);
  const bullValue = asNumber(valuation?.bull_value);
  const upside = price != null && baseValue != null && price !== 0
    ? ((baseValue / price) - 1) * 100
    : null;
  const valuationGap = price != null && baseValue != null && baseValue !== 0
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
    ...(bullValue != null ? [bullValue] : [])
  );
  const rangeMax = Math.max(
    ...(bearValue != null ? [bearValue] : []),
    ...(price != null ? [price] : []),
    ...(baseValue != null ? [baseValue] : []),
    ...(bullValue != null ? [bullValue] : [])
  );
  const hasValuationRange = Number.isFinite(rangeMin) && Number.isFinite(rangeMax) && rangeMax > rangeMin;
  const position = (value: number | null) => {
    if (!hasValuationRange || value == null) return 0;
    return clamp(((value - rangeMin) / (rangeMax - rangeMin)) * 100);
  };

  const strengthened = thesis.filter((item) => item.status === "strengthened");
  const weakened = thesis.filter((item) => item.status === "weakened");
  const unchanged = thesis.filter((item) => item.status === "unchanged");

  const scoreRows = [
    ["Business quality", asNumber(scores?.quality_score)],
    ["Growth", asNumber(scores?.growth_score)],
    ["Valuation", asNumber(scores?.valuation_score)],
    ["Financial strength", asNumber(scores?.financial_strength_score)],
    ["Moat", asNumber(scores?.moat_score)],
    ["Thesis integrity", asNumber(scores?.thesis_integrity_score)],
    ["Overall", asNumber(scores?.overall_score)],
  ] as const;

  return (
    <>
      <header className="siteHeader">
        <SolpientBrand />
        <nav>
          <Link href="/research">Rankings</Link>
          <Link href="/watchlist">Watchlist</Link>
          <Link href="/alerts">Alerts</Link>
          <span>Evidence-led investing</span>
        </nav>
      </header>

      <main className="researchShell">
        <div className="researchTopbar">
          <Link className="backLink" href="/research">← All research</Link>
          <ResearchControls ticker={company.ticker} name={company.company_name} />
        </div>

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

            <p className="heroDescription">
              {company.description ?? "Fundamental research and valuation history."}
            </p>

            <div className="heroThesis">
              <span>Research view</span>
              <p>{run.summary ?? "Research summary pending."}</p>
            </div>
          </div>

          <aside className="versionPanel">
            <span>RESEARCH VERSION</span>
            <strong>v{run.version}</strong>
            <small>{new Date(run.researched_at).toLocaleDateString("en-US")}</small>
            <div className="versionStatus">Published</div>
            {!isLatest ? (
              <Link className="latestLink" href={`/research/${company.ticker}`}>
                View latest →
              </Link>
            ) : null}
          </aside>
        </section>

        <section className="headlineGrid">
          <article className="headlineMetric">
            <span>Latest market price</span>
            <strong>{formatMoney(currentPrice)}</strong>
            <small>
              {latestMarket?.trading_date
                ? `As of ${new Date(latestMarket.trading_date + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC" })} · research price ${formatMoney(researchPrice)}`
                : `Research price · ${new Date(run.researched_at).toLocaleDateString("en-US")}`}
            </small>
          </article>

          <article className="headlineMetric">
            <span>Base fair value</span>
            <strong>{formatMoney(baseValue)}</strong>
            <small>Model estimate</small>
          </article>

          <article className="headlineMetric">
            <span>Valuation gap</span>
            <strong className={valuationGap != null && valuationGap >= 0 ? "positiveText valuationGapText" : "negativeText valuationGapText"}>
              {valuationGapLabel}
            </strong>
            <small>
              {upside == null ? "Compared with base fair value" : `${upside >= 0 ? "+" : ""}${upside.toFixed(1)}% upside/downside to base`}
            </small>
          </article>

          <article className="headlineMetric ringMetric">
            <ScoreRing label="Overall score" value={asNumber(scores?.overall_score)} />
          </article>

          <article className="headlineMetric ringMetric">
            <ScoreRing label="Thesis integrity" value={asNumber(scores?.thesis_integrity_score)} />
          </article>
        </section>

        <section className="dashboardGrid">
          <article className="dashboardPanel scorePanel">
            <div className="panelHeader">
              <div>
                <span className="panelKicker">SOLPIENT SCORECARD</span>
                <h2>Research quality</h2>
              </div>
            </div>
            <div className="scoreBars">
              {scoreRows.map(([label, value]) => (
                <ScoreBar key={label} label={label} value={value} />
              ))}
            </div>
          </article>

          <article className="dashboardPanel valuationPanel">
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
              <MetricTile label="25% MOS" value={formatMoney(valuation?.mos_25_price)} />
              <MetricTile label="35% MOS" value={formatMoney(valuation?.mos_35_price)} />
              <MetricTile label="50% MOS" value={formatMoney(valuation?.mos_50_price)} />
            </div>
          </article>

          <article className="dashboardPanel keyTakeawayPanel">
            <span className="panelKicker">KEY TAKEAWAY</span>
            <h2>{company.ticker} in one minute</h2>
            <p>{run.summary ?? "Research summary pending."}</p>
            <div className="takeawayStats">
              <div>
                <span>Forward P/E</span>
                <strong>{formatNumber(metrics?.forward_pe, "×")}</strong>
              </div>
              <div>
                <span>Market cap</span>
                <strong>{formatCompactMoney(run.market_cap)}</strong>
              </div>
            </div>
          </article>
        </section>

        <section className="dashboardGrid financialDashboard">
          <article className="dashboardPanel financialPanel">
            <div className="panelHeader">
              <div>
                <span className="panelKicker">FINANCIAL QUALITY</span>
                <h2>Operating snapshot</h2>
              </div>
              <small>{run.source_period ?? "Latest research period"}</small>
            </div>

            <div className="metricMatrix">
              <MetricTile label="Revenue growth" value={formatNumber(metrics?.revenue_growth_1y, "%")} />
              <MetricTile label="Gross margin" value={formatNumber(metrics?.gross_margin, "%")} />
              <MetricTile label="Operating margin" value={formatNumber(metrics?.operating_margin, "%")} />
              <MetricTile label="FCF margin" value={formatNumber(metrics?.fcf_margin, "%")} />
              <MetricTile label="EPS growth" value={formatNumber(metrics?.eps_growth_1y, "%")} />
              <MetricTile label="Debt / equity" value={formatNumber(metrics?.debt_to_equity)} />
              <MetricTile label="Cash" value={formatCompactMoney(metrics?.cash)} />
              <MetricTile label="Total debt" value={formatCompactMoney(metrics?.total_debt)} />
            </div>

          </article>

          <article className="dashboardPanel thesisSignalsPanel">
            <div className="panelHeader">
              <div>
                <span className="panelKicker">THESIS SIGNALS</span>
                <h2>What must remain true</h2>
              </div>
              <small>{thesis.length} tracked conditions</small>
            </div>

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
            </div>

            <div className="thesisCompactList">
              {thesis.slice(0, 5).map((item) => (
                <div className="thesisCompactRow" key={item.id}>
                  <span className={`signalDot ${item.status ?? "unknown"}`} />
                  <div>
                    <strong>{item.variable_name}</strong>
                    <small>{item.observed_value ?? item.expectation ?? "Evidence pending."}</small>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <ResearchStandardV1 researchRunId={run.id} />

        <HistoricalFinancials ticker={company.ticker} />

        <CompanyIntelligence ticker={company.ticker} />

        <PredictionHistory companyId={company.id} ticker={company.ticker} />

        <section className="dashboardGrid lowerDashboard">
          <article className="dashboardPanel changeSection">
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
          </article>

          <article className="dashboardPanel historyPanel">
            <div className="panelHeader">
              <div>
                <span className="panelKicker">RESEARCH LEDGER</span>
                <h2>Version history</h2>
              </div>
            </div>

            <div className="historyList">
              {history.map((item) => (
                <Link
                  className={`historyRow ${item.version === run.version ? "activeVersion" : ""}`}
                  href={`/research/${company.ticker}?version=${item.version}`}
                  key={item.id}
                >
                  <div>
                    <strong>Version {item.version}</strong>
                    <small>{new Date(item.researched_at).toLocaleDateString("en-US")}</small>
                  </div>
                  <span>{formatMoney(item.price_at_research)}</span>
                </Link>
              ))}
            </div>
          </article>

          <article className="dashboardPanel sourcePanel">
            <div className="panelHeader">
              <div>
                <span className="panelKicker">EVIDENCE LEDGER</span>
                <h2>Primary sources</h2>
              </div>
              <small>{sources.length} sources</small>
            </div>

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
          </article>
        </section>

        <section className="fullResearchPanel">
          <div className="panelHeader">
            <div>
              <span className="panelKicker">FULL RESEARCH</span>
              <h2>Investment memo</h2>
            </div>
            <span className="researchVersionStamp">Version {run.version}</span>
          </div>

          <p className="researchSummary">{run.summary ?? "Summary pending."}</p>
          <div className="fullReport">{run.full_report ?? "Full report pending."}</div>
        </section>
      </main>

      <footer className="siteFooter">
        <div>
          <strong>SOLPIENT</strong>
          <span>Research that remembers.</span>
        </div>
        <span>Fundamental research · evidence · version history</span>
      </footer>
    </>
  );
}
