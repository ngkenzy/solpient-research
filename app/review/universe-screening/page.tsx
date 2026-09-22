import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";
import { getAdminSupabase } from "@/lib/admin-supabase";
import { requireReviewAccess } from "@/lib/review-auth";
import styles from "../review.module.css";

export const dynamic="force-dynamic";
export const runtime="nodejs";

const score=(v:unknown)=>Number.isFinite(Number(v))?Number(v).toFixed(1):"—";
const pct=(v:unknown)=>Number.isFinite(Number(v))?Number(v).toFixed(1)+"%":"—";
const stateLabel=(v:string)=>v.replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());

export default async function UniverseScreeningPage(){
  await requireReviewAccess();
  const supabase=getAdminSupabase();
  if(!supabase)return null;

  const {data:run,error:runError}=await supabase
    .from("universe_screen_runs")
    .select("*")
    .order("as_of_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(runError)throw runError;

  let results:any[]=[];
  if(run){
    const {data,error}=await supabase
      .from("universe_screen_results")
      .select("*")
      .eq("universe_screen_run_id",run.id)
      .order("universe_rank")
      .limit(500);
    if(error)throw error;
    results=data??[];
  }

  const proposed=results.filter(r=>r.proposed_for_deep_research);
  const candidates=results.filter(r=>r.screen_state==="solpient_100_candidate");
  const research=results.filter(r=>r.screen_state==="research_candidate");
  const watch=results.filter(r=>r.screen_state==="watch");
  const excluded=results.filter(r=>r.screen_state==="excluded");

  return <>
    <header className={styles.header}>
      <SolpientBrand subtitle="Solpient 100 Universe Screening" />
      <div>
        <Link href="/review">Research Review</Link>
        <Link href="/review/universe-qa">Universe QA</Link>
        <Link href="/review/readiness-repair">Readiness Repair</Link>
        <Link href="/review/track-record">Track Record</Link>
      </div>
    </header>

    <main className={styles.shell}>
      <section className={styles.hero}>
        <div>
          <span className={styles.kicker}>PRE-RESEARCH CAPITAL ALLOCATION</span>
          <h1>Find the companies worth researching deeply.</h1>
          <p>
            Broad quantitative screening is kept separate from investment decisions. Quality,
            durability and balance-sheet strength dominate the score; valuation matters, but cheap
            weak businesses cannot value-score their way into the curated universe.
          </p>
        </div>
        <div className={styles.heroProgress}>
          <span>Latest universe</span>
          <strong>{run?.input_count??0}</strong>
          <small>{run?.provider??"No provider feed materialized yet"}</small>
        </div>
      </section>

      {!run?(
        <section className={styles.preparePanel}>
          <div>
            <span className={styles.kicker}>ENGINE READY</span>
            <h2>No broad-universe snapshot has been materialized yet.</h2>
            <p>
              Audit the normalized universe in Universe QA first, then run the screening CLI with
              --dry-run. This dashboard will populate after the first approved materialization.
            </p>
          </div>
        </section>
      ):<>
        <section className={styles.opsGrid}>
          <div className={styles.opsCard}><span>Deep-research shortlist</span><strong>{proposed.length}</strong><small>top eligible candidates</small></div>
          <div className={styles.opsCard}><span>Solpient 100 candidates</span><strong>{candidates.length}</strong><small>high quality + sufficient evidence</small></div>
          <div className={styles.opsCard}><span>Research candidates</span><strong>{research.length}</strong><small>worth deeper work</small></div>
          <div className={styles.opsCard}><span>Watch</span><strong>{watch.length}</strong><small>not ready for expensive research</small></div>
          <div className={styles.opsCard}><span>Excluded</span><strong>{excluded.length}</strong><small>failed hard universe gate</small></div>
        </section>

        <section className={styles.preparePanel}>
          <div>
            <span className={styles.kicker}>CURRENT RUN</span>
            <h2>{run.provider} · {new Date(run.as_of_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</h2>
            <p>
              Proposed deep research is a funnel decision, not a Buy list and not final Solpient 100 membership.
              Final membership requires reviewed qualitative research on moat, management, risks and valuation.
            </p>
          </div>
        </section>

        <section className={styles.queueHeader}>
          <div><span className={styles.kicker}>TOP RESEARCH FUNNEL</span><h2>{Math.min(100,proposed.length)} highest-priority names</h2></div>
          <span>Ranked by state → score → quality → evidence</span>
        </section>

        <section className={styles.queue}>
          {proposed.slice(0,100).map((r:any)=><div className={styles.panel} key={r.id}>
            <div className={styles.panelHeader}>
              <div>
                <span className={styles.kicker}>#{r.shortlist_rank??r.universe_rank} · {stateLabel(r.screen_state)}</span>
                <h2>{r.ticker} · {r.company_name??"Unknown company"}</h2>
                <p>{r.sector??"—"} · {r.industry??"—"} · profile {r.screen_profile}</p>
              </div>
              <strong>{score(r.screen_score)}</strong>
            </div>

            <div className={styles.opsGrid}>
              <div className={styles.opsCard}><span>Quality core</span><strong>{score(r.quality_core_score)}</strong><small>quality + durability + balance + growth</small></div>
              <div className={styles.opsCard}><span>Evidence</span><strong>{pct(r.evidence_coverage_pct)}</strong><small>missing data is not scored as neutral</small></div>
              <div className={styles.opsCard}><span>Quality</span><strong>{score(r.quality_score)}</strong><small>35% default weight</small></div>
              <div className={styles.opsCard}><span>Growth</span><strong>{score(r.growth_score)}</strong><small>long-term expansion</small></div>
              <div className={styles.opsCard}><span>Valuation</span><strong>{score(r.valuation_score)}</strong><small>15% default weight</small></div>
            </div>

            <div className={styles.detailGrid}>
              <section className={styles.panel}>
                <div className={styles.panelHeader}><div><span className={styles.kicker}>WHY IT PASSED</span><h2>Strengths</h2></div></div>
                <div className={styles.gapList}>
                  {(r.reasons?.positives??[]).length?(r.reasons.positives??[]).map((x:string,i:number)=><div key={i}><strong>{x}</strong></div>):<span>No major quantitative strength was recorded.</span>}
                </div>
              </section>
              <section className={styles.panel}>
                <div className={styles.panelHeader}><div><span className={styles.kicker}>WHAT TO VERIFY</span><h2>Concerns / gaps</h2></div></div>
                <div className={styles.gapList}>
                  {(r.reasons?.concerns??[]).length?(r.reasons.concerns??[]).map((x:string,i:number)=><div key={i}><strong>{x}</strong></div>):<span>No major screening concern was recorded.</span>}
                </div>
              </section>
            </div>
          </div>)}
        </section>
      </>}
    </main>
  </>;
}
