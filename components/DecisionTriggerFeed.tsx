import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import styles from "./DecisionTriggerFeed.module.css";

function n(value:unknown){const x=Number(value);return Number.isFinite(x)?x:null;}
function formatValue(trigger:any,value:unknown){
  const x=n(value);
  if(x==null)return"—";
  const unit=String(trigger.threshold_unit??"").toLowerCase();
  if(unit.includes("usd"))return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(x);
  if(unit.includes("percent")||unit.includes("cagr"))return x.toFixed(1)+"%";
  if(unit.includes("x"))return x.toFixed(2)+"×";
  return new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(x);
}
function effect(value:string){
  if(value==="more_attractive")return"Valuation opportunity";
  if(value==="re_evaluate")return"Re-evaluate";
  if(value==="thesis_breaker")return"Thesis review";
  return"Monitor";
}

export async function DecisionTriggerFeed(){
  const supabase=getSupabase();
  if(!supabase)return null;

  const {data:rows}=await supabase
    .from("decision_triggers")
    .select("id,company_id,research_run_id,trigger_key,trigger_group,label,metric_key,comparator,threshold_value,threshold_unit,current_value,current_text,decision_effect,severity,evaluation_status,rationale,last_evaluated_at,companies(ticker,company_name)")
    .in("evaluation_status",["triggered","needs_review"])
    .neq("trigger_group","data_quality")
    .order("severity",{ascending:false})
    .order("updated_at",{ascending:false})
    .limit(40);

  const triggers=rows??[];
  return(
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>DECISION TRIGGERS</span>
          <h2>Conditions crossed now</h2>
          <p>Live valuation, return-hurdle, and thesis-review conditions from published research models.</p>
        </div>
        <div className={styles.count}>
          <strong>{triggers.length}</strong>
          <span>active conditions</span>
        </div>
      </div>

      {triggers.length?(
        <div className={styles.list}>
          {triggers.map((trigger:any)=>{
            const company=Array.isArray(trigger.companies)?trigger.companies[0]:trigger.companies;
            return(
              <article className={styles.row} key={trigger.id}>
                <div className={styles.ticker}>{company?.ticker??"—"}</div>
                <div className={styles.body}>
                  <div className={styles.rowTop}>
                    <div>
                      <strong>{trigger.label}</strong>
                      <span>{company?.company_name??""} · {effect(trigger.decision_effect)}</span>
                    </div>
                    <div>
                      <b className={styles["effect_"+trigger.decision_effect]}>{effect(trigger.decision_effect)}</b>
                      {trigger.severity==="high"?<b className={styles.high}>High</b>:null}
                    </div>
                  </div>
                  {trigger.comparator!=="manual"?(
                    <div className={styles.values}>
                      <span>Current {formatValue(trigger,trigger.current_value)}</span>
                      <i>{trigger.comparator}</i>
                      <span>Threshold {formatValue(trigger,trigger.threshold_value)}</span>
                    </div>
                  ):null}
                  <p>{trigger.rationale}</p>
                </div>
                <Link href={"/research/"+(company?.ticker??"")}>Open →</Link>
              </article>
            );
          })}
        </div>
      ):(
        <div className={styles.empty}>
          <strong>No active decision triggers.</strong>
          <p>The trigger engine will populate this feed when a modeled threshold is crossed or a thesis breaker requires review.</p>
        </div>
      )}
    </section>
  );
}
