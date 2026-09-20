import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { CapitalActivity, type CapitalActivityItem } from "@/components/CapitalActivity";
import styles from "./home.module.css";
import { SolpientBrand } from "@/components/SolpientBrand";

export const dynamic = "force-dynamic";

function num(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function compactMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function displayDate(value?: string | null, withYear = false) {
  if (!value) return "—";
  const date = new Date(value.includes("T") ? value : value + "T00:00:00Z");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

function displayDateTime(value?: string | null) {
  if (!value) return "Pending";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function valuationGap(price: number | null, fairValue: number | null) {
  if (price == null || fairValue == null || fairValue === 0) return null;
  return ((fairValue - price) / fairValue) * 100;
}

function valuationText(gap: number | null) {
  if (gap == null) return { label: "Not valued", tone: styles.neutralText };
  if (Math.abs(gap) < 1) return { label: "Near fair value", tone: styles.neutralText };
  if (gap > 0) return { label: gap.toFixed(0) + "% undervalued", tone: styles.positiveText };
  return { label: Math.abs(gap).toFixed(0) + "% overvalued", tone: styles.negativeText };
}

function uniqueFilings(rows: any[], companyById: Map<string, any>) {
  const seen = new Set<string>();
  const output: any[] = [];
  for (const row of rows) {
    const company = companyById.get(row.company_id);
    if (!company) continue;
    const key = [company.ticker, row.form_type, row.filed_at, row.filing_url].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ ...row, company });
  }
  return output;
}

function buildCapitalActivity(rows: any[], companyById: Map<string, any>): CapitalActivityItem[] {
  return rows
    .map((row): (CapitalActivityItem & { sortDate: string }) | null => {
      const company = companyById.get(row.company_id);
      if (!company) return null;

      const category =
        row.activity_type === "insider"
          ? "insiders"
          : row.activity_type === "political"
            ? "congress"
            : "investors";

      let detail = row.actor_detail ?? row.activity_type;
      let dateLabel = "Recorded " + displayDate(row.created_at, true);
      let sortDate = row.created_at ?? "";

      if (row.activity_type === "institutional") {
        const shares = num(row.shares);
        const value = num(row.value);
        detail =
          (row.actor_detail ?? "Institution") +
          (shares != null ? " · " + new Intl.NumberFormat("en-US").format(shares) + " shares" : "") +
          (value != null ? " · " + compactMoney(value) : "");
        dateLabel = row.position_date
          ? "Position reported as of " + displayDate(row.position_date, true)
          : "Ownership disclosure";
        sortDate = row.disclosure_date ?? row.position_date ?? row.created_at ?? "";
      } else if (row.activity_type === "insider") {
        const shares = num(row.shares);
        const price = num(row.price);
        detail =
          (row.actor_detail ?? "Insider") +
          (shares != null ? " · " + new Intl.NumberFormat("en-US").format(shares) + " shares" : "") +
          (price != null ? " at $" + price.toFixed(2) : "");
        dateLabel = row.transaction_date
          ? "Transaction " + displayDate(row.transaction_date, true)
          : "Insider disclosure";
        sortDate = row.disclosure_date ?? row.transaction_date ?? row.created_at ?? "";
      } else {
        detail = (row.actor_detail ?? "Political disclosure") + (row.amount_range ? " · " + row.amount_range : "");
        dateLabel =
          (row.transaction_date ? "Traded " + displayDate(row.transaction_date, true) : "Trade date unavailable") +
          (row.disclosure_date ? " · filed " + displayDate(row.disclosure_date, true) : "");
        sortDate = row.disclosure_date ?? row.transaction_date ?? row.created_at ?? "";
      }

      const positive = ["Buy", "Purchase", "Increased"].includes(row.action);
      const negative = ["Sell", "Sale", "Reduced"].includes(row.action);

      return {
        id: row.id,
        ticker: company.ticker,
        company: company.company_name,
        category,
        actor: row.actor_name,
        action: row.action,
        detail,
        dateLabel,
        sourceUrl: row.source_url ?? "#",
        tone: positive ? "positive" : negative ? "negative" : "neutral",
        sortDate,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => String(b.sortDate).localeCompare(String(a.sortDate)))
    .map(({ sortDate: _sortDate, ...item }: any) => item);
}

function Icon({ children }: { children: React.ReactNode }) {
  return <span className={styles.iconBox}>{children}</span>;
}

export default async function Home() {
  const supabase = getSupabase();

  if (!supabase) {
    return (
      <main className={styles.commandMain}>
        <div className={styles.offlineState}>
          <strong>SOLPIENT</strong>
          <h1>Research command center</h1>
          <p>Supabase is not configured for this deployment.</p>
          <Link href="/research">Open research →</Link>
        </div>
      </main>
    );
  }

  const [
    companiesResult,
    runsResult,
    marketResult,
    filingsResult,
    rankingResult,
    capitalResult,
    eventsResult,
    rankingExplanationsResult,
    predictionsResult,
    predictionScoresResult,
    automationResult,
  ] = await Promise.all([
    supabase.from("companies").select("id,ticker,company_name,sector,industry").order("ticker"),
    supabase
      .from("research_runs")
      .select("id,company_id,version,researched_at,price_at_research,summary")
      .eq("status", "published")
      .order("researched_at", { ascending: false }),
    supabase
      .from("market_snapshots")
      .select("symbol,price,trading_date,observed_at")
      .order("trading_date", { ascending: false }),
    supabase
      .from("filing_events")
      .select("id,company_id,form_type,filed_at,title,filing_url,created_at")
      .order("filed_at", { ascending: false })
      .limit(80),
    supabase
      .from("ranking_history")
      .select("company_id,ranked_at,rank,overall_score,price,base_fair_value")
      .order("ranked_at", { ascending: false })
      .limit(200),
    supabase
      .from("capital_activity")
      .select("id,company_id,activity_type,actor_name,actor_detail,action,shares,price,value,change_pct,amount_range,transaction_date,disclosure_date,position_date,source_url,provider,created_at")
      .order("created_at", { ascending: false })
      .limit(250),
    supabase
      .from("intelligence_events")
      .select("id,company_id,source_kind,event_type,occurred_at,disclosed_at,title,summary,materiality,review_status,research_run_id,source_url,created_at")
      .order("disclosed_at", { ascending: false, nullsFirst: false })
      .limit(150),
    supabase
      .from("ranking_explanations")
      .select("company_id,previous_rank,rank_delta,score_delta,price_delta_pct,valuation_gap_delta_pct,explanation,created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("prediction_snapshots")
      .select("id,company_id,prediction_key,predicted_at,horizon_months,thesis_status,confidence")
      .order("predicted_at", { ascending: false })
      .limit(50),
    supabase
      .from("prediction_scores")
      .select("id,scored_at,direction_correct,absolute_error,percentage_error,benchmark_excess_return")
      .order("scored_at", { ascending: false })
      .limit(100),
    supabase
      .from("automation_runs")
      .select("pipeline,started_at,completed_at,status,records_written,message")
      .order("started_at", { ascending: false })
      .limit(30),
  ]);

  const companies = companiesResult.data ?? [];
  const runs = runsResult.data ?? [];
  const companyById = new Map(companies.map((company: any) => [company.id, company]));

  const latestRunByCompany = new Map<string, any>();
  for (const run of runs) {
    if (!latestRunByCompany.has(run.company_id)) latestRunByCompany.set(run.company_id, run);
  }

  const latestRuns = Array.from(latestRunByCompany.values());
  const runIds = latestRuns.map((run) => run.id);
  const [scoresResult, valuationsResult] = runIds.length
    ? await Promise.all([
        supabase
          .from("scores")
          .select("research_run_id,overall_score,quality_score,valuation_score,thesis_integrity_score")
          .in("research_run_id", runIds),
        supabase
          .from("valuations")
          .select("research_run_id,base_value,bear_value,bull_value")
          .in("research_run_id", runIds),
      ])
    : [{ data: [] as any[] }, { data: [] as any[] }];

  const scoreMap = new Map((scoresResult.data ?? []).map((row: any) => [row.research_run_id, row]));
  const valuationMap = new Map((valuationsResult.data ?? []).map((row: any) => [row.research_run_id, row]));

  const latestMarketByTicker = new Map<string, any>();
  for (const row of marketResult.data ?? []) {
    if (!latestMarketByTicker.has(row.symbol)) latestMarketByTicker.set(row.symbol, row);
  }

  const rankingHistoryByCompany = new Map<string, any[]>();
  for (const row of rankingResult.data ?? []) {
    const existing = rankingHistoryByCompany.get(row.company_id) ?? [];
    existing.push(row);
    rankingHistoryByCompany.set(row.company_id, existing);
  }

  const ranked = latestRuns
    .map((run: any) => {
      const company: any = companyById.get(run.company_id);
      if (!company) return null;
      const scores: any = scoreMap.get(run.id) ?? {};
      const valuation: any = valuationMap.get(run.id) ?? {};
      const market = latestMarketByTicker.get(company.ticker);
      const price = num(market?.price) ?? num(run.price_at_research);
      const base = num(valuation.base_value);
      return {
        company,
        run,
        scores,
        price,
        base,
        marketDate: market?.trading_date ?? null,
        gap: valuationGap(price, base),
      };
    })
    .filter(Boolean)
    .sort(
      (a: any, b: any) =>
        (num(b.scores.overall_score) ?? -1) - (num(a.scores.overall_score) ?? -1),
    );

  const currentRank = new Map(ranked.map((item: any, index: number) => [item.company.id, index + 1]));
  const rankDelta = (companyId: string) => {
    const history = rankingHistoryByCompany.get(companyId) ?? [];
    const prior = history.find((row) => row.rank !== currentRank.get(companyId));
    if (!prior) return null;
    return prior.rank - (currentRank.get(companyId) ?? prior.rank);
  };

  const filings = uniqueFilings(filingsResult.data ?? [], companyById);
  const today = new Date();
  const recentCutoff = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
  const recentFilings = filings.filter(
    (filing) => new Date(filing.filed_at + "T00:00:00Z") >= recentCutoff,
  );

  const intelligenceEvents = (eventsResult.data ?? []).map((event: any) => ({
    ...event,
    company: companyById.get(event.company_id),
  })).filter((event: any) => event.company);

  const recentChanges = intelligenceEvents
    .filter((event: any) => event.source_kind !== "capital_activity")
    .slice(0, 8);

  const needsAttention = intelligenceEvents.filter(
    (event: any) =>
      event.review_status === "open" &&
      (event.materiality === "review" || event.materiality === "high"),
  );

  const capitalItems = buildCapitalActivity(capitalResult.data ?? [], companyById);

  const rankingExplanationByCompany = new Map<string, any>();
  for (const row of rankingExplanationsResult.data ?? []) {
    if (!rankingExplanationByCompany.has(row.company_id)) {
      rankingExplanationByCompany.set(row.company_id, row);
    }
  }
  const predictions = predictionsResult.data ?? [];
  const predictionScores = predictionScoresResult.data ?? [];
  const directionScores = predictionScores.filter((score: any) => score.direction_correct != null);
  const directionCorrect = directionScores.filter((score: any) => score.direction_correct).length;

  const latestAutomation = (automationResult.data ?? []).find((row: any) => row.completed_at);
  const latestMarketDate = Array.from(latestMarketByTicker.values())
    .map((row: any) => row.trading_date)
    .filter(Boolean)
    .sort()
    .at(-1);

  const marketRun = (automationResult.data ?? []).find(
    (row: any) => row.pipeline === "market_snapshots",
  );
  const providerRun = (automationResult.data ?? []).find(
    (row: any) => row.pipeline === "fmp_fundamentals_filings",
  );

  return (
    <div className={styles.commandPage}>
      <header className={styles.topbar}>
        <SolpientBrand className={styles.wordmark} subtitle="Research" priority />

        <nav className={styles.nav}>
          <Link className={styles.activeNav} href="/">Home</Link>
          <Link href="/research">Research</Link>
          <Link href="/watchlist">Watchlist</Link>
          <a href="#predictions">Predictions</a>
          <Link href="/alerts">Alerts</Link>
        </nav>

        <div className={styles.headerTools}>
          <Link href="/research" className={styles.searchBox}>
            <span>⌕</span> Search companies…
          </Link>
          <span className={styles.avatar}>S</span>
        </div>
      </header>

      <main className={styles.commandMain}>
        <section className={styles.hero}>
          <div className={styles.heroArt} aria-hidden="true"><i /><b /></div>
          <div className={styles.heroCopy}>
            <span className={styles.kicker}>SOLPIENT DAILY INTELLIGENCE</span>
            <h1>Your Morning Research Briefing</h1>
            <p>Actionable changes from fundamental research, filings, valuation, and disclosed capital activity—not market noise.</p>
            <div className={styles.heroMeta}>
              <span><b>▥</b> {companies.length} companies tracked</span>
              <span><b>◷</b> Last intelligence update: {displayDateTime(latestAutomation?.completed_at)}</span>
              <span><b>▣</b> Market data through: {displayDate(latestMarketDate, true)}</span>
            </div>
          </div>
          <blockquote>
            “Focus on what changed, not just what is.”
            <span>— SOLPIENT</span>
          </blockquote>
        </section>

        <div className={styles.dashboardGrid}>
          <section className={styles.rankingPanel}>
            <div className={styles.panelHeader}>
              <div>
                <span className={styles.panelEyebrow}>RESEARCH PRIORITY</span>
                <h2>Research Ranking</h2>
              </div>
              <Link href="/research">View all companies →</Link>
            </div>

            <div className={styles.rankHeader}>
              <span>#</span><span>Company</span><span>Score</span><span>Price</span>
              <span>Base value</span><span>Valuation</span><span>Change</span><span>Why</span>
            </div>

            <div className={styles.rankList}>
              {ranked.length ? ranked.slice(0, 6).map((item: any, index: number) => {
                const valuation = valuationText(item.gap);
                const why = rankingExplanationByCompany.get(item.company.id);
                const delta = why?.rank_delta ?? rankDelta(item.company.id);
                return (
                  <Link className={styles.rankRow} href={"/research/" + item.company.ticker} key={item.company.id}>
                    <span className={styles.rankNumber}>{index + 1}</span>
                    <div className={styles.companyCell}>
                      <span className={styles.companyMark}>{item.company.ticker.slice(0, 2)}</span>
                      <div><strong>{item.company.company_name}</strong><small>{item.company.ticker}</small></div>
                    </div>
                    <strong>{num(item.scores.overall_score) ?? "—"}</strong>
                    <span>{money(item.price)}</span>
                    <span>{money(item.base)}</span>
                    <strong className={valuation.tone}>{valuation.label}</strong>
                    <span className={delta == null ? styles.neutralText : delta > 0 ? styles.positiveText : styles.negativeText}>
                      {delta == null ? "—" : delta > 0 ? "↑ " + delta : "↓ " + Math.abs(delta)}
                    </span>
                    <span className={styles.rankWhy}>{why?.explanation ?? "No prior ranking movement to explain yet."}</span>
                  </Link>
                );
              }) : (
                <div className={styles.emptyCompact}>Published research will appear here when available.</div>
              )}
            </div>
            <p className={styles.rankingNote}>Rankings prioritize research attention. They are not an automatic buy list.</p>
          </section>

          <aside className={styles.glancePanel}>
            <div className={styles.panelHeader}>
              <div><span className={styles.panelEyebrow}>STATUS</span><h2>Today at a Glance</h2></div>
              <span>{displayDate(today.toISOString(), true)}</span>
            </div>
            <div className={styles.glanceGrid}>
              <div className={styles.greenCard}><Icon>↗</Icon><strong>{ranked.length}</strong><span>Published research records</span></div>
              <div className={styles.blueCard}><Icon>▤</Icon><strong>{recentFilings.length}</strong><span>New filings in 14 days</span></div>
              <div className={styles.goldCard}><Icon>◉</Icon><strong>{capitalItems.length}</strong><span>Tracked capital disclosures</span></div>
              <div className={styles.grayCard}><Icon>⌁</Icon><strong>{marketRun?.records_written ?? "—"}</strong><span>Market snapshots refreshed</span></div>
            </div>
            <div className={styles.glanceQuote}>“Intelligence is useful when it reduces the next decision.”</div>
          </aside>
        </div>

        <div className={styles.twoColumn}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div><span className={styles.panelEyebrow}>EVIDENCE DELTA</span><h2>What Changed</h2></div>
              <Link href="/research">View research →</Link>
            </div>
            <div className={styles.changeList}>
              {recentChanges.slice(0, 6).map((event: any) => {
                const href = event.source_url ?? (event.research_run_id ? "/research/" + event.company.ticker : "/alerts");
                const external = Boolean(event.source_url);
                return (
                  <a
                    className={styles.changeRow}
                    href={href}
                    target={external ? "_blank" : undefined}
                    rel={external ? "noreferrer" : undefined}
                    key={event.id}
                  >
                    <div className={styles.tickerMark}>{event.company.ticker}</div>
                    <div>
                      <strong>{event.title}</strong>
                      <p>{event.summary ?? "New evidence entered the Solpient research queue."}</p>
                      <span>{displayDate(event.disclosed_at ?? event.occurred_at ?? event.created_at, true)} · {event.review_status === "incorporated" ? "Incorporated into research" : "Review queue"}</span>
                    </div>
                    <span>↗</span>
                  </a>
                );
              })}
              {!recentChanges.length ? <div className={styles.emptyCompact}>No new evidence changes are waiting to be shown.</div> : null}
            </div>
          </section>

          <CapitalActivity items={capitalItems} />
        </div>

        <div className={styles.bottomGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div><span className={styles.panelEyebrow}>VERSION LEDGER</span><h2>Solpient Changes</h2></div>
              <Link href="/research">View history →</Link>
            </div>
            <p className={styles.panelIntro}>The latest changes made by Solpient itself—not just changes in the market.</p>
            <div className={styles.systemChangeList}>
              {runs.slice(0, 3).map((run: any) => {
                const company: any = companyById.get(run.company_id);
                const score: any = scoreMap.get(run.id);
                const valuation: any = valuationMap.get(run.id);
                return (
                  <Link href={company ? "/research/" + company.ticker : "/research"} className={styles.systemChange} key={run.id}>
                    <span>{company?.ticker ?? "—"}</span>
                    <div><strong>Research v{run.version} published</strong><small>{displayDateTime(run.researched_at)}</small></div>
                    <em>{num(score?.overall_score) != null ? "Score " + num(score?.overall_score) : valuation?.base_value ? money(num(valuation.base_value)) : "Open"}</em>
                  </Link>
                );
              })}
              {marketRun ? (
                <div className={styles.systemChange}>
                  <span>MKT</span><div><strong>Market snapshots refreshed</strong><small>{displayDateTime(marketRun.completed_at)}</small></div><em>{marketRun.records_written ?? 0} rows</em>
                </div>
              ) : null}
              {providerRun ? (
                <div className={styles.systemChange}>
                  <span>DATA</span><div><strong>Fundamentals & filings sync</strong><small>{providerRun.status} · {displayDateTime(providerRun.completed_at)}</small></div><em>{providerRun.records_written ?? 0} rows</em>
                </div>
              ) : null}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div><span className={styles.panelEyebrow}>REVIEW QUEUE</span><h2>Needs Attention</h2></div>
              <Link href="/alerts">View alerts →</Link>
            </div>
            <div className={styles.attentionList}>
              {needsAttention.slice(0, 7).map((event: any) => (
                <a
                  href={event.source_url ?? ("/research/" + event.company.ticker)}
                  target={event.source_url ? "_blank" : undefined}
                  rel={event.source_url ? "noreferrer" : undefined}
                  key={event.id}
                >
                  <span className={styles.attentionDot}>!</span>
                  <strong>{event.company.ticker}</strong>
                  <p>{event.title}</p>
                  <small>{displayDate(event.disclosed_at ?? event.occurred_at ?? event.created_at)}</small>
                </a>
              ))}
              {!needsAttention.length ? <div className={styles.emptyCompact}>No unreviewed filings in the current queue.</div> : null}
            </div>
          </section>

          <section className={styles.panel} id="predictions">
            <div className={styles.panelHeader}>
              <div><span className={styles.panelEyebrow}>CALIBRATION</span><h2>Prediction Tracker</h2></div>
            </div>
            <div className={styles.predictionStats}>
              <div><strong>{predictions.length}</strong><span>Locked predictions</span></div>
              <div><strong>{predictionScores.length}</strong><span>Matured scores</span></div>
              <div><strong>{directionScores.length ? directionCorrect + "/" + directionScores.length : "—"}</strong><span>Correct direction</span></div>
            </div>
            <div className={styles.predictionList}>
              {predictions.slice(0, 4).map((prediction: any) => {
                const company: any = companyById.get(prediction.company_id);
                return (
                  <Link href={company ? "/research/" + company.ticker : "/research"} key={prediction.id}>
                    <span>{company?.ticker ?? "—"}</span>
                    <div><strong>{prediction.prediction_key.replaceAll("_", " ")}</strong><small>{prediction.horizon_months ?? "—"} month horizon</small></div>
                    <em>{prediction.thesis_status ?? "Locked"}</em>
                  </Link>
                );
              })}
              {!predictions.length ? (
                <div className={styles.predictionEmpty}>
                  <strong>Calibration begins with the first locked prediction.</strong>
                  <span>Solpient will score outcomes without rewriting the original forecast.</span>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </main>

      <footer className={styles.footer}>
        <div><strong>SOLPIENT</strong><span>See clearly. Invest deliberately.</span></div>
        <span>Research prioritization · evidence · version history · calibration</span>
      </footer>
    </div>
  );
}
