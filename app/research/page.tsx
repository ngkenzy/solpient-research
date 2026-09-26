import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { SolpientBrand } from "@/components/SolpientBrand";
import { decisionRankingMap, loadLatestDecisionRanking, readinessDisplay } from "@/lib/decision-ranking-read-model";

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

export default async function ResearchIndex() {
  const supabase = getSupabase();

  if (!supabase) {
    return (
      <main className="rankingShell">
        <Link className="backLink" href="/">← SOLPIENT Research</Link>
        <section className="emptyState">
          <strong>Supabase is not configured.</strong>
          <p>Add the public Supabase URL and publishable key to load the ranking.</p>
        </section>
      </main>
    );
  }

  const [{ data: companies, error: companyError }, { data: publishedRuns, error: runError }] =
    await Promise.all([
      supabase
        .from("companies")
        .select("id,ticker,company_name,sector,industry")
        .order("ticker"),
      supabase
        .from("research_runs")
        .select("id,company_id,version,researched_at,price_at_research,summary")
        .eq("status", "published")
        .order("version", { ascending: false }),
    ]);

  const error = companyError ?? runError;

  if (error) {
    return (
      <main className="rankingShell">
        <Link className="backLink" href="/">← SOLPIENT Research</Link>
        <section className="emptyState">
          <strong>Unable to load research.</strong>
          <p>{error.message}</p>
        </section>
      </main>
    );
  }

  const phase3Ranking = await loadLatestDecisionRanking(supabase);
  const phase3ByCompany = decisionRankingMap(phase3Ranking.rows);

  const latestRunByCompany = new Map<string, any>();
  for (const run of publishedRuns ?? []) {
    if (!latestRunByCompany.has(run.company_id)) latestRunByCompany.set(run.company_id, run);
  }

  const latestRuns = Array.from(latestRunByCompany.values());
  const runIds = latestRuns.map((run) => run.id);

  const [scoresResult, valuationsResult] = runIds.length
    ? await Promise.all([
        supabase
          .from("scores")
          .select("research_run_id,overall_score,quality_score,growth_score,valuation_score,financial_strength_score,moat_score,thesis_integrity_score")
          .in("research_run_id", runIds),
        supabase
          .from("valuations")
          .select("research_run_id,base_value,bear_value,bull_value")
          .in("research_run_id", runIds),
      ])
    : [{ data: [] }, { data: [] }];

  const scoreMap = new Map((scoresResult.data ?? []).map((item: any) => [item.research_run_id, item]));
  const valuationMap = new Map((valuationsResult.data ?? []).map((item: any) => [item.research_run_id, item]));

  const symbols = (companies ?? []).map((company) => company.ticker);
  const marketResult = symbols.length
    ? await supabase
        .from("market_snapshots")
        .select("symbol,price,trading_date")
        .in("symbol", symbols)
        .order("trading_date", { ascending: false })
    : { data: [] as any[] };

  const latestMarketBySymbol = new Map<string, any>();
  for (const row of marketResult.data ?? []) {
    if (!latestMarketBySymbol.has(row.symbol)) latestMarketBySymbol.set(row.symbol, row);
  }

  const ranked = (companies ?? [])
    .map((company) => {
      const run = latestRunByCompany.get(company.id);
      if (!run) return null;

      const scores: any = scoreMap.get(run.id) ?? {};
      const valuation: any = valuationMap.get(run.id) ?? {};
      const researchPrice = asNumber(run.price_at_research);
      const market = latestMarketBySymbol.get(company.ticker);
      const currentPrice = asNumber(market?.price) ?? researchPrice;
      const fairValue = asNumber(valuation.base_value);
      const gap = valuationGap(currentPrice, fairValue);

      return {
        company,
        run,
        scores,
        valuation,
        price: currentPrice,
        researchPrice,
        marketDate: market?.trading_date ?? null,
        fairValue,
        gap,
        phase3: phase3ByCompany.get(company.id) ?? null,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => {
      if (phase3Ranking.available) {
        const ar = Number(a.phase3?.rank ?? Number.MAX_SAFE_INTEGER);
        const br = Number(b.phase3?.rank ?? Number.MAX_SAFE_INTEGER);
        if (ar !== br) return ar - br;
      }

      const overallDiff = (asNumber(b.scores.overall_score) ?? -1) - (asNumber(a.scores.overall_score) ?? -1);
      if (overallDiff !== 0) return overallDiff;

      const thesisDiff =
        (asNumber(b.scores.thesis_integrity_score) ?? -1) -
        (asNumber(a.scores.thesis_integrity_score) ?? -1);
      if (thesisDiff !== 0) return thesisDiff;

      return (asNumber(b.scores.valuation_score) ?? -1) - (asNumber(a.scores.valuation_score) ?? -1);
    });

  const pendingCompanies = (companies ?? []).filter((company) => !latestRunByCompany.has(company.id));

  const latestResearchDate = ranked.reduce<Date | null>((latest, item: any) => {
    const date = new Date(item.run.researched_at);
    return !latest || date > latest ? date : latest;
  }, null);

  const undervaluedCount = ranked.filter((item: any) => item.gap != null && item.gap > 1).length;
  const decisionReadyCount = ranked.filter((item: any) => item.phase3?.readiness_state === "decision_ready").length;
  const researchReadyCount = ranked.filter((item: any) => item.phase3?.readiness_state === "research_ready").length;
  const buildingCount = ranked.filter((item: any) => item.phase3?.readiness_state === "building").length;

  return (
    <>
      <header className="siteHeader">
        <SolpientBrand />
        <nav>
          <Link href="/research">Rankings</Link>
          <Link href="/portfolio">Portfolio</Link>
          <Link href="/research/request">Request research</Link>
          <Link href="/watchlist">Watchlist</Link>
          <Link href="/alerts">Alerts</Link>
          <span>Evidence-led investing</span>
        </nav>
      </header>

      <main className="rankingShell">
        <Link className="backLink" href="/">← SOLPIENT Research</Link>

        <section className="rankingHero">
          <div>
            <span className="panelKicker">SOLPIENT RANKINGS</span>
            <h1>Company research, ranked.</h1>
            <p>
              {phase3Ranking.available
                ? "Phase 3 separates business quality, investment opportunity, and evidence confidence. Readiness gates the ranking before decision score."
                : "The strongest latest research rises to the top. Legacy ranking remains active until the Phase 3 decision-ranking snapshot is available."}
            </p>
          </div>

          <div className="rankingHeroStats">
            {phase3Ranking.available ? (
              <>
                <div><span>Decision Ready</span><strong>{decisionReadyCount}</strong></div>
                <div><span>Research Ready</span><strong>{researchReadyCount}</strong></div>
                <div><span>Building</span><strong>{buildingCount}</strong></div>
                <div><span>Published</span><strong>{ranked.length}/{companies?.length ?? 0}</strong></div>
              </>
            ) : (
              <>
                <div><span>Research coverage</span><strong>{ranked.length}/{companies?.length ?? 0}</strong></div>
                <div><span>Pending research</span><strong>{pendingCompanies.length}</strong></div>
                <div><span>Below fair value</span><strong>{undervaluedCount}</strong></div>
                <div>
                  <span>Latest research</span>
                  <strong>{latestResearchDate ? latestResearchDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</strong>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="rankingMethod">
          <div>
            <strong>{phase3Ranking.available ? "Phase 3 decision ranking" : "How to read this page"}</strong>
            <span>
              {phase3Ranking.available
                ? "Business Quality measures the company. Investment Opportunity measures the stock at today's price. Evidence Confidence determines whether the work is Building, Research Ready, or Decision Ready."
                : "Legacy score measures research quality across business quality, growth, valuation, financial strength, moat, and thesis integrity."}
            </span>
          </div>
          <div>
            <strong>{phase3Ranking.available ? "Readiness is not a recommendation" : "Valuation gap"}</strong>
            <span>
              {phase3Ranking.available
                ? "Decision Ready means the evidence package is sufficiently complete for decision-grade comparison. It does not mean Buy."
                : "“Undervalued” means research price is below SOLPIENT base fair value; “overvalued” means it is above base fair value."}
            </span>
          </div>
        </section>

        {ranked.length > 0 ? (
          <section className="rankingBoard">
            <div className="rankingHeaderRow">
              <span>Rank</span>
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
                  <span>Overall</span>
                  <span>Quality</span>
                  <span>Growth</span>
                  <span>Valuation</span>
                  <span>Thesis</span>
                </>
              )}
              <span>Latest price</span>
              <span>Base value</span>
              <span>Value gap</span>
            </div>

            {ranked.map((item: any, index: number) => {
              const label = valuationLabel(item.gap);
              const rank = index + 1;

              return (
                <Link
                  key={item.company.id}
                  className={`rankingRow ${rank === 1 ? "topRank" : ""}`}
                  href={`/research/${item.company.ticker}`}
                >
                  <div className="rankCell">
                    <span className={`rankBadge rank${Math.min(rank, 3)}`}>{rank}</span>
                  </div>

                  <div className="rankCompany">
                    <div className="rankMonogram">{item.company.ticker.slice(0, 2)}</div>
                    <div>
                      <strong>{item.company.ticker}</strong>
                      <span>{item.company.company_name}</span>
                      <small>{item.company.sector ?? item.company.industry ?? "Sector pending"}</small>
                    </div>
                  </div>

                  {phase3Ranking.available ? (
                    <>
                      <div className="rankReadiness">
                        <strong className={"readinessPill " + (item.phase3?.readiness_state ?? "building")}>
                          {readinessDisplay(item.phase3?.readiness_state)}
                        </strong>
                      </div>
                      <div className="rankScore primaryScore">
                        <strong>{asNumber(item.phase3?.decision_score) ?? "—"}</strong>
                        <span>/100</span>
                      </div>
                      <div className="rankScore">
                        <strong>{asNumber(item.phase3?.business_quality_score) ?? "—"}</strong>
                      </div>
                      <div className="rankScore">
                        <strong>{asNumber(item.phase3?.investment_opportunity_score) ?? "—"}</strong>
                      </div>
                      <div className="rankScore">
                        <strong>{asNumber(item.phase3?.evidence_confidence_score) ?? "—"}</strong>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="rankScore primaryScore">
                        <strong>{asNumber(item.scores.overall_score) ?? "—"}</strong>
                        <span>/100</span>
                      </div>
                      <div className="rankScore"><strong>{asNumber(item.scores.quality_score) ?? "—"}</strong></div>
                      <div className="rankScore"><strong>{asNumber(item.scores.growth_score) ?? "—"}</strong></div>
                      <div className="rankScore"><strong>{asNumber(item.scores.valuation_score) ?? "—"}</strong></div>
                      <div className="rankScore"><strong>{asNumber(item.scores.thesis_integrity_score) ?? "—"}</strong></div>
                    </>
                  )}

                  <div className="rankMoney">
                    <strong>{formatMoney(item.price)}</strong>
                    <span>{item.marketDate ? `as of ${new Date(item.marketDate + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : "at research"}</span>
                  </div>

                  <div className="rankMoney">
                    <strong>{formatMoney(item.fairValue)}</strong>
                    <span>base case</span>
                  </div>

                  <div className="rankValueGap">
                    <strong className={`valueGapPill ${label.tone}`}>{label.text}</strong>
                    <span>vs. base fair value</span>
                  </div>
                </Link>
              );
            })}
          </section>
        ) : (
          <section className="emptyState">
            <strong>No published companies yet.</strong>
            <p>Published research will appear here automatically and be ranked by latest score.</p>
          </section>
        )}

        {pendingCompanies.length > 0 ? (
          <section className="coverageQueue">
            <div className="coverageQueueHeader">
              <div>
                <span className="panelKicker">RESEARCH COVERAGE</span>
                <h2>Queued for full research</h2>
              </div>
              <strong>{pendingCompanies.length} pending</strong>
            </div>
            <div className="coverageQueueGrid">
              {pendingCompanies.map((company) => (
                <div className="coverageQueueRow" key={company.id}>
                  <div className="rankMonogram">{company.ticker.slice(0, 2)}</div>
                  <div>
                    <strong>{company.ticker}</strong>
                    <span>{company.company_name}</span>
                  </div>
                  <small>Monitoring active · research not yet published</small>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rankingFootnote">
          <strong>Research shortlist, not a buy list.</strong>
          <p>
            {phase3Ranking.available
              ? "Rankings compare the latest published research by readiness tier and decision score. Evidence Confidence is shown separately so incomplete research cannot masquerade as equal conviction."
              : "Rankings summarize the latest SOLPIENT research record. They are designed to prioritize where deeper work may be most useful, not to replace judgment or portfolio construction."}
          </p>
        </section>
      </main>

      <footer className="siteFooter">
        <div>
          <strong>SOLPIENT</strong>
          <span>Research that remembers.</span>
        </div>
        <span>Rankings · valuation · evidence · version history</span>
      </footer>
    </>
  );
}
