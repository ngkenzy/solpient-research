import Link from "next/link";
import { redirect } from "next/navigation";
import { ConsumerHeader } from "@/components/ConsumerHeader";
import { createConsumerServerClient } from "@/lib/supabase/server-client";
import styles from "./outcome.module.css";

export const dynamic="force-dynamic";
export const revalidate=0;

const HORIZONS=[
  {key:"1d",label:"1 Day"},
  {key:"1w",label:"1 Week"},
  {key:"1m",label:"1 Month"},
  {key:"3m",label:"3 Months"},
  {key:"6m",label:"6 Months"},
  {key:"1y",label:"1 Year"},
];

function dateOnly(value:string|null|undefined){
  if(!value)return "—";
  return new Date(value+"T00:00:00Z").toLocaleDateString("en-US",{
    month:"short",day:"numeric",year:"numeric",timeZone:"UTC"
  });
}

function when(value:string){
  return new Date(value).toLocaleString("en-US",{
    month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZone:"UTC"
  });
}

function pct(value:number|null|undefined){
  if(value==null||!Number.isFinite(Number(value)))return "—";
  const n=Number(value);
  return (n>0?"+":"")+n.toFixed(1)+"%";
}

function addMonthsClamped(source:Date,months:number){
  const day=source.getUTCDate();
  const d=new Date(source);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth()+months);
  const lastDay=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
  d.setUTCDate(Math.min(day,lastDay));
  return d;
}

function horizonTarget(decidedAt:string,key:string){
  const source=new Date(decidedAt);
  if(key==="1d"){source.setUTCDate(source.getUTCDate()+1);return source.toISOString().slice(0,10);}
  if(key==="1w"){source.setUTCDate(source.getUTCDate()+7);return source.toISOString().slice(0,10);}
  if(key==="1m")return addMonthsClamped(source,1).toISOString().slice(0,10);
  if(key==="3m")return addMonthsClamped(source,3).toISOString().slice(0,10);
  if(key==="6m")return addMonthsClamped(source,6).toISOString().slice(0,10);
  if(key==="1y")return addMonthsClamped(source,12).toISOString().slice(0,10);
  return source.toISOString().slice(0,10);
}

export default async function DecisionOutcomePage({
  params,
}:{
  params:Promise<{positionId:string;entryId:string}>;
}){
  const {positionId,entryId}=await params;
  const supabase=await createConsumerServerClient();
  const {data:claims}=await supabase.auth.getClaims();
  if(!claims?.claims?.sub)redirect("/login");

  const {data:position}=await supabase
    .from("portfolio_positions")
    .select("id,company_id")
    .eq("id",positionId)
    .maybeSingle();
  if(!position)redirect("/portfolio?error=portfolio-access");

  const {data:decision}=await supabase
    .from("position_decision_journal")
    .select("id,decision_type,conviction,rationale,research_run_id,decision_snapshot,decided_at")
    .eq("id",entryId)
    .eq("position_id",positionId)
    .maybeSingle();
  if(!decision)redirect("/portfolio/"+positionId+"/journal");

  const since=decision.decided_at;
  const [companyR,outcomesR,companyChangesR,researchChangesR,factorHistoryR,alertsR]=await Promise.all([
    supabase.from("companies")
      .select("ticker,company_name")
      .eq("id",position.company_id)
      .maybeSingle(),
    supabase.from("decision_outcome_snapshots")
      .select("horizon,horizon_target_at,decision_price,decision_price_trading_date,observed_price,observed_trading_date,security_return_pct,benchmark_ticker,benchmark_return_pct,excess_return_pct,return_basis,methodology_version,captured_at")
      .eq("journal_entry_id",entryId)
      .order("horizon_target_at",{ascending:true}),
    supabase.from("company_change_events")
      .select("id,category,metric_key,label,summary,direction,materiality,decision_impact,occurred_at,created_at,source_url")
      .eq("company_id",position.company_id)
      .gte("created_at",since)
      .order("created_at",{ascending:false})
      .limit(50),
    supabase.from("research_changes")
      .select("id,category,change_type,metric_key,label,old_value,new_value,old_text,new_text,direction,materiality,summary,created_at")
      .eq("company_id",position.company_id)
      .gte("created_at",since)
      .order("created_at",{ascending:false})
      .limit(50),
    supabase.from("position_thesis_factor_history")
      .select("id,factor_key,factor_label,event_type,importance_before,importance_after,enabled_before,enabled_after,changed_at")
      .eq("position_id",positionId)
      .gte("changed_at",since)
      .order("changed_at",{ascending:false})
      .limit(50),
    supabase.from("thesis_alerts")
      .select("id,item_id,event_id,level,score,title,summary,occurred_at,created_at,state")
      .eq("position_id",positionId)
      .gte("created_at",since)
      .order("created_at",{ascending:false})
      .limit(50),
  ]);

  const outcomes=outcomesR.data??[];
  const outcomeByHorizon=new Map(outcomes.map((row:any)=>[row.horizon,row]));
  const snapshot=(decision.decision_snapshot??{}) as any;
  const capturedFactors=Array.isArray(snapshot.personal_thesis_factors)
    ? snapshot.personal_thesis_factors
    : [];
  const capturedMetricKeys=new Set(
    capturedFactors
      .map((factor:any)=>String(factor.factor_key??""))
      .filter((key:string)=>key.startsWith("canonical:metric:"))
      .map((key:string)=>key.replace("canonical:metric:","").toLowerCase())
  );
  const capturedResearch=snapshot.portfolio_research_state?.research_contract?.current_research;
  const company=companyR.data;
  const companyChanges=companyChangesR.data??[];
  const researchChanges=researchChangesR.data??[];
  const factorHistory=factorHistoryR.data??[];
  const alerts=alertsR.data??[];

  return(
    <div className={styles.page}>
      <ConsumerHeader
        active="portfolio"
        subtitle="Decision Outcome"
        action={<Link href={"/portfolio/"+positionId+"/journal"}>Decision journal</Link>}
      />

      <main className={styles.main}>
        <Link href={"/portfolio/"+positionId+"/journal"} className={styles.back}>
          ← Back to Decision Journal
        </Link>

        <section className={styles.hero}>
          <div>
            <span>DECISION AUDIT</span>
            <h1>{company?.ticker??"Company"} · {String(decision.decision_type).toUpperCase()}</h1>
            <p>
              Recorded {when(decision.decided_at)} · Conviction {decision.conviction}/5
              {capturedResearch?.version?" · Research v"+capturedResearch.version:""}
            </p>
          </div>
          <div className={styles.badge}>Append-only</div>
        </section>

        <section className={styles.decision}>
          <span>WHY I DECIDED</span>
          <p>{decision.rationale}</p>
          <footer>
            <strong>{capturedFactors.length}</strong> thesis factor{capturedFactors.length===1?"":"s"} captured at decision time
          </footer>
        </section>

        <section className={styles.section}>
          <div className={styles.heading}>
            <div><span>MARKET OUTCOME</span><h2>Fixed horizons</h2></div>
            <p>Close-price return · not dividend-adjusted total return</p>
          </div>

          <div className={styles.horizonGrid}>
            {HORIZONS.map(h=>{
              const row=outcomeByHorizon.get(h.key) as any;
              const target=horizonTarget(decision.decided_at,h.key);
              return(
                <article key={h.key} className={styles.horizonCard}>
                  <span>{h.label}</span>
                  {row?(
                    <>
                      <strong>{pct(row.security_return_pct)}</strong>
                      <dl>
                        <div><dt>{row.benchmark_ticker}</dt><dd>{pct(row.benchmark_return_pct)}</dd></div>
                        <div><dt>Excess</dt><dd>{pct(row.excess_return_pct)}</dd></div>
                      </dl>
                      <small>
                        {dateOnly(row.decision_price_trading_date)} → {dateOnly(row.observed_trading_date)}
                      </small>
                    </>
                  ):(
                    <>
                      <strong className={styles.pending}>Pending</strong>
                      <small>Target {dateOnly(target)}</small>
                    </>
                  )}
                </article>
              );
            })}
          </div>

          <div className={styles.method}>
            B16 V1 deliberately anchors to the last market close strictly before the decision date,
            preventing same-day closing data from leaking into a decision recorded earlier that day.
            Results are immutable by methodology version.
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.heading}>
            <div><span>WHAT MATTERS SINCE DECISION</span><h2>User-level material events</h2></div>
            <strong>{alerts.length}</strong>
          </div>
          <div className={styles.list}>
            {alerts.length?alerts.map((alert:any)=>(
              <article key={alert.id}>
                <div>
                  <small>{String(alert.level??"event").replaceAll("_"," ")} · score {alert.score??"—"}</small>
                  <h3>{alert.title}</h3>
                  {alert.summary?<p>{alert.summary}</p>:null}
                </div>
                <time>{when(alert.created_at)}</time>
              </article>
            )):<div className={styles.empty}>No user-level What Matters items have been recorded since this decision.</div>}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.heading}>
            <div><span>RESEARCH OUTCOME</span><h2>Canonical Research changes</h2></div>
            <strong>{researchChanges.length}</strong>
          </div>
          <div className={styles.list}>
            {researchChanges.length?researchChanges.map((change:any)=>{
              const matches=change.metric_key&&capturedMetricKeys.has(String(change.metric_key).toLowerCase());
              return(
                <article key={change.id}>
                  <div>
                    <small>
                      {change.materiality} · {change.category}
                      {matches?" · CAPTURED THESIS FACTOR":""}
                    </small>
                    <h3>{change.label}</h3>
                    <p>{change.summary}</p>
                  </div>
                  <time>{when(change.created_at)}</time>
                </article>
              );
            }):<div className={styles.empty}>No canonical Research changes have been recorded since this decision.</div>}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.heading}>
            <div><span>EVIDENCE OUTCOME</span><h2>Company changes</h2></div>
            <strong>{companyChanges.length}</strong>
          </div>
          <div className={styles.list}>
            {companyChanges.length?companyChanges.map((change:any)=>{
              const matches=change.metric_key&&capturedMetricKeys.has(String(change.metric_key).toLowerCase());
              return(
                <article key={change.id}>
                  <div>
                    <small>
                      {change.materiality} · {change.direction}
                      {matches?" · CAPTURED THESIS FACTOR":""}
                    </small>
                    <h3>{change.label}</h3>
                    <p>{change.summary}</p>
                  </div>
                  <time>{dateOnly(change.occurred_at)}</time>
                </article>
              );
            }):<div className={styles.empty}>No company-change events have been recorded since this decision.</div>}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.heading}>
            <div><span>YOUR THESIS AFTER DECISION</span><h2>Personal thesis changes</h2></div>
            <strong>{factorHistory.length}</strong>
          </div>
          <div className={styles.list}>
            {factorHistory.length?factorHistory.map((change:any)=>(
              <article key={change.id}>
                <div>
                  <small>{String(change.event_type).replaceAll("_"," ")}</small>
                  <h3>{change.factor_label}</h3>
                  <p>
                    Importance {change.importance_before??"—"} → {change.importance_after??"—"}
                    {" · "}
                    Enabled {change.enabled_before==null?"—":String(change.enabled_before)}
                    {" → "}
                    {change.enabled_after==null?"—":String(change.enabled_after)}
                  </p>
                </div>
                <time>{when(change.changed_at)}</time>
              </article>
            )):<div className={styles.empty}>Your thesis-factor settings have not changed since this decision.</div>}
          </div>
        </section>

        <section className={styles.note}>
          <strong>No hindsight score.</strong>
          <p>
            Solpient keeps market outcome, benchmark-relative outcome, canonical Research changes,
            evidence changes, and your own thesis changes separate. A profitable outcome does not
            by itself prove the original process was sound, and a loss does not by itself prove it was poor.
          </p>
        </section>
      </main>
    </div>
  );
}
