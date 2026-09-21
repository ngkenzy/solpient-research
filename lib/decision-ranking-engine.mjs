export const DECISION_RANKING_METHODOLOGY_VERSION = "decision-ranking-v1";
export const READINESS_METHODOLOGY_VERSION = "readiness-v1";

export const READINESS = Object.freeze({
  BUILDING: "building",
  RESEARCH_READY: "research_ready",
  DECISION_READY: "decision_ready",
});

const clamp=(value,min=0,max=100)=>Math.min(max,Math.max(min,value));
const n=(value)=>{
  if(value===null||value===undefined||value==="")return null;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
};
const round1=(value)=>value==null?null:Math.round(value*10)/10;

export function weightedScore(components={}) {
  const rows=Object.entries(components).map(([key,item])=>({
    key,
    weight:Number(item?.weight??0),
    value:n(item?.value),
    note:item?.note??null,
  }));
  const totalWeight=rows.reduce((sum,row)=>sum+Math.max(0,row.weight),0);
  const available=rows.filter((row)=>row.value!=null&&row.weight>0);
  const availableWeight=available.reduce((sum,row)=>sum+row.weight,0);
  if(!totalWeight||!availableWeight){
    return {
      score:null,
      coveragePct:0,
      missing:rows.filter((row)=>row.weight>0).map((row)=>row.key),
      contributions:[],
    };
  }
  const weighted=available.reduce((sum,row)=>sum+clamp(row.value)*row.weight,0)/availableWeight;
  return {
    score:round1(weighted),
    coveragePct:round1((availableWeight/totalWeight)*100),
    missing:rows.filter((row)=>row.weight>0&&row.value==null).map((row)=>row.key),
    contributions:available.map((row)=>({
      key:row.key,
      value:round1(clamp(row.value)),
      weight:row.weight,
      effectiveWeightPct:round1((row.weight/availableWeight)*100),
      note:row.note,
    })),
  };
}

export function businessQualityScore(scores={}) {
  return weightedScore({
    quality:{value:scores.quality_score,weight:55,note:"Legacy quantitative business-quality assessment."},
    moat:{value:scores.moat_score,weight:30,note:"Reviewed moat assessment when available."},
    financial_strength:{value:scores.financial_strength_score,weight:15,note:"Balance-sheet and financial-strength assessment."},
  });
}

export function valuationGapPct(price,baseValue){
  const p=n(price),f=n(baseValue);
  if(p==null||f==null||f===0)return null;
  return ((f-p)/f)*100;
}

export function returnScore(expectedCagr){
  const c=n(expectedCagr);
  if(c==null)return null;
  // -5% or worse => 0; 15% or better => 100. No neutral fallback for missing data.
  return clamp(((c+5)/20)*100);
}

export function valuationGapScore(price,baseValue){
  const gap=valuationGapPct(price,baseValue);
  if(gap==null)return null;
  // 50% over fair value => 0; 50% below fair value => 100.
  return clamp(50+gap);
}

export function marginOfSafetyScore(price,valuation={}){
  const p=n(price),base=n(valuation.base_value),mos25=n(valuation.mos_25_price),mos35=n(valuation.mos_35_price),bull=n(valuation.bull_value);
  if(p==null||base==null)return null;
  if(mos35!=null&&p<=mos35)return 100;
  if(mos25!=null&&p<=mos25)return 85;
  if(p<=base)return 65;
  if(bull!=null&&p<=bull)return 35;
  return 10;
}

export function downsideProtectionScore(price,bearValue){
  const p=n(price),bear=n(bearValue);
  if(p==null||bear==null||p===0)return null;
  const bearGap=((bear-p)/p)*100;
  return clamp(50+bearGap);
}

export function investmentOpportunityScore({price,valuation={},base5yCagr=null}={}) {
  return weightedScore({
    expected_return:{value:returnScore(base5yCagr),weight:35,note:"5-year base-case expected CAGR."},
    valuation_gap:{value:valuationGapScore(price,valuation.base_value),weight:30,note:"Current price versus base fair value."},
    margin_of_safety:{value:marginOfSafetyScore(price,valuation),weight:20,note:"Current price versus stored MOS thresholds."},
    downside_protection:{value:downsideProtectionScore(price,valuation.bear_value),weight:15,note:"Bear-case fair value versus current price."},
  });
}

export const EVIDENCE_WEIGHTS=Object.freeze({
  fundamentals_pct:12,
  balance_sheet_pct:7,
  history_pct:12,
  market_history_pct:5,
  valuation_history_pct:12,
  capital_allocation_pct:10,
  peer_pct:10,
  industry_pct:8,
  consensus_pct:4,
  research_structure_pct:10,
  primary_source_pct:10,
});

export function primarySourcePct(coverage={}){
  const primary=n(coverage.primary_source_quarters);
  const normalized=n(coverage.normalized_quarters);
  if(primary==null||normalized==null||normalized<=0)return null;
  return clamp((primary/normalized)*100);
}

export function researchFreshnessScore(researchedAt,now=new Date()){
  if(!researchedAt)return null;
  const researched=new Date(researchedAt);
  const current=now instanceof Date?now:new Date(now);
  if(!Number.isFinite(researched.getTime())||!Number.isFinite(current.getTime()))return null;
  const ageDays=Math.max(0,(current.getTime()-researched.getTime())/(24*60*60*1000));
  if(ageDays<=7)return 100;
  if(ageDays<=30)return 90;
  if(ageDays<=90)return 75;
  if(ageDays<=180)return 50;
  return 25;
}

export function evidenceConfidenceScore({coverage={},researchedAt=null,now=new Date()}={}) {
  const evidence=weightedScore({
    fundamentals_pct:{value:coverage.fundamentals_pct,weight:EVIDENCE_WEIGHTS.fundamentals_pct},
    balance_sheet_pct:{value:coverage.balance_sheet_pct,weight:EVIDENCE_WEIGHTS.balance_sheet_pct},
    history_pct:{value:coverage.history_pct,weight:EVIDENCE_WEIGHTS.history_pct},
    market_history_pct:{value:coverage.market_history_pct,weight:EVIDENCE_WEIGHTS.market_history_pct},
    valuation_history_pct:{value:coverage.valuation_history_pct,weight:EVIDENCE_WEIGHTS.valuation_history_pct},
    capital_allocation_pct:{value:coverage.capital_allocation_pct,weight:EVIDENCE_WEIGHTS.capital_allocation_pct},
    peer_pct:{value:coverage.peer_pct,weight:EVIDENCE_WEIGHTS.peer_pct},
    industry_pct:{value:coverage.industry_pct,weight:EVIDENCE_WEIGHTS.industry_pct},
    consensus_pct:{value:coverage.consensus_pct,weight:EVIDENCE_WEIGHTS.consensus_pct},
    research_structure_pct:{value:coverage.research_structure_pct,weight:EVIDENCE_WEIGHTS.research_structure_pct},
    primary_source_pct:{value:primarySourcePct(coverage),weight:EVIDENCE_WEIGHTS.primary_source_pct},
  });
  const freshness=researchFreshnessScore(researchedAt,now);
  if(evidence.score==null&&freshness==null){
    return {...evidence,score:null,evidenceScore:null,freshnessScore:null};
  }
  // Missing evidence lowers coverage; freshness cannot rescue absent evidence.
  const score=evidence.score==null
    ? null
    : freshness==null
      ? evidence.score
      : round1((evidence.score*0.90)+(freshness*0.10));
  return {
    ...evidence,
    score,
    evidenceScore:evidence.score,
    freshnessScore:round1(freshness),
  };
}

function atLeast(value,threshold){
  const x=n(value);
  return x!=null&&x>=threshold;
}
function has(value){return n(value)!=null;}

export function readinessState({
  quality,
  opportunity,
  evidence,
  coverage={},
  price=null,
  valuation={},
  base5yCagr=null,
}={}) {
  const blockers=[];
  const warnings=[];

  if(quality?.score==null)blockers.push("Business Quality is unavailable.");
  if((quality?.coveragePct??0)<55)blockers.push("Business Quality component coverage is below 55%.");
  if(opportunity?.score==null)blockers.push("Investment Opportunity is unavailable.");
  if((opportunity?.coveragePct??0)<60)blockers.push("Investment Opportunity component coverage is below 60%.");
  if(evidence?.score==null)blockers.push("Evidence Confidence is unavailable.");
  if(!has(price))blockers.push("Current market price is unavailable.");
  if(!has(valuation?.base_value))blockers.push("Base fair value is unavailable.");

  const researchReady=
    blockers.length===0 &&
    atLeast(evidence?.score,55) &&
    atLeast(coverage.research_structure_pct,80) &&
    atLeast(coverage.fundamentals_pct,70) &&
    atLeast(coverage.history_pct,60);

  if(!researchReady){
    if(evidence?.score!=null&&evidence.score<55)warnings.push("Evidence Confidence is below the Research Ready threshold.");
    return {
      state:READINESS.BUILDING,
      tier:0,
      blockers,
      warnings,
      decisionReadyBlockers:[],
    };
  }

  const decisionBlockers=[];
  if(!atLeast(evidence?.score,85))decisionBlockers.push("Evidence Confidence is below 85%.");
  if((quality?.coveragePct??0)<70)decisionBlockers.push("Business Quality component coverage is below 70%.");
  if((opportunity?.coveragePct??0)<80)decisionBlockers.push("Investment Opportunity component coverage is below 80%.");
  if(!atLeast(coverage.research_structure_pct,90))decisionBlockers.push("Research structure coverage is below 90%.");
  if(!atLeast(coverage.fundamentals_pct,85))decisionBlockers.push("Fundamentals coverage is below 85%.");
  if(!atLeast(coverage.history_pct,80))decisionBlockers.push("Financial history coverage is below 80%.");
  if(!atLeast(coverage.valuation_history_pct,60))decisionBlockers.push("Valuation history coverage is below 60%.");
  if(!atLeast(coverage.capital_allocation_pct,50))decisionBlockers.push("Capital-allocation history coverage is below 50%.");
  if(!atLeast(coverage.peer_pct,50))decisionBlockers.push("Peer coverage is below 50%.");
  if(!has(base5yCagr))decisionBlockers.push("5-year base expected return is unavailable.");

  if(decisionBlockers.length===0){
    return {
      state:READINESS.DECISION_READY,
      tier:2,
      blockers:[],
      warnings,
      decisionReadyBlockers:[],
    };
  }
  return {
    state:READINESS.RESEARCH_READY,
    tier:1,
    blockers:[],
    warnings,
    decisionReadyBlockers:decisionBlockers,
  };
}

export function decisionScore({quality,opportunity}={}){
  if(quality?.score==null||opportunity?.score==null)return null;
  return round1((quality.score*0.40)+(opportunity.score*0.60));
}

export function buildDecisionRanking(input={}) {
  const quality=businessQualityScore(input.scores??{});
  const opportunity=investmentOpportunityScore({
    price:input.price,
    valuation:input.valuation??{},
    base5yCagr:input.base5yCagr,
  });
  const evidence=evidenceConfidenceScore({
    coverage:input.coverage??{},
    researchedAt:input.researchedAt,
    now:input.now??new Date(),
  });
  const readiness=readinessState({
    quality,opportunity,evidence,
    coverage:input.coverage??{},
    price:input.price,
    valuation:input.valuation??{},
    base5yCagr:input.base5yCagr,
  });
  const score=decisionScore({quality,opportunity});
  return {
    methodologyVersion:DECISION_RANKING_METHODOLOGY_VERSION,
    readinessMethodologyVersion:READINESS_METHODOLOGY_VERSION,
    businessQuality:quality,
    investmentOpportunity:opportunity,
    evidenceConfidence:evidence,
    decisionScore:score,
    readiness,
    inputs:{
      price:n(input.price),
      base5yCagr:n(input.base5yCagr),
      baseValue:n(input.valuation?.base_value),
      bearValue:n(input.valuation?.bear_value),
      bullValue:n(input.valuation?.bull_value),
      mos25Price:n(input.valuation?.mos_25_price),
      mos35Price:n(input.valuation?.mos_35_price),
      legacyOverallScore:n(input.scores?.overall_score),
      coverageEngineVersion:input.coverage?.engine_version??null,
      coverageAsOfDate:input.coverage?.as_of_date??null,
      provenanceConfidence:null,
    },
  };
}

export function sortDecisionRankings(a,b){
  const tier=(b?.decision?.readiness?.tier??-1)-(a?.decision?.readiness?.tier??-1);
  if(tier!==0)return tier;
  const score=(b?.decision?.decisionScore??-1)-(a?.decision?.decisionScore??-1);
  if(score!==0)return score;
  const confidence=(b?.decision?.evidenceConfidence?.score??-1)-(a?.decision?.evidenceConfidence?.score??-1);
  if(confidence!==0)return confidence;
  const quality=(b?.decision?.businessQuality?.score??-1)-(a?.decision?.businessQuality?.score??-1);
  if(quality!==0)return quality;
  return String(a?.ticker??"").localeCompare(String(b?.ticker??""));
}

export function readinessLabel(state){
  if(state===READINESS.DECISION_READY)return "Decision Ready";
  if(state===READINESS.RESEARCH_READY)return "Research Ready";
  return "Building";
}

export function scoreBand(value,type="generic"){
  const v=n(value);
  if(v==null)return "Unavailable";
  if(type==="evidence"){
    if(v>=85)return "High";
    if(v>=65)return "Moderate";
    if(v>=45)return "Developing";
    return "Low";
  }
  if(v>=85)return type==="opportunity"?"Exceptional":"Excellent";
  if(v>=70)return type==="opportunity"?"Attractive":"Strong";
  if(v>=55)return type==="opportunity"?"Watch":"Mixed";
  return type==="opportunity"?"Unattractive":"Weak";
}
