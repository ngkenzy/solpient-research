import { loadResearchStandardV1Data } from "@/lib/repositories/research-standard";

function pct(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) + "%" : "—";
}

function money(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

function metricValue(row: any) {
  if (row.status === "not_available") return "Not available";
  if (row.status === "not_applicable") return "Not applicable";
  if (row.value_text) return row.value_text;
  const n = Number(row.value_numeric);
  if (!Number.isFinite(n)) return "—";
  if (row.unit === "percent") return n.toFixed(1) + "%";
  if (row.unit === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: Math.abs(n) >= 1_000_000 ? "compact" : "standard",
      maximumFractionDigits: 2,
    }).format(n);
  }
  if (row.unit === "USD/share") return money(n);
  if (row.unit === "shares") return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  if (row.unit === "x") return n.toFixed(2) + "×";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function levelClass(value?: string | null) {
  if (value === "high") return "standardRiskHigh";
  if (value === "medium") return "standardRiskMedium";
  return "standardRiskLow";
}

function moduleTitle(module: string) {
  if (module === "consumer_brand") return "Consumer / brand module";
  return module.replaceAll("_", " ");
}

function moduleDescription(module: string) {
  if (module === "consumer_brand") {
    return "Brand concentration, channel mix, international expansion, inventory discipline and per-share capital allocation.";
  }
  return "Industry-specific evidence layered on top of the universal core.";
}

export async function ResearchStandardV1({
  researchRunId,
}: {
  researchRunId: string;
}) {
  const loaded = await loadResearchStandardV1Data(researchRunId);
  if (!loaded) return null;

  const run = loaded.run;
  if (!run || run.standard_version !== "solpient-v1") return null;

  const business = loaded.business;
  const metrics = loaded.metrics;
  const risks = loaded.risks;
  const returns = loaded.returns;
  const thesis = loaded.thesis;
  const scenarioOrder: Record<string, number> = { bear: 0, base: 1, bull: 2 };
  const fiveYear = returns
    .filter((row: any) => row.horizon_years === 5)
    .sort((a: any, b: any) => (scenarioOrder[a.scenario] ?? 99) - (scenarioOrder[b.scenario] ?? 99));
  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  risks.sort((a: any, b: any) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99));
  const universalMetrics = metrics.filter((row: any) => row.module === "universal");
  const industryMetricGroups = [...new Set(metrics.map((row: any) => row.module).filter((module: string) => module && module !== "universal"))]
    .map((module) => ({
      module,
      rows: metrics.filter((row: any) => row.module === module),
    }));
  const metricByKey = new Map(universalMetrics.map((row: any) => [row.metric_key, row]));
  const featuredMetrics = [
    "fcf_yield",
    "price_to_fcf",
    "fcf_per_share",
    "fcf_conversion",
    "net_debt",
    "enterprise_value",
    "capex_to_revenue",
    "roic",
  ].map((key) => metricByKey.get(key)).filter(Boolean);

  return (
    <section className="standardSection" id="research-standard">
      <div className="standardHeader">
        <div>
          <span className="panelKicker">SOLPIENT RESEARCH STANDARD v1</span>
          <h2>Defensible baseline</h2>
          <p>
            Point-in-time evidence, explicit assumptions, thesis breakers and scenario returns.
            Missing evidence stays visible instead of being filled with guesses.
          </p>
        </div>
        <div className="standardStatus">
          <span>{run.standard_status}</span>
          <strong>{run.completeness_pct == null ? "—" : Number(run.completeness_pct).toFixed(0) + "%"}</strong>
          <small>completeness</small>
        </div>
      </div>

      <div className="standardSummaryGrid">
        <article className="standardCard">
          <span className="panelKicker">BUSINESS</span>
          <h3>{business?.business_quality_rating ?? "Pending"} quality</h3>
          <div className="standardFacts">
            <div><span>Moat</span><strong>{business?.moat_rating ?? "—"}</strong></div>
            <div><span>Pricing power</span><strong>{business?.pricing_power ?? "—"}</strong></div>
            <div><span>Recurring revenue</span><strong>{business?.recurring_revenue_pct == null ? "—" : pct(business.recurring_revenue_pct)}</strong></div>
            <div><span>Capital intensity</span><strong>{business?.capital_intensity ?? "—"}</strong></div>
          </div>
          <p>{business?.bull_thesis ?? "Bull thesis pending."}</p>
        </article>

        <article className="standardCard capitalTestCard">
          <span className="panelKicker">CAPITAL ALLOCATION TEST</span>
          <h3>Why leave the index?</h3>
          <p>{business?.capital_allocation_test ?? "Benchmark comparison pending."}</p>
          <div className="standardUnknown">
            <span>Biggest unknown</span>
            <strong>{business?.biggest_unknown ?? "Pending"}</strong>
          </div>
        </article>
      </div>

      <div className="standardPanel">
        <div className="standardPanelHeader">
          <div>
            <span className="panelKicker">AUDITABLE METRICS</span>
            <h3>Universal core</h3>
          </div>
          <small>{universalMetrics.length} universal observations · {metrics.length} total</small>
        </div>
        <div className="standardMetricGrid">
          {featuredMetrics.map((row: any) => (
            <div className={"standardMetric " + (row.status !== "available" ? "standardMetricMissing" : "")} key={row.id}>
              <span>{row.label}</span>
              <strong>{metricValue(row)}</strong>
              <small>
                {row.basis}
                {row.period_type ? " · " + row.period_type.replaceAll("_", " ") : ""}
              </small>
              {row.notes ? <p>{row.notes}</p> : null}
            </div>
          ))}
        </div>
      </div>

      {industryMetricGroups.map(({ module, rows }: any) => (
        <div className="standardPanel" key={module}>
          <div className="standardPanelHeader">
            <div>
              <span className="panelKicker">INDUSTRY EVIDENCE</span>
              <h3>{moduleTitle(module)}</h3>
              <p className="standardMethod">{moduleDescription(module)}</p>
            </div>
            <small>{rows.length} observations</small>
          </div>
          <div className="standardMetricGrid">
            {rows.map((row: any) => (
              <div className={"standardMetric " + (row.status !== "available" ? "standardMetricMissing" : "")} key={row.id}>
                <span>{row.label}</span>
                <strong>{metricValue(row)}</strong>
                <small>
                  {row.basis}
                  {row.period_type ? " · " + row.period_type.replaceAll("_", " ") : ""}
                </small>
                {row.notes ? <p>{row.notes}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="standardPanel">
        <div className="standardPanelHeader">
          <div>
            <span className="panelKicker">EXPECTED RETURN</span>
            <h3>5-year scenario engine</h3>
          </div>
          <small>Not a price target · explicit assumptions</small>
        </div>
        <div className="returnScenarioGrid">
          {fiveYear.map((row: any) => (
            <article className="returnScenario" key={row.id}>
              <span>{row.scenario}</span>
              <strong>{pct(row.expected_cagr)} CAGR</strong>
              <div>
                <small>Terminal value</small>
                <b>{money(row.estimated_terminal_value_per_share)}</b>
              </div>
              <div>
                <small>FCF growth</small>
                <b>{pct(row.fcf_growth_assumption)}</b>
              </div>
              <div>
                <small>Exit P/FCF</small>
                <b>{Number(row.exit_multiple).toFixed(0)}×</b>
              </div>
            </article>
          ))}
        </div>
        {fiveYear[0]?.methodology ? <p className="standardMethod">{fiveYear[0].methodology}</p> : null}
      </div>

      <div className="standardPanel">
        <div className="standardPanelHeader">
          <div>
            <span className="panelKicker">THESIS CONDITIONS</span>
            <h3>What must remain true</h3>
          </div>
          <small>{thesis.length} monitored conditions</small>
        </div>
        <div className="standardRiskList">
          {thesis.map((item: any) => (
            <article className="standardRisk" key={item.id}>
              <div className="standardRiskTop">
                <div>
                  <span>{item.review_frequency ?? "periodic"} review</span>
                  <strong>{item.variable_name}</strong>
                </div>
                <div className="standardRiskLevels">
                  <span className={item.status === "strengthened" ? "standardRiskLow" : item.status === "weakened" ? "standardRiskHigh" : "standardRiskMedium"}>
                    {item.status ?? "unknown"}
                  </span>
                </div>
              </div>
              <p>{item.observed_value ?? item.expectation ?? "Evidence pending."}</p>
              <div className="standardBreaker">
                <span>Thesis breaker</span>
                <strong>{item.breaker_condition ?? "Breaker condition not yet defined."}</strong>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="standardPanel">
        <div className="standardPanelHeader">
          <div>
            <span className="panelKicker">PERMANENT-LOSS RISKS</span>
            <h3>Risk register</h3>
          </div>
          <small>{risks.length} monitored risks</small>
        </div>
        <div className="standardRiskList">
          {risks.map((risk: any) => (
            <article className="standardRisk" key={risk.id}>
              <div className="standardRiskTop">
                <div>
                  <span>{risk.category}</span>
                  <strong>{risk.title}</strong>
                </div>
                <div className="standardRiskLevels">
                  <span className={levelClass(risk.probability)}>P {risk.probability}</span>
                  <span className={levelClass(risk.severity)}>S {risk.severity}</span>
                </div>
              </div>
              <p>{risk.description}</p>
              <div className="standardBreaker">
                <span>Thesis breaker</span>
                <strong>{risk.thesis_breaker}</strong>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="standardFooter">
        <span>Data cutoff</span>
        <strong>{run.data_cutoff_at ? new Date(run.data_cutoff_at).toLocaleString("en-US") : "—"}</strong>
        <span>Benchmark</span>
        <strong>{run.benchmark_ticker ?? "SPY"}</strong>
      </div>
    </section>
  );
}
