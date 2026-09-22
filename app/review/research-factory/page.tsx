import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";
import { getAdminSupabase } from "@/lib/admin-supabase";
import { requireReviewAccess } from "@/lib/review-auth";
import styles from "../review.module.css";

export const dynamic="force-dynamic";
export const runtime="nodejs";

const pct=(v:unknown)=>v!==null&&v!==undefined&&Number.isFinite(Number(v))
  ?Number(v).toFixed(1)+"%"
  :"—";
const label=(v:string)=>String(v??"")
  .replaceAll("_"," ")
  .replace(/\b\w/g,c=>c.toUpperCase());

export default async function ResearchFactoryPage(){
  await requireReviewAccess();
  const supabase=getAdminSupabase();
  if(!supabase)return null;

  const {data:run,error:runError}=await supabase
    .from("research_factory_runs")
    .select("*")
    .eq("factory_version","research-factory-v1")
    .order("created_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(runError)throw runError;

  let items:any[]=[];
  let drafts:any[]=[];
  let workerRuns:any[]=[];
  let autonomousRuns:any[]=[];
  let autonomousDecisions:any[]=[];
  if(run){
    const [itemsR,draftsR,workersR,autonomousRunsR,autonomousDecisionsR]=await Promise.all([
      supabase.from("research_factory_items")
        .select("*")
        .eq("research_factory_run_id",run.id)
        .order("ordinal",{ascending:true}),
      supabase.from("research_factory_valuation_drafts")
        .select("id,research_factory_item_id,missing_fields,preflight,created_at")
        .order("created_at",{ascending:false}),
      supabase.from("research_factory_worker_runs")
        .select("*")
        .eq("research_factory_run_id",run.id)
        .order("started_at",{ascending:false})
        .limit(10),
      supabase.from("research_factory_autonomous_runs")
        .select("*")
        .eq("research_factory_run_id",run.id)
        .order("started_at",{ascending:false})
        .limit(10),
      supabase.from("research_factory_autonomous_decisions")
        .select("research_factory_item_id,decision_type,decision_status,confidence,policy_version,created_at")
        .order("created_at",{ascending:false})
        .limit(1000),
    ]);
    if(itemsR.error)throw itemsR.error;
    if(draftsR.error)throw draftsR.error;
    if(workersR.error)throw workersR.error;
    if(autonomousRunsR.error)throw autonomousRunsR.error;
    if(autonomousDecisionsR.error)throw autonomousDecisionsR.error;
    items=itemsR.data??[];
    const itemIds=new Set(items.map(x=>x.id));
    drafts=(draftsR.data??[]).filter(x=>itemIds.has(x.research_factory_item_id));
    workerRuns=workersR.data??[];
    autonomousRuns=autonomousRunsR.data??[];
    autonomousDecisions=(autonomousDecisionsR.data??[]).filter(x=>itemIds.has(x.research_factory_item_id));
  }

  const latestDraftByItem=new Map<string,any>();
  for(const draft of drafts){
    if(!latestDraftByItem.has(draft.research_factory_item_id)){
      latestDraftByItem.set(draft.research_factory_item_id,draft);
    }
  }

  const stageCounts=new Map<string,number>();
  const statusCounts=new Map<string,number>();
  for(const item of items){
    stageCounts.set(item.stage,(stageCounts.get(item.stage)??0)+1);
    statusCounts.set(item.status,(statusCounts.get(item.status)??0)+1);
  }

  const reviewCount=items.filter(x=>x.status==="needs_review").length;
  const blockedCount=items.filter(x=>x.status==="blocked").length;
  const quarantinedCount=items.filter(x=>x.status==="quarantined").length;
  const completeCount=items.filter(x=>x.status==="complete").length;
  const pipelineRefreshCount=items.filter(x=>x.stage==="pipeline_refresh").length;
  const genuineReviewCount=items.filter(x=>
    x.status==="needs_review"||
    x.stage==="pipeline_refresh"||
    x.status==="complete"
  ).length;
  const automatedQueue=items.filter(x=>
    ["queued","running","needs_review","blocked"].includes(x.status)&&
    ["evidence_ingestion","baseline_draft","research_draft","valuation_review"].includes(x.stage)
  ).length;
  const researchReviewCount=items.filter(x=>x.stage==="research_review").length;
  const autoValuationCount=autonomousDecisions.filter(x=>
    x.decision_type==="valuation_pack"&&x.decision_status==="applied"
  ).length;

  const latestWorker=workerRuns[0]??null;
  const latestAutonomousRun=autonomousRuns[0]??null;

  return <>
    <header className={styles.header}>
      <SolpientBrand subtitle="Autonomous Research Factory V2.1" />
      <div>
        <Link href="/review/research-candidates">Candidate Pipeline</Link>
        <Link href="/review/readiness-repair">Readiness Repair</Link>
        <Link href="/review/methodologies">Methodologies</Link>
      </div>
    </header>

    <main className={styles.shell}>
      <section className={styles.hero}>
        <div>
          <span className={styles.kicker}>AUTONOMOUS RESEARCH OPERATIONS · V2.1</span>
          <h1>Repair evidence, assign industry models, and build valuations automatically.</h1>
          <p>
            Each weekday, V2.1 takes the next ranked unresolved names, refreshes source data,
            reconstructs historical context and capital allocation, assigns a high-confidence
            industry module, and generates explicit Valuation V3 assumptions. Unsupported cases
            are quarantined so the rest of the factory keeps moving.
          </p>
        </div>
        <div className={styles.heroProgress}>
          <span>Autonomous work remaining</span>
          <strong>{automatedQueue}</strong>
          <small>{quarantinedCount+" quarantined · "+researchReviewCount+" at research verification"}</small>
        </div>
      </section>

      {!run?(
        <section className={styles.preparePanel}>
          <div>
            <span className={styles.kicker}>FACTORY READY</span>
            <h2>No Research Factory run exists yet.</h2>
            <p>Materialize Factory V1 from an immutable Pipeline V2.4 snapshot.</p>
          </div>
        </section>
      ):<>
        <section className={styles.opsGrid}>
          <div className={styles.opsCard}><span>Autonomous Queue</span><strong>{automatedQueue}</strong><small>next ranked work · max 10 / weekday</small></div>
          <div className={styles.opsCard}><span>Auto Valuations</span><strong>{autoValuationCount}</strong><small>policy-approved Valuation V3 packs</small></div>
          <div className={styles.opsCard}><span>Quarantined</span><strong>{quarantinedCount}</strong><small>low-confidence exceptions · factory continues</small></div>
          <div className={styles.opsCard}><span>Latest V2.1 Run</span><strong>{latestAutonomousRun?.processed_count??0}</strong><small>{latestAutonomousRun?label(latestAutonomousRun.status)+" · "+new Date(latestAutonomousRun.started_at).toLocaleString():"No V2.1 run yet"}</small></div>
          <div className={styles.opsCard}><span>Research Verification</span><strong>{researchReviewCount}</strong><small>remaining publication gate after V2.1</small></div>
          <div className={styles.opsCard}><span>Pipeline / Complete</span><strong>{pipelineRefreshCount+completeCount}</strong><small>ready for downstream refresh or complete</small></div>
        </section>

        <section className={styles.preparePanel}>
          <div>
            <span className={styles.kicker}>WEEKDAY AUTONOMY</span>
            <h2>The next unresolved names advance without routine approvals.</h2>
            <p>
              V2.1 processes evidence repair, industry assignment, coverage rebuilds, research
              composition, and valuation assumptions in rank order. Machine decisions are
              append-only and confidence-scored; low-confidence cases enter quarantine instead
              of blocking unrelated companies. Research publication remains a separate gate.
            </p>
          </div>
        </section>

        <section className={styles.queue}>
          {items.map((item:any)=>{
            const snapshot=item.state_snapshot??{};
            const company=snapshot.company??{};
            const next=(item.next_actions??[])[0];
            const valuationDraft=latestDraftByItem.get(item.id);
            const missing=Array.isArray(valuationDraft?.missing_fields)
              ?valuationDraft.missing_fields
              :[];
            return <div className={styles.panel} key={item.id}>
              <div className={styles.panelHeader}>
                <div>
                  <span className={styles.kicker}>
                    #{item.ordinal} · {label(item.stage)} · {label(item.status)}
                  </span>
                  <h2>{item.ticker}</h2>
                  <p>{company.company_name??snapshot?.screen_company_name??"Deep-research candidate"}</p>
                </div>
                <strong>{pct(item.coverage_pct)}</strong>
              </div>

              <div className={styles.opsGrid}>
                <div className={styles.opsCard}><span>Coverage</span><strong>{pct(item.coverage_pct)}</strong><small>Coverage V2 / readiness evidence</small></div>
                <div className={styles.opsCard}><span>Repair Jobs</span><strong>{item.repair_job_count??0}</strong><small>unresolved evidence gaps</small></div>
                <div className={styles.opsCard}><span>Autonomy Status</span><strong>{item.status==="quarantined"?"Quarantine":item.stage==="research_review"?"Verify":"Active"}</strong><small>{item.status==="quarantined"?"waiting for stronger evidence":item.stage==="research_review"?"publication gate":"machine-processing eligible"}</small></div>
                <div className={styles.opsCard}><span>Valuation Draft</span><strong>{valuationDraft?"Yes":"—"}</strong><small>{missing.length?missing.length+" unresolved inputs":"complete or not generated"}</small></div>
              </div>

              <section className={styles.preparePanel}>
                <div>
                  <span className={styles.kicker}>NEXT ACTION</span>
                  <h2>{next?.action??"Refresh factory state"}</h2>
                  <p>{next?.reason??item.last_error??"No additional explanation recorded."}</p>
                </div>
              </section>

              <div className={styles.gapList}>
                {(item.next_actions??[]).slice(1,6).map((action:any,index:number)=><div key={index}>
                  <strong>{label(action.type??"review")}</strong>
                  <span>{action.action??action.reason??"Review required"}</span>
                </div>)}
                {missing.slice(0,6).map((field:string,index:number)=><div key={"valuation-"+index}>
                  <strong>Valuation Input</strong>
                  <span>{field}</span>
                </div>)}
              </div>
            </div>;
          })}
        </section>
      </>}
    </main>
  </>;
}
