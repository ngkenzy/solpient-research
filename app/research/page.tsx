import Link from "next/link";
import { getSupabase } from "@/lib/supabase";

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

  const ranked = (companies ?? [])
    .map((company) => {
      const run = latestRunByCompany.get(company.id);
      if (!run) return null;

      const scores: any = scoreMap.get(run.id) ?? {};
      const valuation: any = valuationMap.get(run.id) ?? {};
      const price = asNumber(run.price_at_research);
      const fairValue = asNumber(valuation.base_value);
      const gap = valuationGap(price, fairValue);

      return {
        company,
        run,
        scores,
        valuation,
        price,
        fairValue,
        gap,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => {
      const overallDiff = (asNumber(b.scores.overall_score) ?? -1) - (asNumber(a.scores.overall_score) ?? -1);
      if (overallDiff !== 0) return overallDiff;

      const thesisDiff =
        (asNumber(b.scores.thesis_integrity_score) ?? -1) -
        (asNumber(a.scores.thesis_integrity_score) ?? -1);
      if (thesisDiff !== 0) return thesisDiff;

      return (asNumber(b.scores.valuation_score) ?? -1) - (asNumber(a.scores.valuation_score) ?? -1);
    });

  const latestResearchDate = ranked.reduce<Date | null>((latest, item: any) => {
    const date = new Date(item.run.researched_at);
    return !latest || date > latest ? date : latest;
  }, null);

  const undervaluedCount = ranked.filter((item: any) => item.gap != null && item.gap > 1).length;

  return (
    <>
      <header className="siteHeader">
        <Link className="brand" href="/">
          <strong>SOLPIENT</strong>
          <span>Research</span>
        </Link>
        <nav>
          <Link href="/research">Rankings</Link>
          <Link href="/#solpient20">SOLPIENT 20</Link>
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
              The strongest latest research rises to the top. Ranking is based on the SOLPIENT
              overall score, with thesis integrity and valuation score used as tie-breakers.
            </p>
          </div>

          <div className="rankingHeroStats">
            <div>
              <span>Ranked companies</span>
              <strong>{ranked.length}</strong>
            </div>
            <div>
              <span>Below fair value</span>
              <strong>{undervaluedCount}</strong>
            </div>
            <div>
              <span>Latest research</span>
              <strong>{latestResearchDate ? latestResearchDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</strong>
            </div>
          </div>
        </section>

        <section className="rankingMethod">
          <div>
            <strong>How to read this page</strong>
            <span>
              Score measures research quality across business quality, growth, valuation, financial
              strength, moat, and thesis integrity.
            </span>
          </div>
          <div>
            <strong>Valuation gap</strong>
            <span>
              “Undervalued” means research price is below SOLPIENT base fair value; “overvalued”
              means it is above base fair value.
            </span>
          </div>
        </section>

        {ranked.length > 0 ? (
          <section className="rankingBoard">
            <div className="rankingHeaderRow">
              <span>Rank</span>
              <span>Company</span>
              <span>Overall</span>
              <span>Quality</span>
              <span>Growth</span>
              <span>Valuation</span>
              <span>Thesis</span>
              <span>Price</span>
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

                  <div className="rankScore primaryScore">
                    <strong>{asNumber(item.scores.overall_score) ?? "—"}</strong>
                    <span>/100</span>
                  </div>

                  <div className="rankScore">
                    <strong>{asNumber(item.scores.quality_score) ?? "—"}</strong>
                  </div>

                  <div className="rankScore">
                    <strong>{asNumber(item.scores.growth_score) ?? "—"}</strong>
                  </div>

                  <div className="rankScore">
                    <strong>{asNumber(item.scores.valuation_score) ?? "—"}</strong>
                  </div>

                  <div className="rankScore">
                    <strong>{asNumber(item.scores.thesis_integrity_score) ?? "—"}</strong>
                  </div>

                  <div className="rankMoney">
                    <strong>{formatMoney(item.price)}</strong>
                    <span>at research</span>
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

        <section className="rankingFootnote">
          <strong>Research shortlist, not a buy list.</strong>
          <p>
            Rankings summarize the latest SOLPIENT research record. They are designed to prioritize
            where deeper work may be most useful, not to replace judgment or portfolio construction.
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
