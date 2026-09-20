import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function formatMoney(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number | null | undefined, suffix = "") {
  if (value == null) return "—";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}${suffix}`;
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
      <main>
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
      <main>
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

  const scores = scoresResult.data;
  const valuation = valuationResult.data;
  const metrics = metricsResult.data;
  const thesis = thesisResult.data ?? [];
  const sources = sourcesResult.data ?? [];
  const history = historyResult.data ?? [];
  const changes = changesResult.data ?? [];
  const isLatest = history[0]?.version === run.version;

  return (
    <main>
      <Link className="backLink" href="/research">← Research</Link>

      <section className="companyHeader">
        <div>
          <div className="eyebrow">{company.exchange ?? "EQUITY"} · {company.ticker}</div>
          <h1>{company.company_name}</h1>
          <p>{company.description ?? "Fundamental research and valuation history."}</p>
        </div>
        <div className="versionBadge">
          <span>RESEARCH VERSION</span>
          <strong>v{run.version}</strong>
          <small>{new Date(run.researched_at).toLocaleDateString("en-US")}</small>
          {!isLatest ? (
            <Link className="latestLink" href={`/research/${company.ticker}`}>
              View latest →
            </Link>
          ) : null}
        </div>
      </section>

      <section className="scoreGrid">
        {[
          ["Overall", scores?.overall_score],
          ["Quality", scores?.quality_score],
          ["Growth", scores?.growth_score],
          ["Valuation", scores?.valuation_score],
          ["Financial strength", scores?.financial_strength_score],
          ["Thesis integrity", scores?.thesis_integrity_score],
        ].map(([label, value]) => (
          <article className="metricCard" key={String(label)}>
            <span>{label}</span>
            <strong>{value == null ? "—" : formatNumber(Number(value))}</strong>
          </article>
        ))}
      </section>

      <section className="sectionBlock">
        <div className="sectionHeading">
          <span>01</span>
          <h2>Investment snapshot</h2>
        </div>
        <div className="dataGrid">
          <div><span>Price at research</span><strong>{formatMoney(run.price_at_research)}</strong></div>
          <div><span>Base fair value</span><strong>{formatMoney(valuation?.base_value)}</strong></div>
          <div><span>Bear value</span><strong>{formatMoney(valuation?.bear_value)}</strong></div>
          <div><span>Bull value</span><strong>{formatMoney(valuation?.bull_value)}</strong></div>
          <div><span>25% MOS price</span><strong>{formatMoney(valuation?.mos_25_price)}</strong></div>
          <div><span>35% MOS price</span><strong>{formatMoney(valuation?.mos_35_price)}</strong></div>
        </div>
      </section>

      <section className="sectionBlock">
        <div className="sectionHeading">
          <span>02</span>
          <h2>Financial quality</h2>
        </div>
        <div className="dataGrid">
          <div><span>Revenue growth</span><strong>{formatNumber(metrics?.revenue_growth_1y, "%")}</strong></div>
          <div><span>5Y revenue CAGR</span><strong>{formatNumber(metrics?.revenue_cagr_5y, "%")}</strong></div>
          <div><span>Gross margin</span><strong>{formatNumber(metrics?.gross_margin, "%")}</strong></div>
          <div><span>FCF margin</span><strong>{formatNumber(metrics?.fcf_margin, "%")}</strong></div>
          <div><span>ROIC</span><strong>{formatNumber(metrics?.roic, "%")}</strong></div>
          <div><span>Debt / equity</span><strong>{formatNumber(metrics?.debt_to_equity)}</strong></div>
          <div><span>P/E</span><strong>{formatNumber(metrics?.pe)}</strong></div>
          <div><span>Forward P/E</span><strong>{formatNumber(metrics?.forward_pe)}</strong></div>
        </div>
      </section>

      <section className="sectionBlock changeSection">
        <div className="sectionHeading">
          <span>03</span>
          <h2>What changed</h2>
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
            <p>The current version did not cross SOLPIENT's deterministic change thresholds.</p>
          </div>
        )}
      </section>

      <section className="sectionBlock">
        <div className="sectionHeading">
          <span>04</span>
          <h2>Thesis monitor</h2>
        </div>
        {thesis.length > 0 ? (
          <div className="thesisList">
            {thesis.map((item) => (
              <article className="thesisRow" key={item.id}>
                <div>
                  <strong>{item.variable_name}</strong>
                  <p>{item.expectation ?? "Expectation pending."}</p>
                  {item.observed_value ? <small>{item.observed_value}</small> : null}
                </div>
                <span className={`statusPill ${item.status ?? "unknown"}`}>
                  {item.status ?? "unknown"}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">Thesis variables have not been recorded for this version.</p>
        )}
      </section>

      <section className="sectionBlock">
        <div className="sectionHeading">
          <span>05</span>
          <h2>Full research</h2>
        </div>
        <p className="researchSummary">{run.summary ?? "Summary pending."}</p>
        <div className="fullReport">{run.full_report ?? "Full report pending."}</div>
      </section>

      <section className="sectionBlock">
        <div className="sectionHeading">
          <span>06</span>
          <h2>Research history</h2>
        </div>
        <div className="historyList">
          {history.map((item) => (
            <Link
              className={`historyRow ${item.version === run.version ? "activeVersion" : ""}`}
              href={`/research/${company.ticker}?version=${item.version}`}
              key={item.id}
            >
              <strong>Version {item.version}</strong>
              <span>{new Date(item.researched_at).toLocaleDateString("en-US")}</span>
              <span>{formatMoney(item.price_at_research)}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="sectionBlock">
        <div className="sectionHeading">
          <span>07</span>
          <h2>Sources</h2>
        </div>
        {sources.length > 0 ? (
          <div className="sourceList">
            {sources.map((source) => (
              <div className="sourceRow" key={source.id}>
                <div>
                  <strong>{source.title}</strong>
                  <span>{source.source_type}</span>
                </div>
                {source.url ? <a href={source.url} target="_blank" rel="noreferrer">Open source ↗</a> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No sources recorded yet.</p>
        )}
      </section>
    </main>
  );
}
