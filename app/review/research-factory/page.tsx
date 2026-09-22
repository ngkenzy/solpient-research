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
  if(run){
    const [itemsR,draftsR]=await Promise.all([
      supabase.from("research_factory_items")
        .select("*")
        .eq("research_factory_run_id",run.id)
        .order("ordinal",{ascending:true}),
      supabase.from("research_factory_valuation_drafts")
        .select("id,research_factory_item_id,missing_fields,preflight,created_at")
        .order("created_at",{ascending:false}),
    ]);
    if(itemsR.error)throw itemsR.error;
    if(draftsR.error)throw draftsR.error;
    items=itemsR.data??[];
    const itemIds=new Set(items.map(x=>x.id));
    drafts=(draftsR.data??[]).filter(x=>itemIds.has(x.research_factory_item_id));
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
  const automatedQueue=items.filter(x=>
    ["queued","running"].includes(x.status)&&
    ["evidence_ingestion","baseline_draft","research_draft"].includes(x.stage)
  ).length;

  return <>
    <header className={styles.header}>
      <SolpientBrand subtitle="Research Factory V1" />
      <div>
        <Link href="/review/research-candidates">Candidate Pipeline</Link>
        <Link href="/review/readiness-repair">Readiness Repair</Link>
        <Link href="/review/methodologies">Methodologies</Link>
      </div>
    </header>

    <main className={styles.shell}>
      <section className={styles.hero}>
        <div>
          <span className={styles.kicker}>EVIDENCE → DRAFT → REVIEW</span>
          <h1>Turn the deep-research shortlist into an auditable work queue.</h1>
          <p>
            Factory V1 automates onboarding, evidence collection, coverage, private drafts,
            and evidence-prefilled valuation inputs. Research publication and valuation
            approval remain explicit human-review actions.
          </p>
        </div>
        <div className={styles.heroProgress}>
          <span>Latest factory run</span>
          <strong>{items.length}</strong>
          <small>{run?new Date(run.created_at).toLocaleString():"Not materialized yet"}</small>
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
          <div className={styles.opsCard}><span>Automatic Queue</span><strong>{automatedQueue}</strong><small>safe evidence/draft work</small></div>
          <div className={styles.opsCard}><span>Needs Review</span><strong>{reviewCount}</strong><small>human judgment required</small></div>
          <div className={styles.opsCard}><span>Blocked</span><strong>{blockedCount}</strong><small>identity/data failure</small></div>
          <div className={styles.opsCard}><span>Complete</span><strong>{completeCount}</strong><small>no factory work pending</small></div>
          <div className={styles.opsCard}><span>Valuation Review</span><strong>{stageCounts.get("valuation_review")??0}</strong><small>draft only — never auto-reviewed</small></div>
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
