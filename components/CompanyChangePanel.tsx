import { getSupabase } from "@/lib/supabase";
import styles from "./CompanyChangePanel.module.css";

function n(value:unknown){
  const x=Number(value);
  return Number.isFinite(x)?x:null;
}
function formatValue(event:any,side:"old"|"new"){
  const value=n(event[side+"_value"]);
  if(value!=null){
    const key=String(event.metric_key??"");
    if(key.includes("price")||key.includes("value")||key.includes("eps_next_fy"))
      return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(value);
    if(key.includes("pct")||key.includes("yield")||key.includes("growth")||key.includes("margin")||key.includes("readiness"))
      return value.toFixed(1)+"%";
    if(key.includes("ratio")||key.includes("price_to_fcf"))return value.toFixed(2)+"×";
    return new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(value);
  }
  return event[side+"_text"]??"—";
}
function dateLabel(value:string|null|undefined){
  if(!value)return"—";
  return new Date(value+"T00:00:00Z").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
}
function impactLabel(value:string){
  if(value==="improving")return"Improving";
  if(value==="weakening")return"Weakening";
  if(value==="monitor")return"Review";
  return"Neutral";
}
function overallTrend(events:any[]){
  const improving=events.filter(e=>e.decision_impact==="improving").length;
  const weakening=events.filter(e=>e.decision_impact==="weakening").length;
  const monitor=events.filter(e=>e.decision_impact==="monitor").length;
  if(!events.length)return{label:"No material change",tone:"neutral",detail:"The change engine has not detected a threshold-breaking update for this research state."};
  if(weakening>improving)return{label:"Re-evaluate",tone:"weakening",detail:weakening+" weakening signal"+(weakening===1?"":"s")+" currently outweigh "+improving+" improving signal"+(improving===1?"":"s")+"."};
  if(improving>weakening)return{label:"Improving",tone:"improving",detail:improving+" improving signal"+(improving===1?"":"s")+" currently outweigh "+weakening+" weakening signal"+(weakening===1?"":"s")+"."};
  if(monitor)return{label:"Monitor",tone:"monitor",detail:"The evidence mix is balanced, but "+monitor+" item"+(monitor===1?" requires":"s require")+" review."};
  return{label:"Mixed",tone:"neutral",detail:"Improving and weakening changes currently offset each other."};
}

export async function CompanyChangePanel({
  companyId,
  researchRunId,
  ticker,
  asOf=null,
}:{
  companyId:string;
  researchRunId:string;
  ticker:string;
  asOf?:string|null;
}) {
  const supabase=getSupabase();
  if(!supabase)return null;

  let eventQuery=supabase
    .from("company_change_events")
    .select("*")
    .eq("company_id",companyId)
    .eq("research_run_id",researchRunId);
  if(asOf)eventQuery=eventQuery.lte("created_at",asOf);
  const {data:events}=await eventQuery
    .order("occurred_at",{ascending:false})
    .order("created_at",{ascending:false})
    .limit(16);

  const rows=events??[];
  const trend=overallTrend(rows);
  const counts={
    improving:rows.filter(e=>e.decision_impact==="improving").length,
    weakening:rows.filter(e=>e.decision_impact==="weakening").length,
    review:rows.filter(e=>e.decision_impact==="monitor").length,
    high:rows.filter(e=>e.materiality==="high").length,
  };
  const priority=[...rows].sort((a,b)=>{
    const score=(e:any)=>(e.materiality==="high"?30:0)+(e.decision_impact==="weakening"?20:e.decision_impact==="monitor"?10:e.decision_impact==="improving"?5:0);
    return score(b)-score(a)||String(b.occurred_at).localeCompare(String(a.occurred_at));
  });

  return(
    <section className={styles.section} id="what-changed">
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>COMPANY CHANGE ENGINE</span>
          <h2>What changed — and what should be re-evaluated?</h2>
          <p>Threshold-based changes from valuation, expected return, consensus, financials, thesis variables, coverage, and SEC filings.</p>
        </div>
        <div className={styles.trend+" "+styles[trend.tone]}>
          <span>Decision impact</span>
          <strong>{trend.label}</strong>
          <small>{rows.length} material change{rows.length===1?"":"s"}</small>
        </div>
      </div>

      <div className={styles.summaryGrid}>
        <div><span>Improving</span><strong className={styles.improvingText}>{counts.improving}</strong></div>
        <div><span>Weakening</span><strong className={styles.weakeningText}>{counts.weakening}</strong></div>
        <div><span>Needs review</span><strong className={styles.monitorText}>{counts.review}</strong></div>
        <div><span>High materiality</span><strong>{counts.high}</strong></div>
      </div>

      <div className={styles.decisionNote}>
        <span>{ticker} CHANGE SUMMARY</span>
        <p>{trend.detail}</p>
      </div>

      {priority.length?(
        <div className={styles.events}>
          {priority.slice(0,10).map((event:any)=>(
            <article className={styles.event} key={event.id}>
              <div className={styles.eventTop}>
                <div>
                  <span className={styles.category}>{String(event.category).replaceAll("_"," ")}</span>
                  <strong>{event.label}</strong>
                </div>
                <div className={styles.badges}>
                  <b className={styles["impact_"+event.decision_impact]}>{impactLabel(event.decision_impact)}</b>
                  {event.materiality==="high"?<b className={styles.high}>High</b>:null}
                </div>
              </div>

              {(event.old_value!=null||event.new_value!=null||event.old_text||event.new_text)?(
                <div className={styles.delta}>
                  <span>{formatValue(event,"old")}</span>
                  <i>→</i>
                  <strong>{formatValue(event,"new")}</strong>
                  {event.delta_percent!=null?<em>{Number(event.delta_percent)>=0?"+":""}{Number(event.delta_percent).toFixed(1)}%</em>:null}
                </div>
              ):null}

              <p>{event.summary}</p>
              <footer>
                <span>{dateLabel(event.occurred_at)}</span>
                <span>{String(event.source_kind??"state").replaceAll("_"," ")}</span>
                {event.source_url?<a href={event.source_url} target="_blank" rel="noreferrer">Source ↗</a>:null}
              </footer>
            </article>
          ))}
        </div>
      ):(
        <div className={styles.empty}>
          <strong>No threshold-breaking changes yet.</strong>
          <p>The current state is now locked. Future refreshes will be compared against it automatically.</p>
        </div>
      )}
    </section>
  );
}
