import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { getHistoricalFinancials } from "@/lib/historical-financials";

export const dynamic = "force-dynamic";

function formatMoney(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default async function Home() {
  const supabase = getSupabase();
  const historical = getHistoricalFinancials("ADBE");

  let company: any = null;
  let run: any = null;
  let scores: any = null;
  let valuation: any = null;

  if (supabase) {
    const companyResult = await supabase
      .from("companies")
      .select("id,ticker,company_name,sector,industry")
      .eq("ticker", "ADBE")
      .maybeSingle();

    company = companyResult.data;

    if (company) {
      const runResult = await supabase
        .from("research_runs")
        .select("id,version,researched_at,price_at_research,summary")
        .eq("company_id", company.id)
        .eq("status", "published")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      run = runResult.data;

      if (run) {
        const [scoreResult, valuationResult] = await Promise.all([
          supabase.from("scores").select("*").eq("research_run_id", run.id).maybeSingle(),
          supabase.from("valuations").select("*").eq("research_run_id", run.id).maybeSingle(),
        ]);
        scores = scoreResult.data;
        valuation = valuationResult.data;
      }
    }
  }

  const price = asNumber(run?.price_at_research);
  const baseValue = asNumber(valuation?.base_value);
  const upside =
    price != null && baseValue != null && price !== 0
      ? ((baseValue / price) - 1) * 100
      : null;

  const adbeBars = historical?.points ?? [];
  const maxRevenue = Math.max(...adbeBars.map((p) => p.revenue), 1);

  return (
    <>
      <header className="siteHeader landingHeader">
        <Link className="brand" href="/">
          <strong>SOLPIENT</strong>
          <span>Research</span>
        </Link>
        <nav>
          <Link href="/research">Research</Link>
          <a href="#solpient20">SOLPIENT 20</a>
          <a href="#method">Methodology</a>
        </nav>
      </header>

      <main className="landingShell">
        <section className="landingHero">
          <div className="landingHeroCopy">
            <div className="heroChip">
              <span className="liveDot" />
              Evidence-led fundamental research
            </div>

            <h1>
              See clearly.
              <br />
              <span>Invest deliberately.</span>
            </h1>

            <p>
              SOLPIENT turns filings, fundamentals, valuation, and thesis evidence into a
              living research record—so you can see what changed without rewriting the past.
            </p>

            <div className="landingActions">
              <Link className="landingPrimary" href="/research/ADBE">
                Explore Adobe research
                <span>→</span>
              </Link>
              <Link className="landingSecondary" href="/research">
                Browse all research
              </Link>
            </div>

            <div className="trustRow">
              <span>Primary-source evidence</span>
              <i />
              <span>Versioned research</span>
              <i />
              <span>Deterministic change tracking</span>
            </div>
          </div>

          <div className="heroTerminalWrap">
            <div className="heroGlow" />
            <article className="heroTerminal">
              <div className="terminalTop">
                <div>
                  <span className="terminalEyebrow">LIVE RESEARCH</span>
                  <h2>{company?.ticker ?? "ADBE"} · {company?.company_name ?? "Adobe"}</h2>
                </div>
                <span className="terminalVersion">v{run?.version ?? 1}</span>
              </div>

              <div className="terminalMetricRow">
                <div>
                  <span>Price at research</span>
                  <strong>{formatMoney(price)}</strong>
                </div>
                <div>
                  <span>Base fair value</span>
                  <strong>{formatMoney(baseValue)}</strong>
                </div>
                <div>
                  <span>Upside to base</span>
                  <strong className="positiveText">
                    {upside == null ? "—" : `+${upside.toFixed(1)}%`}
                  </strong>
                </div>
              </div>

              <div className="terminalBody">
                <div className="terminalChart">
                  <div className="terminalChartHeader">
                    <span>5Y revenue</span>
                    <strong>FY2021–FY2025</strong>
                  </div>
                  <div className="miniBars">
                    {adbeBars.map((point) => (
                      <div className="miniBarCol" key={point.fiscalYear}>
                        <i style={{ height: `${Math.max((point.revenue / maxRevenue) * 100, 10)}%` }} />
                        <small>{String(point.fiscalYear).slice(-2)}</small>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="terminalScore">
                  <div
                    className="landingScoreRing"
                    style={{
                      background: `conic-gradient(#58d68d 0deg ${(asNumber(scores?.overall_score) ?? 0) * 3.6}deg, #232833 ${(asNumber(scores?.overall_score) ?? 0) * 3.6}deg 360deg)`,
                    }}
                  >
                    <div>
                      <strong>{asNumber(scores?.overall_score) ?? "—"}</strong>
                      <span>Overall</span>
                    </div>
                  </div>
                  <div className="terminalScoreList">
                    <div><span>Quality</span><strong>{asNumber(scores?.quality_score) ?? "—"}</strong></div>
                    <div><span>Valuation</span><strong>{asNumber(scores?.valuation_score) ?? "—"}</strong></div>
                    <div><span>Thesis</span><strong>{asNumber(scores?.thesis_integrity_score) ?? "—"}</strong></div>
                  </div>
                </div>
              </div>

              <div className="terminalFooter">
                <span className="statusPulse"><i /> Published research</span>
                <Link href="/research/ADBE">Open full analysis ↗</Link>
              </div>
            </article>
          </div>
        </section>

        <section className="landingProofStrip">
          <div>
            <span>01</span>
            <strong>Research that remembers</strong>
            <p>Every published thesis becomes a timestamped version, not an overwritten document.</p>
          </div>
          <div>
            <span>02</span>
            <strong>Evidence before narrative</strong>
            <p>Important claims stay tied to filings, earnings releases, and source records.</p>
          </div>
          <div>
            <span>03</span>
            <strong>Change becomes visible</strong>
            <p>Fundamentals, valuation, scores, and thesis conditions are compared across versions.</p>
          </div>
        </section>

        <section className="landingFeatureSection" id="method">
          <div className="landingSectionIntro">
            <span className="panelKicker">WHY SOLPIENT</span>
            <h2>Most research tools help you analyze today. SOLPIENT helps you remember yesterday.</h2>
            <p>
              The edge is not another AI summary. It is a durable record of what the business looked
              like, what the thesis required, how valuation changed, and whether your reasoning held up.
            </p>
          </div>

          <div className="featureMosaic">
            <article className="featureLarge">
              <div className="featureIcon">⌁</div>
              <span>THESIS INTEGRITY</span>
              <h3>Track what must remain true.</h3>
              <p>
                Convert a narrative thesis into explicit conditions and monitor whether each one is
                strengthened, unchanged, or weakened as new evidence arrives.
              </p>
              <div className="thesisPreview">
                <div><i className="previewGreen" /><span>Recurring revenue durability</span><strong>Strengthened</strong></div>
                <div><i className="previewGreen" /><span>AI monetization</span><strong>Strengthened</strong></div>
                <div><i className="previewNeutral" /><span>Workflow moat</span><strong>Unchanged</strong></div>
              </div>
            </article>

            <article className="featureSmall">
              <span>WHAT CHANGED?</span>
              <h3>Read the delta, not the whole report again.</h3>
              <div className="deltaPreview">
                <div><span>Revenue growth</span><strong>+2.1 pp</strong></div>
                <div><span>Base fair value</span><strong>+6.7%</strong></div>
                <div><span>Thesis status</span><strong>Strengthened</strong></div>
              </div>
            </article>

            <article className="featureSmall">
              <span>EVIDENCE LEDGER</span>
              <h3>Keep the proof beside the conclusion.</h3>
              <div className="sourcePreview">
                <span>10-K</span>
                <span>10-Q</span>
                <span>Earnings</span>
                <span>Investor materials</span>
              </div>
            </article>

            <article className="featureWide">
              <div>
                <span>RESEARCH LEDGER</span>
                <h3>Nothing important gets overwritten.</h3>
                <p>
                  Version history preserves price, fair value, scores, thesis conditions, sources, and
                  the exact research view at that point in time.
                </p>
              </div>
              <div className="ledgerPreview">
                <div className="ledgerNode active"><strong>v1</strong><span>Baseline</span></div>
                <i />
                <div className="ledgerNode"><strong>v2</strong><span>Next filing</span></div>
                <i />
                <div className="ledgerNode"><strong>v3</strong><span>Future evidence</span></div>
              </div>
            </article>
          </div>
        </section>

        <section className="solpient20Section" id="solpient20">
          <div className="solpient20Header">
            <div>
              <span className="panelKicker">SOLPIENT 20</span>
              <h2>A focused research universe.</h2>
              <p>
                A shortlist of companies worthy of deeper fundamental work—not an automatic buy list.
              </p>
            </div>
            <Link href="/research">View research universe →</Link>
          </div>

          <div className="solpient20Grid">
            <Link href="/research/ADBE" className="solpientCompany liveCompany">
              <div className="companyMonogram">AD</div>
              <div>
                <span>ADBE</span>
                <strong>Adobe</strong>
                <small>Published research</small>
              </div>
              <em>Live →</em>
            </Link>

            {[
              ["MSFT", "Microsoft"],
              ["META", "Meta Platforms"],
              ["GOOGL", "Alphabet"],
              ["COST", "Costco"],
            ].map(([ticker, name]) => (
              <div className="solpientCompany queuedCompany" key={ticker}>
                <div className="companyMonogram">{ticker.slice(0, 2)}</div>
                <div>
                  <span>{ticker}</span>
                  <strong>{name}</strong>
                  <small>Next research target</small>
                </div>
                <em>Queued</em>
              </div>
            ))}
          </div>
        </section>

        <section className="landingClosing">
          <div>
            <span className="panelKicker">BUILT FOR DELIBERATE INVESTORS</span>
            <h2>Less noise. Better memory. Clearer decisions.</h2>
            <p>
              Start with the live Adobe research record and see how SOLPIENT turns a company into a
              structured, versioned investment thesis.
            </p>
          </div>
          <Link className="landingPrimary" href="/research/ADBE">
            Open ADBE research <span>→</span>
          </Link>
        </section>
      </main>

      <footer className="siteFooter landingFooter">
        <div>
          <strong>SOLPIENT</strong>
          <span>See clearly. Invest deliberately.</span>
        </div>
        <span>Fundamental research · evidence · version history</span>
      </footer>
    </>
  );
}
