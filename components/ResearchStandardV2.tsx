import { getSupabase } from "@/lib/supabase";
import { getResearchTemporalContext } from "@/lib/research-temporal";
import styles from "./ResearchStandardV2.module.css";

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: unknown) {
  const n = num(value);
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

function pct(value: unknown) {
  const n = num(value);
  return n == null ? "—" : n.toFixed(1) + "%";
}

function multiple(value: unknown) {
  const n = num(value);
  return n == null ? "—" : n.toFixed(2) + "×";
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function text(value: unknown, fallback = "Not yet reviewed.") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export async function ResearchStandardV2({
  researchRunId,
}: {
  researchRunId: string;
}) {
  const supabase = getSupabase();
  if (!supabase) return null;

  const [
    runResult,
    sectionResult,
    businessResult,
    returnResult,
    riskResult,
    valuationResult,
    metricsResult,
  ] = await Promise.all([
    supabase
      .from("research_runs")
      .select("company_id,standard_version,standard_status,completeness_pct,benchmark_ticker")
      .eq("id", researchRunId)
      .maybeSingle(),
    supabase
      .from("research_v2_sections")
      .select("*")
      .eq("research_run_id", researchRunId)
      .maybeSingle(),
    supabase
      .from("business_assessments")
      .select("*")
      .eq("research_run_id", researchRunId)
      .maybeSingle(),
    supabase
      .from("expected_return_scenarios")
      .select("*")
      .eq("research_run_id", researchRunId)
      .order("horizon_years"),
    supabase
      .from("risk_register")
      .select("*")
      .eq("research_run_id", researchRunId),
    supabase
      .from("valuations")
      .select("*")
      .eq("research_run_id", researchRunId)
      .maybeSingle(),
    supabase
      .from("financial_metrics")
      .select("*")
      .eq("research_run_id", researchRunId)
      .maybeSingle(),
  ]);

  const run = runResult.data;
  if (!run || run.standard_version !== "solpient-v2") return null;

  const section = sectionResult.data ?? {};
  const business = businessResult.data ?? {};
  const valuation = valuationResult.data ?? {};
  const metrics = metricsResult.data ?? {};
  const investmentThesis = section.investment_thesis ?? {};
  const dashboard = section.decision_dashboard ?? {};
  const valuationAnalysis = section.valuation_analysis ?? {};
  const historical = section.historical_valuation ?? {};
  const financialQuality = section.financial_quality ?? {};
  const fundamentalScorecard = Array.isArray(section.fundamental_scorecard) ? section.fundamental_scorecard : [];
  const competitivePosition = section.competitive_position ?? {};
  const lenses = section.investment_lenses ?? {};
  const conclusion = section.final_conclusion ?? {};
  const normalized = valuationAnalysis.normalized_earnings_context ?? {};

  const temporal = await getResearchTemporalContext(supabase, researchRunId);
  const contextPack = temporal?.contextPack ?? null;

  const freeCashFlow = num(metrics.free_cash_flow);
  const shares = num(metrics.shares_outstanding);
  const fcfPerShare =
    freeCashFlow != null && shares != null && shares !== 0 ? freeCashFlow / shares : null;

  const historyMultiple = num(historical?.["3y"]?.median_multiple);
  const historicalAnchor =
    fcfPerShare != null && historyMultiple != null ? fcfPerShare * historyMultiple : null;

  const peerMultiples = Array.isArray(contextPack?.peer_comparison)
    ? contextPack.peer_comparison
        .map((peer: any) => num(peer?.metrics?.price_to_fcf))
        .filter((value: number | null): value is number => value != null)
    : [];
  const peerMedian = median(peerMultiples);
  const peerAnchor =
    fcfPerShare != null && peerMedian != null ? fcfPerShare * peerMedian : null;

  const fiveYearReturns = (returnResult.data ?? [])
    .filter((row: any) => row.horizon_years === 5)
    .sort((a: any, b: any) => {
      const order: Record<string, number> = { bear: 0, base: 1, bull: 2 };
      return (order[a.scenario] ?? 9) - (order[b.scenario] ?? 9);
    });

  const risks = [...(riskResult.data ?? [])].sort((a: any, b: any) => {
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
  });

  const valuationRows = [
    {
      label: "DCF",
      value: money(valuation.dcf_value),
      detail: "Discounted normalized free cash flow",
    },
    {
      label: "Owner earnings",
      value: money(valuation.owner_earnings_value),
      detail: "FCF-based owner-earnings proxy",
    },
    {
      label: "3Y historical P/FCF",
      value: money(historicalAnchor),
      detail:
        historyMultiple == null
          ? "History unavailable"
          : multiple(historyMultiple) + " median × normalized FCF/share",
    },
    {
      label: "Peer P/FCF",
      value: money(peerAnchor),
      detail:
        peerMedian == null
          ? "Peer anchor unavailable"
          : multiple(peerMedian) + " median across stored peers",
    },
    {
      label: "Reviewed base",
      value: money(valuation.base_value),
      detail: "Reviewed composite scenario",
    },
  ];

  return (
    <section className={styles.section} id="research-v2">
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>SOLPIENT RESEARCH STANDARD v2</span>
          <h2>Decision-grade research</h2>
          <p>
            Industry-aware evidence, explicit downside cases, auditable valuation anchors,
            expected returns, and thesis breakers.
          </p>
        </div>
        <div className={styles.status}>
          <span>{run.standard_status ?? "complete"}</span>
          <strong>
            {run.completeness_pct == null
              ? "—"
              : Number(run.completeness_pct).toFixed(1) + "%"}
          </strong>
          <small>data completeness</small>
        </div>
      </div>

      <div className={styles.summaryGrid}>
        <article className={styles.card}>
          <span className={styles.kicker}>INVESTMENT CASE</span>
          <h3>What has to go right</h3>
          <p>{text(investmentThesis.what_must_be_true)}</p>
          <div className={styles.split}>
            <div>
              <span>Bull case</span>
              <p>{text(investmentThesis.bull_thesis)}</p>
            </div>
            <div>
              <span>Bear case</span>
              <p>{text(investmentThesis.bear_thesis)}</p>
            </div>
          </div>
        </article>

        <article className={styles.card}>
          <span className={styles.kicker}>DECISION DASHBOARD</span>
          <h3>What the model is actually saying</h3>
          <div className={styles.factGrid}>
            <div><span>Business quality</span><strong>{text(dashboard.business_quality, "—")}</strong></div>
            <div><span>Moat</span><strong>{text(dashboard.moat, "—")}</strong></div>
            <div><span>Risk</span><strong>{text(dashboard.risk_level, "—")}</strong></div>
            <div><span>5Y base CAGR</span><strong>{pct(dashboard.expected_5y_base_cagr)}</strong></div>
            <div><span>Benchmark</span><strong>{run.benchmark_ticker ?? "SPY"}</strong></div>
            <div><span>Financial strength</span><strong>{num(dashboard.financial_strength) ?? "—"}</strong></div>
          </div>
          <p className={styles.note}>
            Biggest unknown: {text(dashboard.biggest_unknown, "Not yet isolated.")}
          </p>
        </article>
      </div>

      <div className={styles.summaryGrid}>
        <article className={styles.card}>
          <span className={styles.kicker}>BUSINESS ANATOMY</span>
          <h3>How the company earns and defends returns</h3>
          <div className={styles.detailGrid}>
            <div><span>Revenue model</span><p>{text(business.revenue_model)}</p></div>
            <div><span>Market position</span><p>{text(business.market_position)}</p></div>
            <div><span>Pricing power</span><p>{text(business.pricing_power)}</p></div>
            <div><span>Growth runway</span><p>{text(business.growth_runway)}</p></div>
            <div><span>Customer concentration</span><p>{text(business.customer_concentration)}</p></div>
            <div><span>Geographic exposure</span><p>{text(business.geographic_exposure)}</p></div>
            <div><span>Management quality</span><p>{text(business.management_quality)}</p></div>
            <div><span>Capital allocation</span><p>{text(business.capital_allocation_assessment)}</p></div>
          </div>
        </article>

        <article className={styles.card}>
          <span className={styles.kicker}>FINANCIAL QUALITY</span>
          <h3>What the historical economics show</h3>
          <p>{text(financialQuality.narrative)}</p>
          <div className={styles.trendColumns}>
            <div>
              <span>Improving</span>
              {(financialQuality.improving_trends ?? []).length ? (
                <ul>{financialQuality.improving_trends.map((item: string) => <li key={item}>{item}</li>)}</ul>
              ) : <p>No improving trend flagged.</p>}
            </div>
            <div>
              <span>Deteriorating</span>
              {(financialQuality.deteriorating_trends ?? []).length ? (
                <ul>{financialQuality.deteriorating_trends.map((item: string) => <li key={item}>{item}</li>)}</ul>
              ) : <p>No deteriorating trend flagged.</p>}
            </div>
          </div>
          {financialQuality.history_limitation ? (
            <p className={styles.note}>{financialQuality.history_limitation}</p>
          ) : null}
        </article>
      </div>

      <article className={styles.wideCard}>
        <div className={styles.cardHeading}>
          <div>
            <span className={styles.kicker}>FUNDAMENTAL SCORECARD</span>
            <h3>Decision-relevant metrics</h3>
          </div>
          <small>{fundamentalScorecard.length} reviewed metrics</small>
        </div>
        <div className={styles.scorecardGrid}>
          {fundamentalScorecard.map((row: any) => (
            <div key={row.metric}>
              <span>{row.metric}</span>
              <strong>
                {typeof row.current_value === "number"
                  ? row.current_value.toLocaleString("en-US", { maximumFractionDigits: 2 })
                  : String(row.current_value ?? "—")}
              </strong>
              <p>{text(row.assessment, "Assessment pending.")}</p>
            </div>
          ))}
        </div>
      </article>

      <div className={styles.summaryGrid}>
        <article className={styles.card}>
          <span className={styles.kicker}>COMPETITIVE POSITION</span>
          <h3>Relative standing</h3>
          <p>{text(competitivePosition.relative_assessment)}</p>
          <div className={styles.peerTags}>
            {(competitivePosition.peers ?? []).map((peer: string) => <span key={peer}>{peer}</span>)}
          </div>
        </article>

        <article className={styles.card}>
          <span className={styles.kicker}>HISTORICAL VALUATION</span>
          <h3>How today's multiple compares</h3>
          <div className={styles.historyValuationGrid}>
            {["3y", "5y", "10y"].map((period) => {
              const row = historical?.[period] ?? {};
              return (
                <div key={period}>
                  <span>{period.toUpperCase()}</span>
                  <strong>{row.status === "available" ? multiple(row.median_multiple) : "Unavailable"}</strong>
                  <small>{row.coverage_years ? Number(row.coverage_years).toFixed(1) + " years coverage" : text(row.explanation, "No stored history.")}</small>
                </div>
              );
            })}
          </div>
        </article>
      </div>

      <article className={styles.wideCard}>
        <div className={styles.cardHeading}>
          <div>
            <span className={styles.kicker}>VALUATION AUDIT</span>
            <h3>How fair value is anchored</h3>
          </div>
          <div className={styles.inlineStats}>
            <span>Bear <strong>{money(valuation.bear_value)}</strong></span>
            <span>Base <strong>{money(valuation.base_value)}</strong></span>
            <span>Bull <strong>{money(valuation.bull_value)}</strong></span>
          </div>
        </div>

        <div className={styles.valuationGrid}>
          {valuationRows.map((row) => (
            <div className={styles.valuationItem} key={row.label}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
              <small>{row.detail}</small>
            </div>
          ))}
        </div>

        <div className={styles.auditFooter}>
          <div>
            <span>Price / adjusted EPS guidance</span>
            <strong>{multiple(normalized.price_to_adjusted_eps_guidance)}</strong>
            <small>
              EPS guidance midpoint {money(normalized.adjusted_eps_guidance_midpoint)}
            </small>
          </div>
          <div>
            <span>Dividend yield</span>
            <strong>{pct(normalized.dividend_yield_pct)}</strong>
            <small>
              Annualized dividend {money(normalized.annualized_dividend_per_share)}
            </small>
          </div>
          <p>
            {text(
              valuationAnalysis.model_warning,
              "Valuation remains subject to the assumptions and evidence shown above.",
            )}
          </p>
        </div>
      </article>

      <div className={styles.summaryGrid}>
        <article className={styles.card}>
          <span className={styles.kicker}>EXPECTED RETURN</span>
          <h3>Five-year scenarios</h3>
          <div className={styles.returnGrid}>
            {fiveYearReturns.length ? (
              fiveYearReturns.map((row: any) => (
                <div key={row.scenario}>
                  <span>{String(row.scenario).toUpperCase()}</span>
                  <strong>{pct(row.expected_cagr)}</strong>
                  <small>Terminal {money(row.estimated_terminal_value_per_share)}</small>
                </div>
              ))
            ) : (
              <p>No five-year scenarios stored for this version.</p>
            )}
          </div>
          <p className={styles.note}>
            Expected returns are scenario outputs, not guarantees, and should be compared with
            the opportunity cost of a broad-market index.
          </p>
        </article>

        <article className={styles.card}>
          <span className={styles.kicker}>MATERIAL RISKS</span>
          <h3>What can break the thesis</h3>
          <div className={styles.riskList}>
            {risks.length ? (
              risks.slice(0, 5).map((risk: any) => (
                <div key={risk.id}>
                  <span className={styles.riskLevel}>{risk.severity ?? "medium"}</span>
                  <div>
                    <strong>{risk.title}</strong>
                    <p>{risk.description ?? risk.thesis_breaker ?? "Risk evidence pending."}</p>
                  </div>
                </div>
              ))
            ) : (
              <p>No material risks stored for this version.</p>
            )}
          </div>
        </article>
      </div>

      <div className={styles.summaryGrid}>
        <article className={styles.card}>
          <span className={styles.kicker}>BUFFETT LENS</span>
          <h3>Quality + margin of safety</h3>
          <p>{text(lenses?.buffett?.business_quality_fit)}</p>
          <p>{text(lenses?.buffett?.valuation_fit)}</p>
          <p className={styles.note}>{text(lenses?.buffett?.conclusion)}</p>
        </article>

        <article className={styles.card}>
          <span className={styles.kicker}>LYNCH LENS</span>
          <h3>Growth at a reasonable price</h3>
          <p>{text(lenses?.lynch?.classification)}</p>
          <p>{text(lenses?.lynch?.growth_fit)}</p>
          <p className={styles.note}>{text(lenses?.lynch?.conclusion)}</p>
        </article>
      </div>

      <article className={styles.conclusion}>
        <span className={styles.kicker}>FINAL RESEARCH CONCLUSION</span>
        <div className={styles.conclusionGrid}>
          <div><span>Valuation</span><p>{text(conclusion.valuation)}</p></div>
          <div><span>Business quality</span><p>{text(conclusion.great_business)}</p></div>
          <div><span>Return case</span><p>{text(conclusion.realistic_return)}</p></div>
          <div><span>Index test</span><p>{text(conclusion.index_case)}</p></div>
        </div>
        <p className={styles.breaker}>
          <strong>Primary thesis breaker:</strong>{" "}
          {text(dashboard.thesis_breaker, "No thesis breaker stored.")}
        </p>
      </article>
    </section>
  );
}
