export const COMPANY_STATE_VERSION="company-state-v1";

function n(value){
  if(value===null||value===undefined||value==="")return null;
  const x=Number(value);
  return Number.isFinite(x)?x:null;
}
function pctDelta(oldValue,newValue){
  const a=n(oldValue),b=n(newValue);
  if(a==null||b==null||a===0)return null;
  return (b-a)/Math.abs(a)*100;
}
function impactFor(direction,upImpact,downImpact){
  if(direction==="up")return upImpact;
  if(direction==="down")return downImpact;
  return "neutral";
}
function materialityFromMagnitude(delta,threshold,relative=false){
  if(delta==null)return "material";
  const mag=Math.abs(delta);
  if(threshold>0&&mag>=threshold*2)return "high";
  return relative&&mag>=15?"high":"material";
}
function addNumeric(events,{
  companyId,currentSnapshotId,previousSnapshotId,researchRunId,occurredAt,
  category,metricKey,label,oldValue,newValue,absThreshold=0,relativeThreshold=0,
  unit="",upImpact="neutral",downImpact="neutral",sourceKind="state",sourceId=null,sourceUrl=null,
}){
  const oldN=n(oldValue),newN=n(newValue);
  if(oldN==null||newN==null)return;
  const delta=newN-oldN;
  const rel=pctDelta(oldN,newN);
  const absHit=absThreshold>0&&Math.abs(delta)>=absThreshold;
  const relHit=relativeThreshold>0&&rel!=null&&Math.abs(rel)>=relativeThreshold;
  if(!(absHit||relHit))return;
  const direction=delta>0?"up":delta<0?"down":"unchanged";
  if(direction==="unchanged")return;
  const impact=impactFor(direction,upImpact,downImpact);
  const usedThreshold=absHit?absThreshold:relativeThreshold;
  const magnitude=absHit?delta:rel;
  const materiality=materialityFromMagnitude(magnitude,usedThreshold,!absHit);
  const valueText=(v)=>unit==="$"?"$"+v.toFixed(2):unit==="%"?v.toFixed(1)+"%":unit==="x"?v.toFixed(2)+"×":v.toFixed(2)+(unit?" "+unit:"");
  const relText=rel==null?"":" ("+(rel>=0?"+":"")+rel.toFixed(1)+"%)";
  events.push({
    company_id:companyId,current_snapshot_id:currentSnapshotId,previous_snapshot_id:previousSnapshotId,
    research_run_id:researchRunId,event_key:"metric:"+metricKey,category,metric_key:metricKey,label,
    old_value:oldN,new_value:newN,delta_value:delta,delta_percent:rel,
    old_text:null,new_text:null,direction,materiality,decision_impact:impact,
    summary:label+" changed from "+valueText(oldN)+" to "+valueText(newN)+relText+".",
    source_kind:sourceKind,source_id:sourceId,source_url:sourceUrl,occurred_at:occurredAt,
  });
}
function thesisImpact(status){
  const s=String(status??"unknown").toLowerCase();
  if(s==="strengthened")return"improving";
  if(s==="weakened")return"weakening";
  if(s==="monitor"||s==="unknown")return"monitor";
  return"neutral";
}
function mapThesis(items=[]){
  return new Map(items.map(item=>[String(item.variable_name??item.name??"").trim().toLowerCase(),item]).filter(([key])=>key));
}
export function buildCompanyChangeEvents({
  companyId,currentSnapshotId,previousSnapshotId,researchRunId,current,previous,occurredAt,
}){
  if(!previous)return[];
  const events=[];

  const numericRules=[
    ["market","market.price","Market price",previous.market?.price,current.market?.price,0,8,"$","weakening","improving"],
    ["valuation","valuation.discount_to_fair_value","Discount to fair value",previous.valuation?.discount_to_fair_value,current.valuation?.discount_to_fair_value,5,0,"%","improving","weakening"],
    ["valuation","valuation.base_value","Base fair value",previous.valuation?.base_value,current.valuation?.base_value,0,5,"$","improving","weakening"],
    ["valuation","valuation.mos_25_price","25% margin-of-safety price",previous.valuation?.mos_25_price,current.valuation?.mos_25_price,0,5,"$","improving","weakening"],
    ["valuation","valuation.price_to_fcf","Price / FCF",previous.valuation?.price_to_fcf,current.valuation?.price_to_fcf,0,10,"x","weakening","improving"],
    ["valuation","valuation.fcf_yield","FCF yield",previous.valuation?.fcf_yield,current.valuation?.fcf_yield,.75,0,"%","improving","weakening"],
    ["return","returns.base_5y_cagr","5Y base expected CAGR",previous.returns?.base_5y_cagr,current.returns?.base_5y_cagr,1.5,0,"%","improving","weakening"],
    ["consensus","consensus.eps_next_fy","Next-FY EPS consensus",previous.consensus?.eps_next_fy,current.consensus?.eps_next_fy,0,3,"$","improving","weakening"],
    ["consensus","consensus.revenue_next_fy","Next-FY revenue consensus",previous.consensus?.revenue_next_fy,current.consensus?.revenue_next_fy,0,3,"","improving","weakening"],
    ["consensus","consensus.eps_growth_next_fy","Next-FY EPS growth",previous.consensus?.eps_growth_next_fy,current.consensus?.eps_growth_next_fy,2,0,"%","improving","weakening"],
    ["financial","financial.revenue_growth_1y","Revenue growth",previous.financial?.revenue_growth_1y,current.financial?.revenue_growth_1y,2,0,"%","improving","weakening"],
    ["financial","financial.fcf_margin","FCF margin",previous.financial?.fcf_margin,current.financial?.fcf_margin,2,0,"%","improving","weakening"],
    ["financial","financial.debt_to_equity","Debt / equity",previous.financial?.debt_to_equity,current.financial?.debt_to_equity,.15,0,"x","weakening","improving"],
    ["financial","financial.total_debt","Total debt",previous.financial?.total_debt,current.financial?.total_debt,0,10,"","weakening","improving"],
    ["score","scores.overall_score","Overall score",previous.scores?.overall_score,current.scores?.overall_score,3,0,"pts","improving","weakening"],
    ["score","scores.thesis_integrity_score","Thesis integrity score",previous.scores?.thesis_integrity_score,current.scores?.thesis_integrity_score,5,0,"pts","improving","weakening"],
    ["coverage","coverage.decision_readiness_pct","Decision readiness",previous.coverage?.decision_readiness_pct,current.coverage?.decision_readiness_pct,5,0,"%","improving","weakening"],
  ];
  for(const [category,metricKey,label,oldValue,newValue,absThreshold,relativeThreshold,unit,upImpact,downImpact] of numericRules){
    addNumeric(events,{companyId,currentSnapshotId,previousSnapshotId,researchRunId,occurredAt,category,metricKey,label,oldValue,newValue,absThreshold,relativeThreshold,unit,upImpact,downImpact});
  }

  const prevThesis=mapThesis(previous.thesis??[]);
  const currThesis=mapThesis(current.thesis??[]);
  for(const [key,item] of currThesis){
    const prev=prevThesis.get(key);
    if(!prev)continue;
    const oldStatus=String(prev.status??"unknown");
    const newStatus=String(item.status??"unknown");
    const oldObserved=String(prev.observed_value??"");
    const newObserved=String(item.observed_value??"");
    if(oldStatus===newStatus&&oldObserved===newObserved)continue;
    const impact=thesisImpact(newStatus);
    events.push({
      company_id:companyId,current_snapshot_id:currentSnapshotId,previous_snapshot_id:previousSnapshotId,
      research_run_id:researchRunId,event_key:"thesis:"+key,category:"thesis",metric_key:"thesis:"+key,
      label:item.variable_name??prev.variable_name??key,old_value:null,new_value:null,delta_value:null,delta_percent:null,
      old_text:oldStatus,new_text:newStatus,direction:newStatus,materiality:oldStatus!==newStatus?"high":"notable",
      decision_impact:impact,
      summary:(item.variable_name??prev.variable_name??key)+" changed from "+oldStatus+" to "+newStatus+".",
      source_kind:"research",source_id:researchRunId??null,source_url:null,occurred_at:occurredAt,
    });
  }

  const prevFiling=previous.filing??null,currFiling=current.filing??null;
  if(currFiling?.accession_number&&currFiling.accession_number!==prevFiling?.accession_number){
    events.push({
      company_id:companyId,current_snapshot_id:currentSnapshotId,previous_snapshot_id:previousSnapshotId,
      research_run_id:researchRunId,event_key:"filing:"+currFiling.accession_number,category:"filing",metric_key:"latest_filing",
      label:"New "+(currFiling.form_type??"SEC filing"),old_value:null,new_value:null,delta_value:null,delta_percent:null,
      old_text:prevFiling?.accession_number??null,new_text:currFiling.accession_number,direction:"new",
      materiality:["10-K","10-Q"].includes(currFiling.form_type)?"high":"material",decision_impact:"monitor",
      summary:"New "+(currFiling.form_type??"SEC")+" filing disclosed"+(currFiling.filed_at?" on "+currFiling.filed_at:"")+". Review before changing the thesis.",
      source_kind:"filing",source_id:currFiling.accession_number,source_url:currFiling.filing_url??null,occurred_at:currFiling.filed_at??occurredAt,
    });
  }

  if(current.research?.version!=null&&previous.research?.version!=null&&current.research.version!==previous.research.version){
    events.push({
      company_id:companyId,current_snapshot_id:currentSnapshotId,previous_snapshot_id:previousSnapshotId,
      research_run_id:researchRunId,event_key:"research-version:"+current.research.version,category:"research",metric_key:"research_version",
      label:"Research version",old_value:previous.research.version,new_value:current.research.version,
      delta_value:current.research.version-previous.research.version,delta_percent:null,old_text:null,new_text:null,
      direction:"new",materiality:"material",decision_impact:"monitor",
      summary:"Published research advanced from v"+previous.research.version+" to v"+current.research.version+".",
      source_kind:"research",source_id:researchRunId??null,source_url:null,occurred_at:occurredAt,
    });
  }
  return events;
}
export function summarizeDecisionImpact(events=[]){
  const improving=events.filter(e=>e.decision_impact==="improving").length;
  const weakening=events.filter(e=>e.decision_impact==="weakening").length;
  const monitor=events.filter(e=>e.decision_impact==="monitor").length;
  const high=events.filter(e=>e.materiality==="high").length;
  let trend="unchanged";
  if(weakening>improving)trend="weakening";
  else if(improving>weakening)trend="improving";
  else if(monitor>0)trend="monitor";
  return{improving,weakening,monitor,high,trend,total:events.length};
}
