import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";
import { getAdminSupabase } from "@/lib/admin-supabase";
import { requireReviewAccess } from "@/lib/review-auth";
import styles from "../review.module.css";

export const dynamic="force-dynamic";
export const runtime="nodejs";

const pct=(v:unknown)=>v!==null&&v!==undefined&&Number.isFinite(Number(v))?Number(v).toFixed(1)+"%":"—";
const num=(v:unknown)=>v!==null&&v!==undefined&&Number.isFinite(Number(v))?Number(v).toFixed(1):"—";
const money=(v:unknown)=>v!==null&&v!==undefined&&Number.isFinite(Number(v))
  ?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(v))
  :"—";
const label=(v:string)=>String(v??"").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());

export default async function ResearchCandidatesPage(){
  await requireReviewAccess();
  const supabase=getAdminSupabase();
  if(!supabase)return null;

  const {data:run,error:runError}=await supabase
    .from("research_candidate_pipeline_runs")
    .select("*")
    .order("created_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(runError)throw runError;

  let items:any[]=[];
  if(run){
    const {data,error}=await supabase
      .from("research_candidate_pipeline_items")
      .select("*")
      .eq("research_candidate_pipeline_run_id",run.id)
      .order("stage")
      .order("ticker");
    if(error)throw error;
    items=data??[];
  }

  const counts={
    decision_ready:items.filter(x=>x.stage==="decision_ready").length,
    research_ready:items.filter(x=>x.stage==="research_ready").length,
    research_building:items.filter(x=>x.stage==="research_building").length,
    valuation_building:items.filter(x=>x.stage==="valuation_building").length,
    onboarding:items.filter(x=>x.stage==="onboarding").length,
  };

  return <>
    <header className={styles.header}>
      <SolpientBrand subtitle="Research Candidate Pipeline" />
      <div>
        <Link href="/review/universe-screening">Universe Screening</Link>
        <Link href="/review/research-factory">Research Factory</Link>
        <Link href="/review/readiness-repair">Readiness Repair</Link>
        <Link href="/review/methodologies">Methodologies</Link>
      </div>
    </header>

    <main className={styles.shell}>
      <section className={styles.hero}>
        <div>
          <span className={styles.kicker}>SCREEN → VALUE → VERIFY</span>
          <h1>Move shortlisted companies into decision-grade research.</h1>
          <p>
            Universe screening only nominates candidates. Valuation V3 requires explicit reviewed
            inputs, and Readiness V1 uses real research scores and evidence coverage. Screening
            scores never substitute for decision-grade research.
          </p>
        </div>
        <div className={styles.heroProgress}>
          <span>Latest candidate run</span>
          <strong>{items.length}</strong>
          <small>{run?new Date(run.created_at).toLocaleString():"No materialized pipeline yet"}</small>
        </div>
      </section>

      {!run?(
        <section className={styles.preparePanel}>
          <div>
            <span className={styles.kicker}>PIPELINE READY</span>
            <h2>No candidate handoff has been materialized yet.</h2>
            <p>
              Materialize a Solpient 100 screening run first, then run the research-candidate
              pipeline. Shortlisted companies without reviewed V3 inputs will remain Valuation Building.
            </p>
          </div>
        </section>
      ):<>
        <section className={styles.opsGrid}>
          <div className={styles.opsCard}><span>Decision Ready</span><strong>{counts.decision_ready}</strong><small>eligible for portfolio comparison</small></div>
          <div className={styles.opsCard}><span>Research Ready</span><strong>{counts.research_ready}</strong><small>usable research, more evidence needed</small></div>
          <div className={styles.opsCard}><span>Research Building</span><strong>{counts.research_building}</strong><small>V3 available, research incomplete</small></div>
          <div className={styles.opsCard}><span>Valuation Building</span><strong>{counts.valuation_building}</strong><small>needs explicit V3 input pack</small></div>
          <div className={styles.opsCard}><span>Onboarding</span><strong>{counts.onboarding}</strong><small>not yet canonical Solpient company</small></div>
        </section>

        <section className={styles.queue}>
          {items.map((item:any)=>{
            const output=item.pipeline_output??{};
            const next=(item.next_actions??[])[0];
            return <div className={styles.panel} key={item.id}>
              <div className={styles.panelHeader}>
                <div>
                  <span className={styles.kicker}>{label(item.stage)} · {label(item.readiness_state)}</span>
                  <h2>{item.ticker}</h2>
                  <p>{output.companyName??"Candidate company"}</p>
                </div>
                <strong>{item.decision_score==null?"—":num(item.decision_score)}</strong>
              </div>

              <div className={styles.opsGrid}>
                <div className={styles.opsCard}><span>V3 fair value</span><strong>{money(item.valuation_base_fair_value)}</strong><small>{item.valuation_confidence_band??"unavailable"} confidence</small></div>
                <div className={styles.opsCard}><span>V3 confidence</span><strong>{pct(item.valuation_confidence)}</strong><small>{item.valuation_preflight_complete?"input preflight complete":"input pack incomplete"}</small></div>
                <div className={styles.opsCard}><span>Base 5Y CAGR</span><strong>{pct(item.base_5y_cagr)}</strong><small>V3 horizon-specific return model</small></div>
                <div className={styles.opsCard}><span>Evidence confidence</span><strong>{pct(item.evidence_confidence)}</strong><small>Readiness V1</small></div>
              </div>

              <section className={styles.preparePanel}>
                <div>
                  <span className={styles.kicker}>NEXT ACTION</span>
                  <h2>{next?.action??"No action recorded"}</h2>
                  <p>{next?.reason??"—"}</p>
                </div>
              </section>

              <div className={styles.gapList}>
                {(item.next_actions??[]).slice(1,8).map((a:any,i:number)=><div key={i}>
                  <strong>{a.action}</strong>
                  <span>{a.reason}{Array.isArray(a.missing)&&a.missing.length?" · "+a.missing.join(", "):""}</span>
                </div>)}
              </div>
            </div>;
          })}
        </section>
      </>}
    </main>
  </>;
}
