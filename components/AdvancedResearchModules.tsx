import { loadAdvancedResearchData } from "@/lib/repositories/advanced-research";

function n(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1_000_000_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 1_000_000_000 ? 1 : 2,
  }).format(value);
}

function pct(value: number | null) {
  return value == null ? "—" : value.toFixed(1) + "%";
}

function ratio(value: number | null) {
  return value == null ? "—" : value.toFixed(2) + "×";
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function AdvancedResearchModules({
  companyId,
  researchRunId,
  ticker,
  asOf = null,
}: {
  companyId: string;
  researchRunId: string;
  ticker: string;
  asOf?: string | null;
}) {
  const loaded = await loadAdvancedResearchData(companyId, researchRunId, asOf);
  if (!loaded) return null;

  const rows = loaded.rows;
  const consensus = loaded.consensus;
  const metricsData = loaded.metrics;
  const v2Data = loaded.v2;
  const annualFcfData = loaded.annualFcf;
  const products = rows
    .filter((row: any) => row.module === "product_mix")
    .sort((a: any, b: any) => Number(b.value_numeric ?? 0) - Number(a.value_numeric ?? 0));
  const segments = rows
    .filter((row: any) => row.module === "segment_mix")
    .sort((a: any, b: any) => Number(b.value_numeric ?? 0) - Number(a.value_numeric ?? 0));
  const geography = rows
    .filter((row: any) => row.module === "geography_mix")
    .sort((a: any, b: any) => Number(b.value_numeric ?? 0) - Number(a.value_numeric ?? 0));
  const pipeline = rows.filter((row: any) => row.module === "biopharma_pipeline");
  const timeline = rows.filter((row: any) => row.module === "biopharma_timeline");
  const surprises = rows
    .filter((row: any) => row.module === "earnings_surprise")
    .sort((a: any, b: any) => String(b.period_end).localeCompare(String(a.period_end)));
  const capitalSafety = rows.find((row: any) => row.module === "capital_safety");

  const totalProductRevenue = products.reduce(
    (sum: number, row: any) => sum + Number(row.value_numeric ?? 0),
    0,
  );
  const totalCompanyRevenue = segments.reduce(
    (sum: number, row: any) => sum + Number(row.value_numeric ?? 0),
    0,
  );
  const maxProduct = Math.max(...products.map((row: any) => Number(row.value_numeric ?? 0)), 1);
  const maxSegment = Math.max(...segments.map((row: any) => Number(row.value_numeric ?? 0)), 1);
  const totalGeography = geography.reduce(
    (sum: number, row: any) => sum + Number(row.value_numeric ?? 0),
    0,
  );
  const maxPipeline = Math.max(...pipeline.map((row: any) => Number(row.value_numeric ?? 0)), 1);

  const latestConsensus = consensus.at(-1) ?? null;
  const priorConsensus = consensus.length > 1 ? consensus.at(-2) : null;
  const epsRevision =
    latestConsensus?.eps_next_fy != null && priorConsensus?.eps_next_fy != null
      ? ((Number(latestConsensus.eps_next_fy) / Number(priorConsensus.eps_next_fy)) - 1) * 100
      : null;
  const revenueRevision =
    latestConsensus?.revenue_next_fy != null && priorConsensus?.revenue_next_fy != null
      ? ((Number(latestConsensus.revenue_next_fy) / Number(priorConsensus.revenue_next_fy)) - 1) * 100
      : null;

  const normalized =
    (v2Data as any)?.valuation_analysis?.normalized_earnings_context ?? {};
  const dividendPerShare = n(normalized.annualized_dividend_per_share);
  const adjustedEps = n(normalized.adjusted_eps_guidance_midpoint);
  const dividendPayout =
    dividendPerShare != null && adjustedEps != null && adjustedEps !== 0
      ? (dividendPerShare / adjustedEps) * 100
      : null;

  const annualFcf = n((annualFcfData as any)?.value_numeric);
  const dividendsPaid = n((capitalSafety as any)?.value_numeric);
  const fcfDividendCoverage =
    annualFcf != null && dividendsPaid != null && dividendsPaid !== 0
      ? annualFcf / dividendsPaid
      : null;
  const totalDebt = n((metricsData as any)?.total_debt);
  const cash = n((metricsData as any)?.cash);
  const netDebt =
    totalDebt != null && cash != null ? totalDebt - cash : null;
  const netDebtToFcf =
    netDebt != null && annualFcf != null && annualFcf !== 0
      ? netDebt / annualFcf
      : null;

  if (
    !products.length &&
    !segments.length &&
    !geography.length &&
    !pipeline.length &&
    !timeline.length &&
    !consensus.length &&
    !surprises.length
  ) {
    return null;
  }

  return (
    <section className="advancedResearchSection">
      <div className="historicalHeading">
        <div>
          <span className="panelKicker">OPERATING DETAIL + FORWARD SIGNALS</span>
          <h2>What drives the business next</h2>
          <p className="historicalHint">
            Product concentration, revenue mix, industry-specific milestones, estimate revisions,
            and balance-sheet/dividend coverage. Modules appear only when verified data is stored.
          </p>
        </div>
      </div>

      <div className="advancedResearchGrid">
        {products.length ? (
          <article className="advancedPanel advancedWide">
            <div className="performancePanelHeader">
              <div>
                <span className="panelKicker">PRODUCT MIX</span>
                <h3>Largest revenue contributors</h3>
              </div>
              <small>Latest fiscal year</small>
            </div>
            <div className="horizontalBarList">
              {products.map((row: any) => {
                const value = Number(row.value_numeric ?? 0);
                return (
                  <div className="horizontalBarRow" key={row.metric_key}>
                    <div>
                      <strong>{row.label}</strong>
                      <span>
                        {money(value)}
                        {(totalCompanyRevenue || totalProductRevenue) > 0
                          ? " · " + ((value / (totalCompanyRevenue || totalProductRevenue)) * 100).toFixed(1) + "% of revenue"
                          : ""}
                      </span>
                    </div>
                    <div className="horizontalBarTrack">
                      <i style={{ width: `${Math.max(2, (value / maxProduct) * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        ) : null}

        {segments.length ? (
          <article className="advancedPanel">
            <div className="performancePanelHeader">
              <div>
                <span className="panelKicker">SEGMENT MIX</span>
                <h3>Revenue by business group</h3>
              </div>
            </div>
            <div className="miniBarList">
              {segments.map((row: any) => {
                const value = Number(row.value_numeric ?? 0);
                return (
                  <div key={row.metric_key}>
                    <span>{row.label}</span>
                    <strong>{money(value)}</strong>
                    <i style={{ width: `${Math.max(2, (value / maxSegment) * 100)}%` }} />
                  </div>
                );
              })}
            </div>
          </article>
        ) : null}

        {geography.length ? (
          <article className="advancedPanel">
            <div className="performancePanelHeader">
              <div>
                <span className="panelKicker">GEOGRAPHIC MIX</span>
                <h3>Where revenue comes from</h3>
              </div>
            </div>
            <div className="mixDonutList">
              {geography.map((row: any) => {
                const value = Number(row.value_numeric ?? 0);
                return (
                  <div key={row.metric_key}>
                    <span>{row.label}</span>
                    <strong>{totalGeography ? ((value / totalGeography) * 100).toFixed(1) + "%" : "—"}</strong>
                    <small>{money(value)}</small>
                  </div>
                );
              })}
            </div>
          </article>
        ) : null}

        {pipeline.length ? (
          <article className="advancedPanel">
            <div className="performancePanelHeader">
              <div>
                <span className="panelKicker">PIPELINE</span>
                <h3>Development-stage depth</h3>
              </div>
              <small>{pipeline[0]?.period_end ? "As of " + dateLabel(pipeline[0].period_end) : ""}</small>
            </div>
            <div className="pipelineBars">
              {pipeline.map((row: any) => {
                const value = Number(row.value_numeric ?? 0);
                return (
                  <div key={row.metric_key}>
                    <div className="pipelineColumn">
                      <i style={{ height: `${Math.max(8, (value / maxPipeline) * 100)}%` }} />
                    </div>
                    <strong>{value}</strong>
                    <span>{row.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="performanceFootnote">
              Pipeline counts measure development capacity, not probability-adjusted future revenue.
            </p>
          </article>
        ) : null}

        {timeline.length ? (
          <article className="advancedPanel advancedWide">
            <div className="performancePanelHeader">
              <div>
                <span className="panelKicker">LOE / PRICING TIMELINE</span>
                <h3>Patent-cliff and reimbursement milestones</h3>
              </div>
            </div>
            <div className="loeTimeline">
              {timeline.map((row: any) => (
                <div key={row.metric_key}>
                  <time>{row.period_end?.slice(0, 4)}</time>
                  <div>
                    <strong>{row.label}</strong>
                    <p>{row.value_text}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ) : null}

        <article className="advancedPanel">
          <div className="performancePanelHeader">
            <div>
              <span className="panelKicker">ESTIMATE REVISIONS</span>
              <h3>Forward consensus tracker</h3>
            </div>
            <small>{consensus.length} stored snapshots</small>
          </div>
          {latestConsensus ? (
            <>
              <div className="coverageStatGrid">
                <div>
                  <span>Next-FY EPS</span>
                  <strong>{money(n(latestConsensus.eps_next_fy))}</strong>
                  <small>{latestConsensus.provider}</small>
                </div>
                <div>
                  <span>EPS revision</span>
                  <strong>{epsRevision == null ? "Baseline" : pct(epsRevision)}</strong>
                  <small>vs prior stored snapshot</small>
                </div>
                <div>
                  <span>Revenue revision</span>
                  <strong>{revenueRevision == null ? "Pending" : pct(revenueRevision)}</strong>
                  <small>vs prior stored snapshot</small>
                </div>
              </div>
              <p className="performanceFootnote">
                Solpient preserves consensus snapshots point-in-time; revision history becomes more useful as daily observations accumulate.
              </p>
            </>
          ) : (
            <div className="advancedEmpty">
              Consensus provider coverage is not yet available for this company.
            </div>
          )}
        </article>

        <article className="advancedPanel">
          <div className="performancePanelHeader">
            <div>
              <span className="panelKicker">DIVIDEND + DEBT SAFETY</span>
              <h3>Can cash flows support the capital structure?</h3>
            </div>
          </div>
          <div className="coverageStatGrid">
            <div>
              <span>Adjusted EPS payout</span>
              <strong>{pct(dividendPayout)}</strong>
              <small>{dividendPerShare != null ? money(dividendPerShare) + " annual dividend" : "—"}</small>
            </div>
            <div>
              <span>FCF dividend coverage</span>
              <strong>{ratio(fcfDividendCoverage)}</strong>
              <small>latest complete FY</small>
            </div>
            <div>
              <span>Net debt / FCF</span>
              <strong>{ratio(netDebtToFcf)}</strong>
              <small>{netDebt != null ? money(netDebt) + " net debt" : "—"}</small>
            </div>
          </div>
          <p className="performanceFootnote">
            Adjusted-EPS payout and free-cash-flow coverage answer different questions; acquisition, impairment and working-capital volatility can make them diverge materially.
          </p>
        </article>

        {surprises.length ? (
          <article className="advancedPanel advancedWide">
            <div className="performancePanelHeader">
              <div>
                <span className="panelKicker">EARNINGS EXECUTION</span>
                <h3>Recent estimate vs. actual results</h3>
              </div>
            </div>
            <div className="surpriseTable">
              {surprises.map((row: any) => (
                <div key={row.metric_key}>
                  <div><strong>{row.label}</strong><span>{dateLabel(row.period_end)}</span></div>
                  <strong>{money(Number(row.value_numeric ?? 0))} actual EPS</strong>
                  <p>{row.value_text}</p>
                </div>
              ))}
            </div>
          </article>
        ) : null}
      </div>
    </section>
  );
}
