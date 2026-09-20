import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { getAllCompanyIntelligence } from "@/lib/market-intelligence";
import { CapitalActivity, type CapitalActivityItem } from "@/components/CapitalActivity";
import styles from "./home.module.css";

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

function buildCapitalActivity(companyByTicker: Map<string, any>): CapitalActivityItem[] {
  const items: (CapitalActivityItem & { sortDate: string })[] = [];

  for (const intelligence of getAllCompanyIntelligence()) {
    const company = companyByTicker.get(intelligence.ticker);
    const companyName = company?.company_name ?? intelligence.ticker;

    intelligence.smartMoney.forEach((holding, index) => {
      const action =
        holding.changePct == null
          ? "Reported"
          : holding.changePct > 0
            ? "Increased"
            : holding.changePct < 0
              ? "Reduced"
              : "Unchanged";
      items.push({
        id: intelligence.ticker + "-investor-" + index,
        ticker: intelligence.ticker,
        company: companyName,
        category: "investors",
        actor: holding.investor ?? holding.manager,
        action,
        detail:
          holding.manager +
          " reported " +
          new Intl.NumberFormat("en-US").format(holding.shares) +
          " shares · " +
          compactMoney(holding.value),
        dateLabel: "Position reported as of " + displayDate(holding.reportDate, true),
        sourceUrl: holding.sourceUrl,
        tone:
          holding.changePct == null || holding.changePct === 0
            ? "neutral"
            : holding.changePct > 0
              ? "positive"
              : "negative",
        sortDate: holding.reportDate,
      });
    });

    intelligence.insiders.forEach((trade, index) => {
      items.push({
        id: intelligence.ticker + "-insider-" + index,
        ticker: intelligence.ticker,
        company: companyName,
        category: "insiders",
        actor: trade.insider,
        action: trade.action,
        detail:
          (trade.title ?? "Insider") +
          " · " +
          new Intl.NumberFormat("en-US").format(trade.shares) +
          " shares at $" +
          trade.price.toFixed(2),
        dateLabel: "Transaction " + displayDate(trade.tradeDate, true),
        sourceUrl: trade.sourceUrl,
        tone: trade.action === "Buy" ? "positive" : "negative",
        sortDate: trade.tradeDate,
      });
    });

    intelligence.congress.forEach((trade, index) => {
      items.push({
        id: intelligence.ticker + "-congress-" + index,
        ticker: intelligence.ticker,
        company: companyName,
        category: "congress",
        actor: trade.politician,
        action: trade.action,
        detail: trade.chamber + " disclosure · " + trade.amountRange,
        dateLabel:
          "Traded " +
          displayDate(trade.tradeDate, true) +
          " · filed " +
          displayDate(trade.filingDate, true),
        sourceUrl: trade.sourceUrl,
        tone: trade.action === "Purchase" ? "positive" : "negative",
        sortDate: trade.filingDate,
      });
    });
  }

  return items
    .sort((a, b) => b.sortDate.localeCompare(a.sortDate))
    .map(({ sortDate: _sortDate, ...item }) => item);
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
      .limit(100),
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
  const companyByTicker = new Map(companies.map((company: any) => [company.ticker, company]));

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
  const today = new Date("2026-09-20T12:00:00Z");
  const recentCutoff = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
  const recentFilings = filings.filter(
    (filing) => new Date(filing.filed_at + "T00:00:00Z") >= recentCutoff,
  );

  const needsAttention = filings.filter((filing) => {
    const latestRun = latestRunByCompany.get(filing.company_id);
    if (!latestRun) return true;
    return (
      new Date(filing.filed_at + "T23:59:59Z").getTime() >
      new Date(latestRun.researched_at).getTime()
    );
  });

  const capitalItems = buildCapitalActivity(companyByTicker);
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
        <Link href="/" className={styles.wordmark}>
          <strong>SOLPIENT</strong>
          <span>See clearly. Invest deliberately.</span>
        </Link>

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
              <span>Base value</span><span>Valuation</span><span>Change</span>
            </div>

            <div className={styles.rankList}>
              {ranked.length ? ranked.slice(0, 6).map((item: any, index: number) => {
                const valuation = valuationText(item.gap);
                const delta = rankDelta(item.company.id);
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
              {recentFilings.slice(0, 6).map((filing: any) => (
                <a className={styles.changeRow} href={filing.filing_url} target="_blank" rel="noreferrer" key={filing.id}>
                  <div className={styles.tickerMark}>{filing.company.ticker}</div>
                  <div>
                    <strong>New {filing.form_type} filed</strong>
                    <p>{filing.company.company_name} added a new primary-source filing to the monitoring queue.</p>
                    <span>Filed {displayDate(filing.filed_at, true)} · Review before changing the thesis</span>
                  </div>
                  <span>↗</span>
                </a>
              ))}
              {!recentFilings.length ? <div className={styles.emptyCompact}>No new tracked filings in the last 14 days.</div> : null}
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
              {needsAttention.slice(0, 7).map((filing: any) => (
                <a href={filing.filing_url} target="_blank" rel="noreferrer" key={filing.id}>
                  <span className={styles.attentionDot}>!</span>
                  <strong>{filing.company.ticker}</strong>
                  <p>{filing.form_type} filed after latest published research</p>
                  <small>{displayDate(filing.filed_at)}</small>
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
