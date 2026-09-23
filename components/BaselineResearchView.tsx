import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";

const SECTION_LABELS: Record<string, string> = {
  company_overview: "Company overview",
  revenue_model: "Revenue model",
  customer_characteristics: "Customers",
  competitive_position: "Competitive position",
  moat_evidence: "Moat evidence",
  pricing_power: "Pricing power",
  growth_drivers: "Growth drivers",
  major_risks: "Major risks",
  ai_opportunities: "AI opportunities",
  ai_disruption_risks: "AI disruption risks",
  management_observations: "Management",
  capital_allocation_observations: "Capital allocation",
  bull_thesis: "Bull thesis",
  bear_thesis: "Bear thesis",
  biggest_unknowns: "Biggest unknowns",
};

function money(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(parsed);
}

function dateLabel(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function BaselineResearchView({
  company,
  baselineComposition,
  latestMarket,
}: {
  company: any;
  baselineComposition: any;
  latestMarket: any;
}) {
  const payload = baselineComposition?.composition_payload ?? {};
  const validation = baselineComposition?.validation_result ?? {};
  const sections = payload?.sections ?? {};
  const publicReady = Boolean(validation?.public_baseline_ready);
  const supportedCount = Object.values(sections).filter(
    (section: any) => section?.status === "supported",
  ).length;
  const totalCount = Object.keys(SECTION_LABELS).length;

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

      <main className="researchShell baselineResearchShell">
        <div className="researchTopbar">
          <Link className="backLink" href="/research">← Solpient 100</Link>
        </div>

        <section className="researchHero baselineHero">
          <div className="researchHeroCopy">
            <div className="heroMeta">
              <span>{company.exchange ?? "EQUITY"}</span>
              {company.sector ? <span>{company.sector}</span> : null}
              {company.industry ? <span>{company.industry}</span> : null}
            </div>

            <div className="tickerLine">
              <div className="tickerMark">{company.ticker.slice(0, 2)}</div>
              <div>
                <div className="eyebrow">{company.ticker}</div>
                <h1>{company.company_name}</h1>
              </div>
            </div>

            <p className="heroDescription">
              Evidence-grounded baseline research generated from Solpient&apos;s stored data.
              This is not yet a published decision-grade research version.
            </p>
          </div>

          <aside className="versionPanel">
            <span>BASELINE STATUS</span>
            <strong>{publicReady ? "Ready" : "Building"}</strong>
            <small>{dateLabel(baselineComposition?.generated_at)}</small>
            <div className={publicReady ? "versionStatus" : "baselineBuildingStatus"}>
              {publicReady ? "Baseline Ready" : "Research Building"}
            </div>
          </aside>
        </section>

        <section className="baselineStatusGrid">
          <article>
            <span>Latest price</span>
            <strong>{money(latestMarket?.price)}</strong>
            <small>{latestMarket?.trading_date ?? "Market observation pending"}</small>
          </article>
          <article>
            <span>Supported sections</span>
            <strong>{supportedCount}/{totalCount}</strong>
            <small>Unsupported sections remain explicit</small>
          </article>
          <article>
            <span>Industry module</span>
            <strong>{baselineComposition?.industry_module ?? "Review needed"}</strong>
            <small>Sector-specific evidence gate</small>
          </article>
          <article>
            <span>Evidence completeness</span>
            <strong>
              {baselineComposition?.evidence_completeness_pct == null
                ? "—"
                : String(Number(baselineComposition.evidence_completeness_pct).toFixed(0)) + "%"}
            </strong>
            <small>Baseline draft evidence coverage</small>
          </article>
        </section>

        <section className="baselineResearchIntro">
          <div>
            <span className="panelKicker">BASELINE RESEARCH V1</span>
            <h2>What Solpient can support today</h2>
          </div>
          <p>
            Supported claims are tied to the exact evidence pack used by the composer.
            Missing evidence stays visible instead of being filled with plausible prose.
          </p>
        </section>

        <section className="baselineSectionGrid">
          {Object.entries(SECTION_LABELS).map(([key, label]) => {
            const section: any = sections[key] ?? {
              status: "insufficient_evidence",
              claims: [],
              limitation: "This section has not been composed yet.",
            };
            const supported = section.status === "supported";
            return (
              <article className={"baselineSectionCard " + (supported ? "supported" : "insufficient")} key={key}>
                <div className="baselineSectionHeader">
                  <div>
                    <span>{supported ? "SUPPORTED" : "EVIDENCE BUILDING"}</span>
                    <h3>{label}</h3>
                  </div>
                  <strong>{supported ? "✓" : "…"}</strong>
                </div>

                {supported ? (
                  <div className="baselineClaims">
                    {(section.claims ?? []).map((item: any, index: number) => (
                      <div key={key + "-" + String(index)}>
                        <p>{item.text}</p>
                        {Array.isArray(item.evidence_refs) && item.evidence_refs.length ? (
                          <small>Evidence: {item.evidence_refs.join(" · ")}</small>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="baselineLimitation">
                    {section.limitation ?? "Solpient does not yet have sufficient evidence for this section."}
                  </p>
                )}
              </article>
            );
          })}
        </section>

        <section className="rankingFootnote baselineFootnote">
          <strong>Baseline analysis is not a buy list or a published research version.</strong>
          <p>
            Research Ready and Decision Ready remain controlled by Solpient&apos;s existing governed
            Phase 3 methodology. Baseline analysis only makes the current evidence useful while
            deeper research is still being built.
          </p>
        </section>
      </main>
    </>
  );
}
