import Link from "next/link";
import { LocalResearchAIWorkbench } from "@/components/LocalResearchAIWorkbench";
import { SolpientBrand } from "@/components/SolpientBrand";
import { getAdminSupabase } from "@/lib/admin-supabase";
import { buildResearchAIPack } from "@/lib/research-ai-pack";
import { requireReviewAccess } from "@/lib/review-auth";
import styles from "../review.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function LocalAILabPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string }>;
}) {
  await requireReviewAccess();
  const supabase = getAdminSupabase();
  if (!supabase) return null;

  const { ticker: requestedTicker } = await searchParams;
  const ticker = String(requestedTicker ?? "ADBE").toUpperCase();

  const { data: companies, error: companiesError } = await supabase
    .from("companies")
    .select("id,ticker,company_name,exchange,sector,industry")
    .order("ticker");
  if (companiesError) throw companiesError;

  const company =
    (companies ?? []).find((row: any) => row.ticker === ticker) ??
    (companies ?? [])[0] ??
    null;

  let pack = null;
  let missingReason = "";

  if (company) {
    const { data: run, error: runError } = await supabase
      .from("research_runs")
      .select("id,version,researched_at,data_cutoff_at,price_at_research,status")
      .eq("company_id", company.id)
      .eq("status", "published")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runError) throw runError;

    if (!run) {
      missingReason = "This company has no published research version.";
    } else {
      const [
        scoresR,
        valuationR,
        metricsR,
        thesisR,
        changesR,
        triggersR,
        sourcesR,
        rankingR,
        universeR,
        candidateR,
      ] = await Promise.all([
          supabase.from("scores").select("*").eq("research_run_id", run.id).maybeSingle(),
          supabase.from("valuations").select("*").eq("research_run_id", run.id).maybeSingle(),
          supabase.from("financial_metrics").select("*").eq("research_run_id", run.id).maybeSingle(),
          supabase.from("thesis_variables").select("*").eq("research_run_id", run.id).order("created_at"),
          supabase.from("research_changes").select("*").eq("current_run_id", run.id).order("created_at", { ascending: false }).limit(12),
          supabase.from("decision_triggers").select("*").eq("research_run_id", run.id).order("severity", { ascending: false }).limit(12),
          supabase.from("sources").select("*").eq("research_run_id", run.id).order("retrieved_at", { ascending: false }).limit(16),
          supabase.from("ranking_history")
            .select("rank,decision_score,evidence_confidence_score,readiness_state,ranked_at,methodology_version")
            .eq("company_id", company.id)
            .order("ranked_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from("universe_screen_results")
            .select("screen_state,shortlist_rank,proposed_for_deep_research,screen_score,evidence_coverage_pct,created_at")
            .eq("ticker", company.ticker)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from("research_candidate_pipeline_items")
            .select("stage,readiness_state,decision_score,evidence_confidence,next_actions,created_at")
            .eq("ticker", company.ticker)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

      for (const result of [
        scoresR,
        valuationR,
        metricsR,
        thesisR,
        changesR,
        triggersR,
        sourcesR,
        rankingR,
        universeR,
        candidateR,
      ]) {
        if (result.error) throw result.error;
      }

      pack = buildResearchAIPack({
        company,
        run,
        scores: scoresR.data,
        valuation: valuationR.data,
        metrics: metricsR.data,
        thesis: thesisR.data ?? [],
        changes: changesR.data ?? [],
        triggers: triggersR.data ?? [],
        sources: sourcesR.data ?? [],
        ranking: rankingR.data,
        universeScreening: universeR.data,
        candidatePipeline: candidateR.data,
      });
    }
  }

  return (
    <>
      <header className={styles.header}>
        <SolpientBrand subtitle="Local AI Lab" />
        <div>
          <Link href="/review">Research Review</Link>
          <Link href="/review/methodologies">Methodologies</Link>
          <Link href="/research">Research</Link>
        </div>
      </header>

      <main className={styles.shell}>
        <section className={styles.hero}>
          <div>
            <span className={styles.kicker}>PRIVATE RESEARCH AI</span>
            <h1>Ask Solpient without sending the question to an AI API.</h1>
            <p>
              This lab packages the selected published research version plus read-only Solpient
              100, ranking, and readiness metadata into a compact context and runs Qwen locally
              in the browser through WebGPU. Published deterministic research values remain authoritative.
            </p>
          </div>
        </section>

        <section className={styles.preparePanel}>
          <form method="get" style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className={styles.kicker}>COMPANY</span>
              <select
                name="ticker"
                defaultValue={company?.ticker ?? ""}
                style={{
                  minWidth: 240,
                  background: "#111317",
                  color: "#f4f5f7",
                  border: "1px solid #2a2f3a",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                {(companies ?? []).map((row: any) => (
                  <option key={row.id} value={row.ticker}>
                    {row.ticker} · {row.company_name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primaryButton" type="submit">Load research pack</button>
          </form>
        </section>

        {pack ? (
          <LocalResearchAIWorkbench pack={pack} />
        ) : (
          <section className={styles.panel}>
            <h2>Research pack unavailable</h2>
            <p>{missingReason || "No company is available."}</p>
          </section>
        )}
      </main>
    </>
  );
}
