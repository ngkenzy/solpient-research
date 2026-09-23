import {
  READINESS,
  evidenceConfidenceScore,
  readinessState,
} from "./decision-ranking-engine.mjs";

export const READINESS_REPAIR_METHODOLOGY_VERSION="readiness-repair-v1";

const n=(v)=>{
  if(v===null||v===undefined||v==="")return null;
  const x=Number(v);
  return Number.isFinite(x)?x:null;
};
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,v));
const round1=(v)=>v==null?null:Math.round(v*10)/10;

export const TARGETS=Object.freeze({
  research_ready:{
    evidence_confidence:60,
    business_quality_coverage:55,
    opportunity_coverage:60,
    research_structure_pct:80,
    fundamentals_pct:70,
    history_pct:60,
  },
  decision_ready:{
    evidence_confidence:85,
    business_quality_coverage:70,
    opportunity_coverage:80,
    research_structure_pct:90,
    fundamentals_pct:85,
    history_pct:80,
    valuation_history_pct:60,
    capital_allocation_pct:50,
    peer_pct:50,
  },
});

const REPAIR_META=Object.freeze({
  fundamentals_pct:{layer:"fundamentals",field:"coverage",repair_type:"fundamentals_refresh",automation_mode:"auto",runner:"fundamentals",effort:1},
  history_pct:{layer:"history",field:"complete_fiscal_years",repair_type:"fundamentals_refresh",automation_mode:"auto",runner:"fundamentals",effort:1},
  balance_sheet_pct:{layer:"balance_sheet",field:"coverage",repair_type:"fundamentals_refresh",automation_mode:"auto",runner:"fundamentals",effort:1},
  market_history_pct:{layer:"market_history",field:"trading_days",repair_type:"market_history_refresh",automation_mode:"auto",runner:"market_context",effort:1},
  valuation_history_pct:{layer:"valuation_history",field:"monthly_valuation_history",repair_type:"valuation_history_refresh",automation_mode:"auto",runner:"market_context",effort:1},
  capital_allocation_pct:{layer:"capital_allocation",field:"complete_fiscal_years",repair_type:"capital_allocation_backfill",automation_mode:"manual",runner:null,effort:4},
  peer_pct:{layer:"peers",field:"peer_data_coverage",repair_type:"peer_context_refresh",automation_mode:"auto",runner:"peer_context",effort:1},
  industry_pct:{layer:"industry",field:"industry_module_coverage",repair_type:"industry_evidence_review",automation_mode:"manual",runner:null,effort:3},
  consensus_pct:{layer:"consensus",field:"point_in_time_snapshots",repair_type:"consensus_accumulation",automation_mode:"scheduled",runner:"consensus",effort:2},
  research_structure_pct:{layer:"research",field:"published_v2_research",repair_type:"research_review",automation_mode:"manual",runner:null,effort:4},
  primary_source_pct:{layer:"primary_source",field:"primary_source_quarters",repair_type:"primary_source_backfill",automation_mode:"monitor",runner:null,effort:3,phase2_sensitive:true},
});

const COVERAGE_KEYS=[
  "fundamentals_pct","balance_sheet_pct","history_pct","market_history_pct",
  "valuation_history_pct","capital_allocation_pct","peer_pct","industry_pct",
  "consensus_pct","research_structure_pct",
];

function cloneCoverage(coverage={}){
  const out={...coverage};
  for(const key of COVERAGE_KEYS) out[key]=n(coverage[key]);
  return out;
}

function currentPrimaryPct(coverage={}){
  const p=n(coverage.primary_source_quarters),q=n(coverage.normalized_quarters);
  if(p==null||q==null||q<=0)return null;
  return clamp(p/q*100);
}

function readinessInput(input,coverage,qualityCoverage=input.businessQualityCoverage,opportunityCoverage=input.opportunityCoverage){
  const evidence=evidenceConfidenceScore({
    coverage,
    researchedAt:input.researchedAt,
    now:input.now??new Date(),
  });
  const quality={score:n(input.businessQualityScore),coveragePct:n(qualityCoverage)??0};
  const opportunity={score:n(input.investmentOpportunityScore),coveragePct:n(opportunityCoverage)??0};
  const readiness=readinessState({
    quality,opportunity,evidence,coverage,
    price:input.price,
    valuation:{base_value:input.baseValue},
    base5yCagr:input.base5yCagr,
  });
  return {evidence,readiness,quality,opportunity};
}

function instructionFor(key,target,input={}){
  const details=input.coverageDetails??{};
  if(key==="history_pct"){
    const years=Math.ceil(target/20);
    return `Verify at least ${years} complete fiscal years of normalized fundamentals.`;
  }
  if(key==="valuation_history_pct"){
    if(target>45){
      const years=Math.max(0,((target-45)/55)*5);
      return `Extend point-in-time valuation history to at least ${Math.round(target*10)/10}% coverage; with 60+ valuation observations, that requires roughly ${Math.ceil(years*10)/10} years of time span.`;
    }
    const observations=Math.ceil((target/45)*60);
    return `Raise point-in-time valuation history to at least ${Math.round(target*10)/10}% coverage, equivalent to roughly ${observations} observations if time-span contribution is zero.`;
  }
  if(key==="capital_allocation_pct"){
    const years=Math.ceil(target/20);
    return `Verify at least ${years} complete fiscal years for dividends, buybacks, stock-based compensation, acquisitions, debt issued, and debt repaid.`;
  }
  if(key==="peer_pct"){
    const configured=Math.max(Number(details.configured_peer_target??4),1);
    const count=Math.ceil(configured*target/100);
    return `Populate decision-grade local peer metrics for at least ${count} of ${configured} configured peers.`;
  }
  if(key==="consensus_pct"){
    const snapshots=Math.ceil(target/20);
    return `Accumulate at least ${snapshots} point-in-time consensus snapshots without backfilling future knowledge.`;
  }
  if(key==="industry_pct")return `Raise reviewed industry-module evidence coverage to at least ${target}%.`;
  if(key==="research_structure_pct")return `Complete reviewed Research Standard V2 structure to at least ${target}% without auto-publishing.`;
  if(key==="fundamentals_pct")return `Raise required normalized fundamental-field coverage to at least ${target}% from verified sources.`;
  if(key==="balance_sheet_pct")return `Raise balance-sheet evidence coverage to at least ${target}%.`;
  if(key==="market_history_pct")return `Raise market-history coverage to at least ${target}%.`;
  if(key==="primary_source_pct")return `Raise primary-source quarter coverage to at least ${target}%; defer provenance-specific execution until Phase 2 finishes.`;
  return `Raise ${key.replaceAll("_"," ")} to at least ${target}%.`;
}

function coverageAction(key,current,target,targetState,input,direct=true){
  const meta=REPAIR_META[key];
  return {
    key:`${key}:${target}`,
    kind:"coverage",
    coverageKey:key,
    layer:meta.layer,
    field:meta.field,
    repairType:meta.repair_type,
    automationMode:meta.automation_mode,
    runner:meta.runner,
    phase2Sensitive:Boolean(meta.phase2_sensitive),
    currentValue:round1(current),
    targetValue:round1(target),
    targetState,
    directGate:direct,
    effort:meta.effort,
    instruction:instructionFor(key,target,input),
  };
}

function specialAction(kind,current,target,targetState,instruction,opts={}){
  return {
    key:`${kind}:${targetState}`,
    kind,
    layer:opts.layer??"research",
    field:opts.field??kind,
    repairType:opts.repairType??"research_review",
    automationMode:opts.automationMode??"manual",
    runner:opts.runner??null,
    phase2Sensitive:false,
    currentValue:current,
    targetValue:target,
    targetState,
    directGate:true,
    effort:opts.effort??4,
    instruction,
  };
}

function directActions(input,targetState){
  const t=TARGETS[targetState];
  const coverage=cloneCoverage(input.coverage);
  const actions=[];
  for(const key of ["research_structure_pct","fundamentals_pct","history_pct"]){
    const current=n(coverage[key])??0;
    if(current<t[key])actions.push(coverageAction(key,current,t[key],targetState,input,true));
  }
  if(targetState==="decision_ready"){
    for(const key of ["valuation_history_pct","capital_allocation_pct","peer_pct"]){
      const current=n(coverage[key])??0;
      if(current<t[key])actions.push(coverageAction(key,current,t[key],targetState,input,true));
    }
  }
  const q=n(input.businessQualityCoverage)??0;
  if(q<t.business_quality_coverage)actions.push(specialAction(
    "business_quality_coverage",q,t.business_quality_coverage,targetState,
    `Complete reviewed business-quality components until component coverage is at least ${t.business_quality_coverage}%; missing: ${(input.businessQualityMissing??[]).join(", ")||"reviewed quality component"}.`,
    {field:"business_quality_components",repairType:"business_quality_review"}
  ));
  const o=n(input.opportunityCoverage)??0;
  if(o<t.opportunity_coverage)actions.push(specialAction(
    "opportunity_coverage",o,t.opportunity_coverage,targetState,
    `Complete investment-opportunity components until component coverage is at least ${t.opportunity_coverage}%; missing: ${(input.opportunityMissing??[]).join(", ")||"valuation/return component"}.`,
    {layer:"valuation",field:"opportunity_components",repairType:"valuation_review"}
  ));
  if(n(input.price)==null)actions.push(specialAction(
    "price",null,"available",targetState,"Refresh a current market price.",
    {layer:"market_history",field:"current_price",repairType:"market_history_refresh",automationMode:"auto",runner:"market_context",effort:1}
  ));
  if(n(input.baseValue)==null)actions.push(specialAction(
    "base_value",null,"available",targetState,"Produce and review a base fair value.",
    {layer:"valuation",field:"base_fair_value",repairType:"valuation_review"}
  ));
  if(targetState==="decision_ready"&&n(input.base5yCagr)==null)actions.push(specialAction(
    "base_5y_cagr",null,"available",targetState,"Persist a reviewed 5-year base-case expected return scenario.",
    {layer:"valuation",field:"base_5y_expected_return",repairType:"valuation_review"}
  ));
  return actions;
}

function applyAction(state,action){
  const next={...state,coverage:{...state.coverage}};
  if(action.kind==="coverage"){
    next.coverage[action.coverageKey]=Math.max(n(next.coverage[action.coverageKey])??0,n(action.targetValue)??0);
    if(action.coverageKey==="primary_source_pct"){
      const quarters=n(next.coverage.normalized_quarters)??0;
      next.coverage.primary_source_quarters=quarters*(n(action.targetValue)??0)/100;
    }
  }else if(action.kind==="business_quality_coverage"){
    next.businessQualityCoverage=n(action.targetValue);
  }else if(action.kind==="opportunity_coverage"){
    next.opportunityCoverage=n(action.targetValue);
  }else if(action.kind==="price"){
    next.price=next.price??1;
  }else if(action.kind==="base_value"){
    next.baseValue=next.baseValue??1;
  }else if(action.kind==="base_5y_cagr"){
    next.base5yCagr=next.base5yCagr??0;
  }
  return next;
}

function stateSnapshot(input){
  return {
    ...input,
    coverage:cloneCoverage(input.coverage),
    businessQualityCoverage:n(input.businessQualityCoverage)??0,
    opportunityCoverage:n(input.opportunityCoverage)??0,
  };
}

function targetReached(state,targetState){
  const result=readinessInput(state,state.coverage,state.businessQualityCoverage,state.opportunityCoverage);
  return targetState==="research_ready"
    ? result.readiness.tier>=1
    : result.readiness.tier>=2;
}

function boosterStep(key,state){
  if(key==="peer_pct"){
    const configured=Math.max(Number(state.coverageDetails?.configured_peer_target??4),1);
    return 100/configured;
  }
  if(["history_pct","capital_allocation_pct","consensus_pct"].includes(key))return 20;
  if(key==="primary_source_pct"){
    const q=Math.max(Number(state.coverage.normalized_quarters??0),1);
    return 100/q;
  }
  return 0.1;
}

function minimalBoosterTarget(state,key,maxTarget,targetState){
  const targetEvidence=TARGETS[targetState].evidence_confidence;
  const current=key==="primary_source_pct"?currentPrimaryPct(state.coverage):(n(state.coverage[key])??0);
  if(current==null||current>=maxTarget)return current;
  const step=boosterStep(key,state);
  let target=Math.min(maxTarget,Math.ceil((current+0.0001)/step)*step);
  while(target<=maxTarget+0.0001){
    const action=coverageAction(key,current,Math.min(target,maxTarget),targetState,state,false);
    const next=applyAction(state,action);
    const score=readinessInput(next,next.coverage,next.businessQualityCoverage,next.opportunityCoverage).evidence.score??0;
    if(score>=targetEvidence)return round1(Math.min(target,maxTarget));
    target+=step;
  }
  return maxTarget;
}

function boosterActions(state,targetState){
  const candidates=[];
  const targetEvidence=TARGETS[targetState].evidence_confidence;
  const evidence=readinessInput(state,state.coverage,state.businessQualityCoverage,state.opportunityCoverage).evidence.score??0;
  if(evidence>=targetEvidence)return candidates;

  const preferred=[
    ["valuation_history_pct",100],
    ["peer_pct",100],
    ["fundamentals_pct",100],
    ["history_pct",100],
    ["capital_allocation_pct",100],
    ["industry_pct",80],
    ["balance_sheet_pct",100],
    ["market_history_pct",100],
    ["consensus_pct",100],
    ["primary_source_pct",100],
  ];
  for(const [key,maxTarget] of preferred){
    const current=key==="primary_source_pct"?currentPrimaryPct(state.coverage):(n(state.coverage[key])??0);
    if(current==null||current>=maxTarget)continue;
    const target=minimalBoosterTarget(state,key,maxTarget,targetState);
    if(target==null||target<=current)continue;
    candidates.push(coverageAction(key,current,target,targetState,state,false));
  }
  return candidates;
}

function evaluateAction(state,action,targetState){
  const before=readinessInput(state,state.coverage,state.businessQualityCoverage,state.opportunityCoverage);
  const next=applyAction(state,action);
  const after=readinessInput(next,next.coverage,next.businessQualityCoverage,next.opportunityCoverage);
  const evidenceGain=(after.evidence.score??0)-(before.evidence.score??0);
  const tierGain=(after.readiness.tier??0)-(before.readiness.tier??0);
  const directBonus=action.directGate?22:0;
  const autoBonus=action.automationMode==="auto"?10:action.automationMode==="scheduled"?4:0;
  const phase2Penalty=action.phase2Sensitive?30:0;
  const value=tierGain*50+directBonus+evidenceGain*3+autoBonus-phase2Penalty;
  return {
    action:{
      ...action,
      estimatedEvidenceGain:round1(evidenceGain),
      projectedEvidenceConfidence:round1(after.evidence.score),
      projectedReadinessState:after.readiness.state,
      efficiency:round1(value/Math.max(action.effort,1)),
    },
    next,
  };
}

export function planToState(input,targetState){
  let state=stateSnapshot(input);
  const selected=[];
  const seen=new Set();

  const direct=directActions(state,targetState);
  for(const action of direct){
    const evaluated=evaluateAction(state,action,targetState);
    state=evaluated.next;
    selected.push(evaluated.action);
    seen.add(action.key);
  }

  let guard=0;
  while(!targetReached(state,targetState)&&guard++<20){
    const candidates=boosterActions(state,targetState)
      .filter(a=>!seen.has(a.key))
      .map(a=>evaluateAction(state,a,targetState))
      .sort((a,b)=>(b.action.efficiency??-999)-(a.action.efficiency??-999)||a.action.key.localeCompare(b.action.key));
    if(!candidates.length)break;
    const best=candidates[0];
    state=best.next;
    selected.push(best.action);
    seen.add(best.action.key);
  }

  const final=readinessInput(state,state.coverage,state.businessQualityCoverage,state.opportunityCoverage);
  return {
    targetState,
    reachable:targetReached(state,targetState),
    repairCount:selected.length,
    estimatedFinalEvidenceConfidence:round1(final.evidence.score),
    estimatedFinalState:final.readiness.state,
    blockers:final.readiness.blockers,
    decisionReadyBlockers:final.readiness.decisionReadyBlockers,
    actions:selected.map((a,index)=>({...a,sequence:index+1})),
  };
}

function companyPriority(input,nextPlan){
  if(input.currentState==="decision_ready")return 0;
  const urgency=input.currentState==="building"?35:20;
  const decision=Math.max(0,Math.min(25,(n(input.decisionScore)??0)*.25));
  const confidenceGap=Math.max(0,(input.currentState==="building"?60:85)-(n(input.evidenceConfidence)??0));
  const confidence=Math.min(20,confidenceGap);
  const quick=nextPlan.reachable?Math.max(0,15-nextPlan.repairCount*2):0;
  const auto=nextPlan.actions.some(a=>a.automationMode==="auto")?5:0;
  return Math.round(clamp(urgency+decision+confidence+quick+auto));
}

export function buildDecisionReadinessRepairPlan(input){
  const researchPlan=planToState(input,"research_ready");
  const decisionPlan=planToState(input,"decision_ready");
  const nextState=input.currentState==="building"?"research_ready":input.currentState==="research_ready"?"decision_ready":"decision_ready";
  const nextPlan=nextState==="research_ready"?researchPlan:decisionPlan;
  const priority=companyPriority(input,nextPlan);

  const itemMap=new Map();
  for(const [scope,plan] of [["next",nextPlan],["decision",decisionPlan]]){
    for(const action of plan.actions){
      const key=action.key;
      const existing=itemMap.get(key);
      itemMap.set(key,{
        ...action,
        scope:existing?.scope==="next"?"next":scope,
        sequenceToNext:scope==="next"?action.sequence:(existing?.sequenceToNext??null),
        sequenceToDecision:scope==="decision"?action.sequence:(existing?.sequenceToDecision??null),
      });
    }
  }
  const items=[...itemMap.values()].map(item=>{
    const direct=item.directGate?15:0;
    const sequenceBonus=item.sequenceToNext!=null?Math.max(0,16-item.sequenceToNext*2):0;
    const autoBonus=item.automationMode==="auto"?8:item.automationMode==="scheduled"?3:0;
    const gain=Math.max(0,n(item.estimatedEvidenceGain)??0)*2;
    const phase2Penalty=item.phase2Sensitive?25:0;
    return {...item,priority:Math.round(clamp(priority*.55+direct+sequenceBonus+autoBonus+gain-phase2Penalty))};
  }).sort((a,b)=>b.priority-a.priority||(a.sequenceToNext??99)-(b.sequenceToNext??99)||a.key.localeCompare(b.key));

  return {
    methodologyVersion:READINESS_REPAIR_METHODOLOGY_VERSION,
    currentState:input.currentState,
    nextState,
    companyPriority:priority,
    currentEvidenceConfidence:round1(input.evidenceConfidence),
    decisionScore:round1(input.decisionScore),
    researchReadyPlan:researchPlan,
    decisionReadyPlan:decisionPlan,
    items,
  };
}
