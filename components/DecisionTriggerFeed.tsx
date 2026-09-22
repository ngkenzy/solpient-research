import Link from "next/link";
import { loadActiveDecisionTriggers } from "@/lib/repositories/active-decision-triggers";
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
  const triggers=await loadActiveDecisionTriggers();
  if(!triggers)return null;
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
            const company={ticker:trigger.ticker,company_name:trigger.company_name};
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
