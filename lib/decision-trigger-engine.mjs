export const DECISION_TRIGGER_VERSION="decision-trigger-v1";

function n(value){
  if(value===null||value===undefined||value==="")return null;
  const x=Number(value);
  return Number.isFinite(x)?x:null;
}
function compare(current,comparator,threshold){
  const c=n(current),t=n(threshold);
  if(c==null||t==null||!comparator)return null;
  if(comparator==="<=")return c<=t;
  if(comparator===">=")return c>=t;
  if(comparator==="<")return c<t;
  if(comparator===">")return c>t;
  if(comparator==="=")return c===t;
  return null;
}
function violation(current,comparator,threshold){
  const satisfied=compare(current,comparator,threshold);
  return satisfied==null?null:!satisfied;
}
function metricMap(metricObservations=[],financialMetrics={}){
  const map=new Map();
  const sorted=[...metricObservations].sort((a,b)=>String(b.period_end??"").localeCompare(String(a.period_end??"")));
  for(const row of sorted){
    if(!row.metric_key||map.has(row.metric_key))continue;
    if(row.status&&row.status!=="available")continue;
    const value=n(row.value_numeric);
    if(value!=null)map.set(row.metric_key,{value,unit:row.unit??null,label:row.label??row.metric_key,period_end:row.period_end??null});
  }
  for(const [key,value] of Object.entries(financialMetrics??{})){
    if(map.has(key))continue;
    const parsed=n(value);
    if(parsed!=null)map.set(key,{value:parsed,unit:null,label:key,period_end:null});
  }
  return map;
}
function triggerStatus(hit,unavailableStatus="unavailable"){
  if(hit===null)return unavailableStatus;
  return hit?"triggered":"armed";
}
function addPriceTrigger(out,{key,label,threshold,currentPrice,comparator,effect,severity,rationale,sourceRef}){
  const t=n(threshold),p=n(currentPrice);
  if(t==null)return;
  const hit=compare(p,comparator,t);
  out.push({
    trigger_key:key,
    trigger_group:"valuation",
    label,
    metric_key:"market_price",
    comparator,
    threshold_value:t,
    threshold_unit:"USD/share",
    current_value:p,
    current_text:null,
    decision_effect:effect,
    severity,
    evaluation_status:triggerStatus(hit),
    rationale,
    source_kind:"valuation",
    source_ref:sourceRef??null,
    metadata:{trigger_version:DECISION_TRIGGER_VERSION},
  });
}
export function buildDecisionTriggers({
  currentPrice,
  valuation={},
  expectedReturns=[],
  thesisVariables=[],
  metricObservations=[],
  financialMetrics={},
  coverage=null,
}){
  const out=[];
  addPriceTrigger(out,{
    key:"price:mos25",label:"25% margin-of-safety price",
    threshold:valuation.mos_25_price,currentPrice,comparator:"<=",effect:"more_attractive",severity:"material",
    rationale:"The market price is at or below the research model's 25% margin-of-safety level.",
  });
  addPriceTrigger(out,{
    key:"price:mos35",label:"35% margin-of-safety price",
    threshold:valuation.mos_35_price,currentPrice,comparator:"<=",effect:"more_attractive",severity:"high",
    rationale:"The market price is at or below the research model's 35% margin-of-safety level.",
  });
  addPriceTrigger(out,{
    key:"price:mos50",label:"50% margin-of-safety price",
    threshold:valuation.mos_50_price,currentPrice,comparator:"<=",effect:"more_attractive",severity:"high",
    rationale:"The market price is at or below the research model's 50% margin-of-safety level.",
  });
  addPriceTrigger(out,{
    key:"price:base-fair-value",label:"Base fair value reached",
    threshold:valuation.base_value,currentPrice,comparator:">=",effect:"re_evaluate",severity:"material",
    rationale:"At or above base fair value, the modeled margin of safety has been exhausted and the expected-return case should be refreshed.",
  });
  addPriceTrigger(out,{
    key:"price:bull-value",label:"Bull-case value reached",
    threshold:valuation.bull_value,currentPrice,comparator:">=",effect:"re_evaluate",severity:"high",
    rationale:"At or above the published bull-case value, valuation assumptions should be re-underwritten before relying on further upside.",
  });

  const base5=expectedReturns.find(x=>String(x.scenario).toLowerCase()==="base"&&Number(x.horizon_years)===5);
  const hurdle=n(valuation.discount_rate);
  const baseCagr=n(base5?.expected_cagr);
  if(hurdle!=null){
    const hit=baseCagr==null?null:baseCagr<hurdle;
    out.push({
      trigger_key:"return:base-below-required-return",
      trigger_group:"return",
      label:"Base expected return below required return",
      metric_key:"base_5y_expected_cagr",
      comparator:">=",
      threshold_value:hurdle,
      threshold_unit:"percent CAGR",
      current_value:baseCagr,
      current_text:null,
      decision_effect:"re_evaluate",
      severity:"high",
      evaluation_status:triggerStatus(hit),
      rationale:"The 5-year base-case CAGR is compared with the same required-return assumption used as the DCF discount rate. Falling below that hurdle means the base case no longer clears its own required return.",
      source_kind:"expected_return",
      source_ref:base5?.id??null,
      metadata:{trigger_version:DECISION_TRIGGER_VERSION,hurdle_basis:"dcf_discount_rate"},
    });
  }

  const metrics=metricMap(metricObservations,financialMetrics);
  for(const variable of thesisVariables){
    const key=String(variable.metric_key??"").trim();
    const comparator=variable.comparator??null;
    const threshold=n(variable.threshold_value);
    const observed=key?metrics.get(key):null;

    if(key&&comparator&&threshold!=null){
      const breached=violation(observed?.value??null,comparator,threshold);
      const severe=String(variable.status??"").toLowerCase()==="weakened";
      out.push({
        trigger_key:"thesis-threshold:"+String(variable.id??variable.variable_name).toLowerCase().replaceAll(" ","-"),
        trigger_group:"thesis",
        label:String(variable.variable_name??key),
        metric_key:key,
        comparator,
        threshold_value:threshold,
        threshold_unit:variable.threshold_unit??observed?.unit??null,
        current_value:observed?.value??null,
        current_text:variable.observed_value??null,
        decision_effect:"re_evaluate",
        severity:severe?"high":"material",
        evaluation_status:triggerStatus(breached),
        rationale:"This threshold is stored in the published thesis variable. A breach does not automatically break the thesis; it requires re-evaluation against the full breaker condition.",
        source_kind:"thesis_variable",
        source_ref:variable.id??null,
        metadata:{
          trigger_version:DECISION_TRIGGER_VERSION,
          variable_status:variable.status??null,
          review_frequency:variable.review_frequency??null,
          breaker_condition:variable.breaker_condition??null,
          period_end:observed?.period_end??null,
        },
      });
    }

    if(variable.breaker_condition){
      const status=String(variable.status??"unknown").toLowerCase();
      out.push({
        trigger_key:"thesis-breaker:"+String(variable.id??variable.variable_name).toLowerCase().replaceAll(" ","-"),
        trigger_group:"thesis",
        label:String(variable.variable_name??"Thesis breaker"),
        metric_key:key||null,
        comparator:"manual",
        threshold_value:null,
        threshold_unit:null,
        current_value:observed?.value??null,
        current_text:variable.observed_value??null,
        decision_effect:"thesis_breaker",
        severity:status==="weakened"?"high":"material",
        evaluation_status:status==="weakened"?"needs_review":"monitor",
        rationale:String(variable.breaker_condition),
        source_kind:"thesis_variable",
        source_ref:variable.id??null,
        metadata:{
          trigger_version:DECISION_TRIGGER_VERSION,
          variable_status:variable.status??null,
          review_frequency:variable.review_frequency??null,
          mechanically_evaluable:false,
        },
      });
    }
  }

  const readiness=n(coverage?.decision_readiness_pct??coverage?.overall_pct);
  if(readiness!=null){
    out.push({
      trigger_key:"data-quality:decision-readiness",
      trigger_group:"data_quality",
      label:"Research evidence readiness",
      metric_key:"decision_readiness_pct",
      comparator:">=",
      threshold_value:70,
      threshold_unit:"percent",
      current_value:readiness,
      current_text:null,
      decision_effect:"monitor",
      severity:readiness<70?"high":"material",
      evaluation_status:readiness<70?"triggered":readiness<85?"monitor":"armed",
      rationale:"Below 70% readiness, the evidence base is too incomplete for Solpient to treat the research package as decision-grade. Between 70% and 85%, evidence quality remains under monitoring.",
      source_kind:"coverage",
      source_ref:null,
      metadata:{trigger_version:DECISION_TRIGGER_VERSION},
    });
  }

  return out;
}

export function summarizeDecisionTriggers(triggers=[]){
  const triggered=triggers.filter(t=>t.evaluation_status==="triggered");
  const review=triggers.filter(t=>t.evaluation_status==="needs_review");
  const attractive=triggered.filter(t=>t.decision_effect==="more_attractive");
  const reevaluate=triggered.filter(t=>t.decision_effect==="re_evaluate");
  const breakers=review.filter(t=>t.decision_effect==="thesis_breaker");
  let status="monitor";
  if(breakers.length||reevaluate.length)status="re_evaluate";
  else if(attractive.length)status="valuation_opportunity";
  else if(!triggered.length&&!review.length)status="stable";
  return{
    status,
    triggered:triggered.length,
    needs_review:review.length,
    valuation_opportunities:attractive.length,
    re_evaluate:reevaluate.length,
    thesis_breakers_to_review:breakers.length,
  };
}
