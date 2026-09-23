import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";
import { decisionRankingMap, readinessDisplay } from "@/lib/decision-ranking-read-model";
import { loadResearchIndexData } from "@/lib/repositories/research-index";

export const dynamic = "force-dynamic";

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatMoney(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function valuationGap(price: number | null, fairValue: number | null) {
  if (price == null || fairValue == null || fairValue === 0) return null;
  return ((fairValue - price) / fairValue) * 100;
}

function valuationLabel(gap: number | null) {
  if (gap == null) return { text: "Not valued", tone: "neutral" };
  if (Math.abs(gap) < 1) return { text: "Near fair value", tone: "neutral" };
  if (gap > 0) return { text: `${gap.toFixed(1)}% undervalued`, tone: "positive" };
  return { text: `${Math.abs(gap).toFixed(1)}% overvalued`, tone: "negative" };
}

function displaySnapshotDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function ResearchIndex() {
  const data = await loadResearchIndexData();

  if (!data) {
    return (
      <main className="rankingShell">
        <Link className="backLink" href="/">← SOLPIENT Research</Link>
        <section className="emptyState">
          <strong>No Solpient data source is configured.</strong>
          <p>Configure direct PostgreSQL or the migration fallback to load the ranking.</p>
        </section>
      </main>
    );
  }

  if (data.error) {
    return (
      <main className="rankingShell">
        <Link className="backLink" href="/">← SOLPIENT Research</Link>
        <section className="emptyState">
          <strong>Unable to load the Solpient 100.</strong>
          <p>{data.error.message}</p>
        </section>
      </main>
    );
  }

  const {
    solpient100,
    solpient100Run,
    solpient100Complete,
    companies,
    publishedRuns,
    scores,
    valuations,
    market,
    phase3Ranking,
  } = data;

  if (!solpient100Complete) {
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
        <main className="rankingShell">
          <Link className="backLink" href="/">← SOLPIENT Research</Link>
          <section className="emptyState">
            <strong>Solpient 100 snapshot is not complete.</strong>
            <p>
              The latest governed candidate snapshot contains {solpient100?.length ?? 0} members.
              Solpient will not label a partial set as the Solpient 100.
            </p>
          </section>
        </main>
      </>
    );
  }

  const phase3ByCompany = decisionRankingMap(phase3Ranking.rows);

  const companyById = new Map((companies ?? []).map((company: any) => [company.id, company]));
  const companyByTicker = new Map(
    (companies ?? []).map((company: any) => [String(company.ticker).toUpperCase(), company]),
  );

  const latestRunByCompany = new Map<string, any>();
  for (const run of publishedRuns ?? []) {
    if (!latestRunByCompany.has(run.company_id)) latestRunByCompany.set(run.company_id, run);
  }

  const scoreMap = new Map(scores.map((item: any) => [item.research_run_id, item]));
  const valuationMap = new Map(valuations.map((item: any) => [item.research_run_id, item]));

  const latestMarketBySymbol = new Map<string, any>();
  for (const row of market) {
    const symbol = String(row.symbol ?? "").toUpperCase();
    if (symbol && !latestMarketBySymbol.has(symbol)) latestMarketBySymbol.set(symbol, row);
  }

  const ranked = (solpient100 ?? []).map((member: any, index: number) => {
    const ticker = String(member.ticker ?? "").toUpperCase();
    const company: any =
      (member.company_id ? companyById.get(member.company_id) : null) ??
      companyByTicker.get(ticker) ??
      null;

    const companyId = company?.id ?? member.company_id ?? null;
    const run = companyId ? latestRunByCompany.get(companyId) ?? null : null;
    const score: any = run ? scoreMap.get(run.id) ?? {} : {};
    const valuation: any = run ? valuationMap.get(run.id) ?? {} : {};
    const phase3: any = companyId ? phase3ByCompany.get(companyId) ?? null : null;
    const marketRow = latestMarketBySymbol.get(ticker);
    const researchPrice = asNumber(run?.price_at_research);
    const currentPrice = asNumber(marketRow?.price) ?? asNumber(phase3?.price) ?? researchPrice;
    const fairValue = asNumber(valuation.base_value) ?? asNumber(phase3?.base_fair_value);
    const gap = valuationGap(currentPrice, fairValue);
    const readinessState =
      phase3?.readiness_state ??
      member.readiness_state ??
      (run ? "building" : "building");

    return {
      listRank: index + 1,
      member,
      ticker,
      company: {
        id: companyId,
        ticker,
        company_name: company?.company_name ?? member.company_name ?? ticker,
        sector: company?.sector ?? member.sector ?? null,
        industry: company?.industry ?? member.industry ?? null,
      },
      hasCompanyRecord: Boolean(companyId),
      run,
      score,
      valuation,
      phase3,
      readinessState,
      price: currentPrice,
      researchPrice,
      marketDate: marketRow?.trading_date ?? null,
      fairValue,
      gap,
    };
  });

  const publishedCount = ranked.filter((item: any) => item.run).length;
  const decisionReadyCount = ranked.filter(
    (item: any) => item.readinessState === "decision_ready",
  ).length;
  const researchReadyCount = ranked.filter(
    (item: any) => item.readinessState === "research_ready",
  ).length;
  const buildingCount = ranked.length - decisionReadyCount - researchReadyCount;

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

      <main className="rankingShell">
        <Link className="backLink" href="/">← SOLPIENT Research</Link>

        <section className="rankingHero">
          <div>
            <span className="panelKicker">THE SOLPIENT 100</span>
            <h1>100 companies. One governed research universe.</h1>
            <p>
              Every member of the latest immutable Solpient 100 appears below. The 100-rank follows
              the governed shortlist order; Phase 3 decision metrics are layered on as research
              matures, so incomplete companies are visible instead of disappearing.
            </p>
          </div>

          <div className="rankingHeroStats">
            <div><span>Members</span><strong>{ranked.length}/100</strong></div>
            <div><span>Decision Ready</span><strong>{decisionReadyCount}</strong></div>
            <div><span>Research Ready</span><strong>{researchReadyCount}</strong></div>
            <div><span>Published</span><strong>{publishedCount}/100</strong></div>
          </div>
        </section>

        <section className="rankingMethod">
          <div>
            <strong>Governed membership</strong>
            <span>
              The Solpient 100 comes from the latest immutable Research Candidate Pipeline snapshot,
              not from whichever companies happen to have published research.
            </span>
          </div>
          <div>
            <strong>Decision layer</strong>
            <span>
              Phase 3 adds Business Quality, Investment Opportunity, Evidence Confidence, and
              readiness without removing Building-stage members from the 100.
            </span>
          </div>
        </section>

        <section className="rankingBoard">
          <div className="rankingHeaderRow">
            <span>100 Rank</span>
            <span>Company</span>
            {phase3Ranking.available ? (
              <>
                <span>Readiness</span>
                <span>Decision</span>
                <span>Quality</span>
                <span>Opportunity</span>
                <span>Confidence</span>
              </>
            ) : (
              <>
                <span>Readiness</span>
                <span>Screen</span>
                <span>Quality</span>
                <span>Evidence</span>
                <span>Stage</span>
              </>
            )}
            <span>Latest price</span>
            <span>Base value</span>
            <span>Value gap</span>
          </div>

          {ranked.map((item: any) => {
            const label = valuationLabel(item.gap);
            const rowContent = (
              <>
                <div className="rankCell">
                  <span className={`rankBadge rank${Math.min(item.listRank, 3)}`}>
                    {item.listRank}
                  </span>
                </div>

                <div className="rankCompany">
                  <div className="rankMonogram">{item.ticker.slice(0, 2)}</div>
                  <div>
                    <strong>{item.ticker}</strong>
                    <span>{item.company.company_name}</span>
                    <small>{item.company.sector ?? item.company.industry ?? "Sector pending"}</small>
                  </div>
                </div>

                {phase3Ranking.available ? (
                  <>
                    <div className="rankReadiness">
                      <strong className={"readinessPill " + item.readinessState}>
                        {readinessDisplay(item.readinessState)}
                      </strong>
                    </div>
                    <div className="rankScore primaryScore">
                      <strong>{asNumber(item.phase3?.decision_score) ?? asNumber(item.member.pipeline_decision_score) ?? "—"}</strong>
                      <span>/100</span>
                    </div>
                    <div className="rankScore">
                      <strong>{asNumber(item.phase3?.business_quality_score) ?? "—"}</strong>
                    </div>
                    <div className="rankScore">
                      <strong>{asNumber(item.phase3?.investment_opportunity_score) ?? "—"}</strong>
                    </div>
                    <div className="rankScore">
                      <strong>{asNumber(item.phase3?.evidence_confidence_score) ?? asNumber(item.member.pipeline_evidence_confidence) ?? "—"}</strong>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rankReadiness">
                      <strong className={"readinessPill " + item.readinessState}>
                        {readinessDisplay(item.readinessState)}
                      </strong>
                    </div>
                    <div className="rankScore primaryScore">
                      <strong>{asNumber(item.member.screen_score) ?? "—"}</strong>
                      <span>/100</span>
                    </div>
                    <div className="rankScore">
                      <strong>{asNumber(item.member.quality_core_score) ?? "—"}</strong>
                    </div>
                    <div className="rankScore">
                      <strong>{asNumber(item.member.evidence_coverage_pct) ?? "—"}</strong>
                    </div>
                    <div className="rankScore">
                      <strong>{String(item.member.stage ?? "building").replaceAll("_", " ")}</strong>
                    </div>
                  </>
                )}

                <div className="rankMoney">
                  <strong>{formatMoney(item.price)}</strong>
                  <span>
                    {item.marketDate
                      ? `as of ${new Date(item.marketDate + "T00:00:00Z").toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        })}`
                      : "price pending"}
                  </span>
                </div>

                <div className="rankMoney">
                  <strong>{formatMoney(item.fairValue)}</strong>
                  <span>{item.fairValue == null ? "research pending" : "base case"}</span>
                </div>

                <div className="rankValueGap">
                  <strong className={`valueGapPill ${label.tone}`}>{label.text}</strong>
                  <span>{item.run ? "vs. base fair value" : "research building"}</span>
                </div>
              </>
            );

            return item.hasCompanyRecord ? (
              <Link
                key={item.ticker}
                className={`rankingRow ${item.listRank === 1 ? "topRank" : ""}`}
                href={`/research/${item.ticker}`}
              >
                {rowContent}
              </Link>
            ) : (
              <div
                key={item.ticker}
                className={`rankingRow ${item.listRank === 1 ? "topRank" : ""}`}
              >
                {rowContent}
              </div>
            );
          })}
        </section>

        <section className="rankingFootnote">
          <strong>Solpient 100 is a research universe, not a buy list.</strong>
          <p>
            Membership is fixed by the governed candidate snapshot shown here. Phase 3 readiness and
            decision metrics can change as evidence, valuation, and prices change. Snapshot as of{" "}
            {displaySnapshotDate(solpient100Run?.evaluation_as_of)}. Building: {buildingCount}.
          </p>
        </section>
      </main>

      <footer className="siteFooter">
        <div>
          <strong>SOLPIENT</strong>
          <span>Research that remembers.</span>
        </div>
        <span>Solpient 100 · valuation · evidence · version history</span>
      </footer>
    </>
  );
}
