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
  if(run){
    const [itemsR,draftsR,workersR]=await Promise.all([
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
    ]);
    if(itemsR.error)throw itemsR.error;
    if(draftsR.error)throw draftsR.error;
    if(workersR.error)throw workersR.error;
    items=itemsR.data??[];
    const itemIds=new Set(items.map(x=>x.id));
    drafts=(draftsR.data??[]).filter(x=>itemIds.has(x.research_factory_item_id));
    workerRuns=workersR.data??[];
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
  const completeCount=items.filter(x=>x.status==="complete").length;
  const pipelineRefreshCount=items.filter(x=>x.stage==="pipeline_refresh").length;
  const genuineReviewCount=items.filter(x=>
    x.status==="needs_review"||
    x.stage==="pipeline_refresh"||
    x.status==="complete"
  ).length;
  const automatedQueue=items.filter(x=>
    ["queued","running"].includes(x.status)&&
    ["evidence_ingestion","baseline_draft","research_draft"].includes(x.stage)
  ).length;

  const latestWorker=workerRuns[0]??null;

  return <>
    <header className={styles.header}>
      <SolpientBrand subtitle="Research Factory V1.1" />
      <div>
        <Link href="/review/research-candidates">Candidate Pipeline</Link>
        <Link href="/review/readiness-repair">Readiness Repair</Link>
        <Link href="/review/methodologies">Methodologies</Link>
      </div>
    </header>

    <main className={styles.shell}>
      <section className={styles.hero}>
        <div>
          <span className={styles.kicker}>AUTOMATIC QUEUE EXPANSION · V1.1</span>
          <h1>Drain safe research work into genuine human-review gates.</h1>
          <p>
            Each weekday, Factory V1.1 claims the next ranked safe batch of up to 10 names,
            advances only deterministic evidence and draft work, and stops a ticker as soon
            as identity, evidence, industry-module, valuation, or research judgment is required.
          </p>
        </div>
        <div className={styles.heroProgress}>
          <span>At review / post-review gate</span>
          <strong>{genuineReviewCount} / {items.length}</strong>
          <small>{run?.status==="completed"?"Automatic queue complete":automatedQueue+" safe automatic names remain"}</small>
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
          <div className={styles.opsCard}><span>Safe Automatic Queue</span><strong>{automatedQueue}</strong><small>next ranked work · max 10 / weekday</small></div>
          <div className={styles.opsCard}><span>Genuine Review Gates</span><strong>{genuineReviewCount}</strong><small>human judgment or post-review state</small></div>
          <div className={styles.opsCard}><span>Blocked</span><strong>{blockedCount}</strong><small>not counted as successful progress</small></div>
          <div className={styles.opsCard}><span>Latest Batch</span><strong>{latestWorker?.selected_count??0}</strong><small>{latestWorker?label(latestWorker.status)+" · "+new Date(latestWorker.started_at).toLocaleString():"No V1.1 batch yet"}</small></div>
          <div className={styles.opsCard}><span>Valuation Review</span><strong>{stageCounts.get("valuation_review")??0}</strong><small>draft only — never auto-reviewed</small></div>
          <div className={styles.opsCard}><span>Post-review / Complete</span><strong>{pipelineRefreshCount+completeCount}</strong><small>pipeline refresh or complete</small></div>
        </section>

        <section className={styles.preparePanel}>
          <div>
            <span className={styles.kicker}>WEEKDAY AUTOMATION</span>
            <h2>{run?.status==="completed"?"Automatic queue is complete.":"Next safe names advance automatically."}</h2>
            <p>
              V1.1 uses transactional ranked claims, skips every item already requiring human
              judgment, recovers stale claims after interrupted workers, and marks the factory
              run complete only when all {items.length} candidates are at genuine review or
              post-review gates.
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
                <div className={styles.opsCard}><span>Manual Reviews</span><strong>{item.manual_review_count??0}</strong><small>factory cannot clear these</small></div>
                <div className={styles.opsCard}><span>Valuation Draft</span><strong>{valuationDraft?"Yes":"—"}</strong><small>{missing.length?missing.length+" missing inputs":"not generated / no missing fields"}</small></div>
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
