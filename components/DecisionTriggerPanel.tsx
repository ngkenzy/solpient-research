import { loadDecisionTriggers } from "@/lib/repositories/decision-triggers";
import styles from "./DecisionTriggerPanel.module.css";

function n(value:unknown){
  const x=Number(value);
  return Number.isFinite(x)?x:null;
}
function formatValue(trigger:any,value:unknown){
  const x=n(value);
  if(x==null)return"—";
  const unit=String(trigger.threshold_unit??"").toLowerCase();
  if(unit.includes("usd"))return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(x);
  if(unit.includes("percent")||unit.includes("cagr"))return x.toFixed(1)+"%";
  if(unit.includes("x"))return x.toFixed(2)+"×";
  return new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(x);
}
function effectLabel(value:string){
  if(value==="more_attractive")return"Valuation opportunity";
  if(value==="re_evaluate")return"Re-evaluate";
  if(value==="thesis_breaker")return"Thesis breaker";
  return"Monitor";
}
function statusLabel(value:string){
  if(value==="needs_review")return"Needs review";
  if(value==="triggered")return"Triggered";
  if(value==="unavailable")return"Data unavailable";
  if(value==="armed")return"Armed";
  return"Monitoring";
}

export async function DecisionTriggerPanel({
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
  const triggers=await loadDecisionTriggers(companyId,researchRunId,asOf);
  if(!triggers)return null;
  if(!triggers.length)return null;

  const active=triggers.filter((t:any)=>["triggered","needs_review"].includes(t.evaluation_status));
  const valuation=triggers.filter((t:any)=>t.trigger_group==="valuation");
  const returns=triggers.filter((t:any)=>t.trigger_group==="return");
  const thesis=triggers.filter((t:any)=>t.trigger_group==="thesis"&&t.decision_effect==="thesis_breaker");
  const opportunity=active.filter((t:any)=>t.decision_effect==="more_attractive").length;
  const reevaluate=active.filter((t:any)=>t.decision_effect==="re_evaluate").length;
  const breakerReview=active.filter((t:any)=>t.decision_effect==="thesis_breaker").length;

  let headline="Monitor";
  let tone="monitor";
  if(breakerReview||reevaluate){
    headline="Re-evaluate";
    tone="review";
  }else if(opportunity){
    headline="Valuation opportunity";
    tone="opportunity";
  }else if(!active.length){
    headline="No active decision trigger";
    tone="clear";
  }

  const priceTrigger=valuation.find((t:any)=>t.metric_key==="market_price"&&t.current_value!=null);
  const currentPrice=n(priceTrigger?.current_value);

  return(
    <section className={styles.section} id="decision-triggers">
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>DECISION TRIGGER ENGINE</span>
          <h2>What would change the decision?</h2>
          <p>Company-specific thresholds derived from the published valuation model, required return, and thesis conditions.</p>
        </div>
        <div className={styles.state+" "+styles[tone]}>
          <span>Current state</span>
          <strong>{headline}</strong>
          <small>{active.length} active · {triggers.length} monitored</small>
        </div>
      </div>

      <div className={styles.topGrid}>
        <article>
          <span className={styles.kicker}>PRICE MAP</span>
          <div className={styles.currentPrice}>
            <span>Current</span>
            <strong>{currentPrice==null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(currentPrice)}</strong>
          </div>
          <div className={styles.thresholdList}>
            {valuation.map((trigger:any)=>(
              <div className={trigger.evaluation_status==="triggered"?styles.thresholdActive:""} key={trigger.id}>
                <span>{trigger.label}</span>
                <strong>{trigger.comparator} {formatValue(trigger,trigger.threshold_value)}</strong>
                <b>{statusLabel(trigger.evaluation_status)}</b>
              </div>
            ))}
          </div>
        </article>

        <article>
          <span className={styles.kicker}>RETURN HURDLE</span>
          {returns.length?returns.map((trigger:any)=>(
            <div className={styles.returnCard} key={trigger.id}>
              <div>
                <span>5Y base expected CAGR</span>
                <strong>{formatValue(trigger,trigger.current_value)}</strong>
              </div>
              <i>vs</i>
              <div>
                <span>DCF required return</span>
                <strong>{formatValue(trigger,trigger.threshold_value)}</strong>
              </div>
              <b className={styles["status_"+trigger.evaluation_status]}>{statusLabel(trigger.evaluation_status)}</b>
              <p>{trigger.rationale}</p>
            </div>
          )):<p className={styles.emptyText}>Expected-return hurdle is not available for this research version.</p>}
        </article>
      </div>

      <div className={styles.activeSection}>
        <div className={styles.subhead}>
          <div>
            <span className={styles.kicker}>ACTIVE NOW</span>
            <h3>{active.length?active.length+" conditions need attention":"No trigger is currently crossed"}</h3>
          </div>
          <div className={styles.miniStats}>
            <span>{opportunity} opportunity</span>
            <span>{reevaluate} re-evaluate</span>
            <span>{breakerReview} breaker review</span>
          </div>
        </div>

        {active.length?(
          <div className={styles.activeGrid}>
            {active.map((trigger:any)=>(
              <article className={styles.triggerCard+" "+styles["effect_"+trigger.decision_effect]} key={trigger.id}>
                <div className={styles.triggerTop}>
                  <span>{effectLabel(trigger.decision_effect)}</span>
                  <b>{trigger.severity}</b>
                </div>
                <h4>{trigger.label}</h4>
                {trigger.comparator!=="manual"?(
                  <div className={styles.triggerValues}>
                    <div><span>Current</span><strong>{formatValue(trigger,trigger.current_value)}</strong></div>
                    <i>{trigger.comparator}</i>
                    <div><span>Threshold</span><strong>{formatValue(trigger,trigger.threshold_value)}</strong></div>
                  </div>
                ):null}
                <p>{trigger.rationale}</p>
                {trigger.current_text?<small>{trigger.current_text}</small>:null}
              </article>
            ))}
          </div>
        ):(
          <div className={styles.clearBox}>
            <strong>{ticker} has no crossed decision threshold.</strong>
            <p>The engine will keep evaluating price, required return, thesis metrics, and evidence quality as new data arrives.</p>
          </div>
        )}
      </div>

      <div className={styles.breakerSection}>
        <span className={styles.kicker}>THESIS BREAKERS</span>
        <h3>Conditions that would invalidate or materially weaken the thesis</h3>
        <p className={styles.breakerIntro}>These conditions are preserved exactly as research guardrails. Qualitative breakers require review; Solpient does not auto-declare them broken from a single metric print.</p>
        <div className={styles.breakerGrid}>
          {thesis.map((trigger:any)=>(
            <article key={trigger.id}>
              <div>
                <strong>{trigger.label}</strong>
                <b className={styles["status_"+trigger.evaluation_status]}>{statusLabel(trigger.evaluation_status)}</b>
              </div>
              <p>{trigger.rationale}</p>
              {trigger.current_text?<small>Current evidence: {trigger.current_text}</small>:null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
