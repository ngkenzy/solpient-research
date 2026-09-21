import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";
import { getAdminSupabase } from "@/lib/admin-supabase";
import { requireReviewAccess } from "@/lib/review-auth";
import styles from "../review.module.css";

export const dynamic="force-dynamic";
export const runtime="nodejs";

const pct=(v:unknown)=>Number.isFinite(Number(v))?Number(v).toFixed(1)+"%":"—";
const stateLabel=(v:string)=>v.replaceAll("_"," ").replace(/\b\w/g,x=>x.toUpperCase());

export default async function ReadinessRepairPage(){
  await requireReviewAccess();
  const supabase=getAdminSupabase();
  if(!supabase)return null;

  const [plansR,itemsR,companiesR,runR]=await Promise.all([
    supabase.from("decision_readiness_repair_plans").select("*").order("company_priority",{ascending:false}),
    supabase.from("decision_readiness_repair_items").select("*").order("priority",{ascending:false}),
    supabase.from("companies").select("id,ticker,company_name"),
    supabase.from("automation_runs")
      .select("started_at,completed_at,status,records_written,message,details")
      .eq("pipeline","decision_readiness_repair")
      .order("started_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  for(const result of [plansR,itemsR,companiesR,runR])if(result.error)throw result.error;

  const companyById=new Map((companiesR.data??[]).map((row:any)=>[row.id,row]));
  const itemsByCompany=new Map<string,any[]>();
  for(const item of itemsR.data??[]){
    const rows=itemsByCompany.get(item.company_id)??[];
    rows.push(item);
    itemsByCompany.set(item.company_id,rows);
  }

  const plans=plansR.data??[];
  const building=plans.filter((p:any)=>p.current_state==="building").length;
  const researchReady=plans.filter((p:any)=>p.current_state==="research_ready").length;
  const decisionReady=plans.filter((p:any)=>p.current_state==="decision_ready").length;
  const activeItems=(itemsR.data??[]).filter((i:any)=>!i.phase2_sensitive);
  const autoItems=activeItems.filter((i:any)=>i.automation_mode==="auto").length;
  const manualItems=activeItems.filter((i:any)=>i.automation_mode==="manual").length;

  return <>
    <header className={styles.header}>
      <SolpientBrand subtitle="Decision Readiness Repair" />
      <div>
        <Link href="/review">Research Standard V2</Link>
        <Link href="/research">Public research</Link>
      </div>
    </header>

    <main className={styles.shell}>
      <section className={styles.hero}>
        <div>
          <span className={styles.kicker}>DECISION READINESS REPAIR ENGINE</span>
          <h1>Repair the research that matters next.</h1>
          <p>
            Converts Phase 3 readiness gates into ordered evidence work. The planner distinguishes
            what moves a company to Research Ready from what is still required for Decision Ready,
            then reprioritizes safe existing repair jobs by promotion impact.
          </p>
        </div>
        <div className={styles.heroProgress}>
          <span>Latest planner run</span>
          <strong>{runR.data?.status??"Pending"}</strong>
          <small>{runR.data?.completed_at?new Date(runR.data.completed_at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/New_York"}):"Not run yet"}</small>
        </div>
      </section>

      <section className={styles.opsGrid}>
        <div className={styles.opsCard}><span>Building</span><strong>{building}</strong><small>needs evidence to cross Research Ready</small></div>
        <div className={styles.opsCard}><span>Research Ready</span><strong>{researchReady}</strong><small>next target is Decision Ready</small></div>
        <div className={styles.opsCard}><span>Decision Ready</span><strong>{decisionReady}</strong><small>maintenance only</small></div>
        <div className={styles.opsCard}><span>Auto-repair actions</span><strong>{autoItems}</strong><small>can feed existing repair worker</small></div>
        <div className={styles.opsCard}><span>Manual evidence actions</span><strong>{manualItems}</strong><small>review-gated</small></div>
      </section>

      <section className={styles.preparePanel}>
        <div>
          <span className={styles.kicker}>PRIORITY LOGIC</span>
          <h2>Promotion impact, not raw coverage deficit</h2>
          <p>
            Building companies receive urgency first. Decision Score adds research value, then the
            engine favors repairs that directly clear a readiness gate, increase Evidence Confidence,
            and can be executed safely. Phase 2-sensitive provenance work is displayed but never auto-prioritized.
          </p>
        </div>
      </section>

      <section className={styles.queueHeader}>
        <div><span className={styles.kicker}>COMPANY REPAIR PATHS</span><h2>{plans.length} published companies</h2></div>
        <span>Highest repair priority first</span>
      </section>

      <section className={styles.queue}>
        {plans.map((plan:any)=>{
          const company:any=companyById.get(plan.company_id);
          const items=itemsByCompany.get(plan.company_id)??[];
          const nextItems=items
            .filter((item:any)=>item.sequence_to_next!=null)
            .sort((a:any,b:any)=>a.sequence_to_next-b.sequence_to_next);
          const decisionItems=items
            .filter((item:any)=>item.sequence_to_decision!=null)
            .sort((a:any,b:any)=>a.sequence_to_decision-b.sequence_to_decision);
          return <div className={styles.panel} key={plan.id}>
            <div className={styles.panelHeader}>
              <div>
                <span className={styles.kicker}>PRIORITY {plan.company_priority}</span>
                <h2>{company?.ticker??"—"} · {company?.company_name??"Unknown company"}</h2>
                <p>{stateLabel(plan.current_state)} → {stateLabel(plan.next_state)}</p>
              </div>
              <strong>{pct(plan.evidence_confidence)} confidence</strong>
            </div>

            <div className={styles.opsGrid}>
              <div className={styles.opsCard}><span>Decision score</span><strong>{Number(plan.decision_score??0).toFixed(1)}</strong><small>research triage input</small></div>
              <div className={styles.opsCard}><span>Repairs to next</span><strong>{plan.current_state==="building"?plan.research_ready_plan?.repairCount??0:plan.decision_ready_plan?.repairCount??0}</strong><small>{plan.current_state==="building"?"to Research Ready":"to Decision Ready"}</small></div>
              <div className={styles.opsCard}><span>Repairs to Decision Ready</span><strong>{plan.decision_ready_plan?.repairCount??0}</strong><small>{plan.decision_ready_reachable?"modeled reachable":"still blocked"}</small></div>
            </div>

            <div className={styles.detailGrid}>
              <section className={styles.panel}>
                <div className={styles.panelHeader}><div><span className={styles.kicker}>NEXT PROMOTION</span><h2>{stateLabel(plan.next_state)}</h2></div><strong>{nextItems.length}</strong></div>
                <div className={styles.gapList}>
                  {nextItems.length?nextItems.map((item:any)=><div key={item.id}>
                    <strong>{item.sequence_to_next}. {item.instruction}</strong>
                    <span>
                      {item.automation_mode.replaceAll("_"," ")} · priority {item.priority}
                      {item.estimated_evidence_gain!=null?" · estimated confidence +"+Number(item.estimated_evidence_gain).toFixed(1):""}
                      {item.phase2_sensitive?" · Phase 2 deferred":""}
                    </span>
                  </div>):<span>No repair action is required for the next readiness state.</span>}
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.panelHeader}><div><span className={styles.kicker}>FULL DECISION PATH</span><h2>Decision Ready</h2></div><strong>{decisionItems.length}</strong></div>
                <div className={styles.gapList}>
                  {decisionItems.length?decisionItems.map((item:any)=><div key={item.id}>
                    <strong>{item.sequence_to_decision}. {item.instruction}</strong>
                    <span>
                      {item.direct_gate?"required gate":"confidence booster"} · {item.automation_mode.replaceAll("_"," ")}
                      {item.projected_evidence_confidence!=null?" · projected confidence "+pct(item.projected_evidence_confidence):""}
                    </span>
                  </div>):<span>Already satisfies the modeled Decision Ready gates.</span>}
                </div>
              </section>
            </div>

            <div className={styles.formActions}>
              <Link href={"/research/"+company?.ticker}>Open published research →</Link>
            </div>
          </div>;
        })}
      </section>
    </main>
  </>;
}
