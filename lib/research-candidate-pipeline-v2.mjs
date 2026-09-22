import {
  SCREEN_STATE,
  stateLabel as screeningStateLabel,
} from "./universe-screening-engine-v2.mjs";
import {
  INDUSTRY_VALUATION_PROFILES,
  VALUATION_ENGINE_VERSION,
  VALUATION_METHODOLOGY_VERSION,
  valueCompanyV3,
} from "./valuation-engine-v3.mjs";
import {
  READINESS,
  buildDecisionRanking,
  readinessLabel,
} from "./decision-ranking-engine.mjs";

export const RESEARCH_CANDIDATE_PIPELINE_VERSION="research-candidate-pipeline-v2";

const n=(v)=>{
  if(v===null||v===undefined||v==="")return null;
  const x=Number(v);
  return Number.isFinite(x)?x:null;
};

export const SCREEN_TO_VALUATION_PROFILE=Object.freeze({
  general:"generic",
  software:"software_platform",
  technology:"generic",
  communication:"generic",
  consumer_discretionary:"consumer_brand",
  consumer_staples:"consumer_brand",
  industrial:"industrial_manufacturing",
  healthcare:"healthcare_medtech",
  biopharma:"biopharma",
  bank:"financial_bank",
  insurance:null,
  asset_manager:null,
  financial_other:null,
  reit:null,
  real_estate:null,
  utility:"generic",
  cyclical:"generic",
});

export function valuationProfileForScreen(screenResult={}){
  const profile=String(screenResult.profile??screenResult.screen_profile??"general");
  return Object.prototype.hasOwnProperty.call(SCREEN_TO_VALUATION_PROFILE,profile)
    ? SCREEN_TO_VALUATION_PROFILE[profile]
    : "generic";
}

function has(v){return n(v)!=null;}
function text(v){return String(v??"").trim();}

export function valuationPreflight(screenResult={},input={}){
  const mappedProfile=valuationProfileForScreen(screenResult);
  const industryModule=input.industryModule??mappedProfile;
  if(!industryModule){
    return{
      industryModule:null,
      profile:null,
      complete:false,
      missing:["reviewed industry-specific Valuation V3 profile"],
      blockedReason:"Sector Model V2 does not permit generic corporate FCF valuation for this financial/real-estate profile.",
    };
  }
  const profile=INDUSTRY_VALUATION_PROFILES[industryModule]??INDUSTRY_VALUATION_PROFILES.generic;
  const missing=[];

  if(!has(input.currentPrice))missing.push("currentPrice");

  if(profile.methods.includes("fcf_dcf")){
    if(!has(input.fcfPerShare))missing.push("fcfPerShare");
    for(const scenario of ["bear","base","bull"]){
      for(const key of ["initialGrowth","matureGrowth","discountRate","terminalGrowth"]){
        if(!has(input?.assumptions?.[scenario]?.[key]))missing.push("assumptions."+scenario+"."+key);
      }
    }
  }

  if(profile.methods.includes("normalized_eps_multiple")){
    if(!has(input.normalizedEpsPerShare??input.epsPerShare))missing.push("normalizedEpsPerShare");
    for(const scenario of ["bear","base","bull"]){
      if(!has(input?.multiples?.normalizedEps?.[scenario]??input?.multiples?.normalizedEps?.base)){
        missing.push("multiples.normalizedEps."+scenario);
      }
    }
  }

  if(profile.methods.includes("book_value_multiple")){
    if(!has(input.tangibleBookValuePerShare??input.bookValuePerShare))missing.push("tangibleBookValuePerShare");
    for(const scenario of ["bear","base","bull"]){
      if(!has(input?.multiples?.book?.[scenario]??input?.multiples?.book?.base)){
        missing.push("multiples.book."+scenario);
      }
    }
  }

  if(profile.methods.includes("historical_multiple")){
    const metric=profile.perShareMetric;
    const metricValue=metric==="normalized_eps"
      ? input.normalizedEpsPerShare
      : metric==="tangible_book_value_per_share"
        ? input.tangibleBookValuePerShare
        : input.fcfPerShare;
    if(!has(metricValue))missing.push(metric);
    for(const scenario of ["bear","base","bull"]){
      if(!has(input?.multiples?.historical?.[scenario]??input?.multiples?.historical?.base)){
        missing.push("multiples.historical."+scenario);
      }
    }
  }

  if(profile.methods.includes("peer_multiple")){
    for(const scenario of ["bear","base","bull"]){
      if(!has(input?.multiples?.peer?.[scenario]??input?.multiples?.peer?.base)){
        missing.push("multiples.peer."+scenario);
      }
    }
  }

  return {
    industryModule,
    profile,
    complete:missing.length===0,
    missing:[...new Set(missing)].sort(),
  };
}

function base5yCagrFromValuation(v3={}){
  const row=(v3.expected_return_scenarios??[]).find(
    x=>x.scenario==="base"&&Number(x.horizon_years)===5&&x.status==="applied"
  );
  return n(row?.expected_cagr);
}

function readinessValuation(v3={}){
  return {
    bear_value:n(v3?.scenarios?.bear?.summary?.central_value),
    base_value:n(v3?.base_fair_value),
    bull_value:n(v3?.scenarios?.bull?.summary?.central_value),
    mos_25_price:n(v3?.margin_of_safety?.mos_25_price),
    mos_35_price:n(v3?.margin_of_safety?.mos_35_price),
  };
}

function screenIsEligible(screenResult={}){
  if(screenResult.proposedForDeepResearch===true||screenResult.proposed_for_deep_research===true)return true;
  return [
    SCREEN_STATE.RESEARCH_CANDIDATE,
    SCREEN_STATE.SOLPIENT_100_CANDIDATE,
    SCREEN_STATE.SOLPIENT_100,
  ].includes(screenResult.state??screenResult.screen_state);
}

function nextActions({eligible,companyExists,preflight,valuation,decision}){
  const actions=[];
  if(!eligible){
    return [{
      priority:100,
      type:"screening",
      action:"Do not enter deep-research pipeline.",
      reason:"The company is not currently an eligible research candidate.",
    }];
  }
  if(companyExists===false){
    actions.push({
      priority:100,
      type:"onboarding",
      action:"Create canonical company identity and begin evidence ingestion.",
      reason:"The shortlisted ticker is not yet onboarded into the Solpient company universe.",
    });
  }

  if(!preflight.complete){
    actions.push({
      priority:95,
      type:"valuation_inputs",
      action:"Collect explicit Valuation V3 inputs.",
      reason:preflight.blockedReason??"Valuation V3 does not impute missing assumptions or relative-valuation anchors.",
      missing:preflight.missing,
    });
  }else if(valuation.base_fair_value==null){
    actions.push({
      priority:92,
      type:"valuation_review",
      action:"Review Valuation V3 output and unavailable anchors.",
      reason:"Explicit inputs were supplied but no base fair value was produced.",
    });
  }

  const r=decision?.readiness;
  if(!decision?.businessQuality?.score){
    actions.push({
      priority:90,
      type:"research_scores",
      action:"Complete reviewed Business Quality / moat / financial-strength research.",
      reason:"Universe screening scores are never substituted for reviewed Decision Ranking scores.",
      missing:decision?.businessQuality?.missing??[],
    });
  }
  if((decision?.businessQuality?.coveragePct??0)<55){
    actions.push({
      priority:88,
      type:"research_scores",
      action:"Raise Business Quality component coverage to at least 55%.",
      reason:"Research Ready requires sufficient reviewed quality-component coverage.",
      current:decision?.businessQuality?.coveragePct??0,
    });
  }
  if((decision?.investmentOpportunity?.coveragePct??0)<60){
    actions.push({
      priority:86,
      type:"opportunity",
      action:"Raise Investment Opportunity component coverage to at least 60%.",
      reason:"Research Ready requires valuation/return/downside evidence, not screening valuation alone.",
      current:decision?.investmentOpportunity?.coveragePct??0,
    });
  }

  for(const blocker of r?.blockers??[]){
    actions.push({
      priority:80,
      type:"readiness",
      action:"Clear Research Ready blocker.",
      reason:blocker,
    });
  }
  for(const blocker of r?.decisionReadyBlockers??[]){
    actions.push({
      priority:60,
      type:"decision_readiness",
      action:"Clear Decision Ready blocker.",
      reason:blocker,
    });
  }

  if(r?.state===READINESS.DECISION_READY){
    actions.push({
      priority:10,
      type:"complete",
      action:"Eligible for portfolio-level comparison.",
      reason:"The company satisfies current Decision Ready gates.",
    });
  }else if(r?.state===READINESS.RESEARCH_READY){
    actions.push({
      priority:20,
      type:"complete_research",
      action:"Continue evidence repair toward Decision Ready.",
      reason:"Core research is usable, but decision-grade evidence gates remain.",
    });
  }

  const key=a=>[
    a.type,
    a.action,
    a.reason,
    JSON.stringify(a.missing??[]),
  ].join("|");
  const seen=new Set();
  return actions
    .sort((a,b)=>b.priority-a.priority||a.type.localeCompare(b.type))
    .filter(a=>{
      const k=key(a);
      if(seen.has(k))return false;
      seen.add(k);return true;
    });
}

export function buildResearchCandidatePipeline({
  screenResult={},
  companyExists=null,
  valuationInput={},
  researchInput={},
  now=new Date(),
}={}){
  const eligible=screenIsEligible(screenResult);
  const preflight=valuationPreflight(screenResult,valuationInput);

  const valuationInputWithProfile={
    ...valuationInput,
    industryModule:preflight.industryModule,
  };
  const valuation=eligible&&preflight.complete?valueCompanyV3(valuationInputWithProfile):null;
  const base5yCagr=valuation?base5yCagrFromValuation(valuation):null;
  const mappedValuation=valuation?readinessValuation(valuation):{};

  const rankingInput={
    scores:researchInput.scores??{},
    coverage:researchInput.coverage??{},
    researchedAt:researchInput.researchedAt??null,
    now,
    price:n(valuation?.current_price??valuationInput.currentPrice??researchInput.price),
    valuation:mappedValuation,
    base5yCagr,
  };
  const decision=eligible?buildDecisionRanking(rankingInput):null;
  const readinessState=decision?.readiness?.state??READINESS.BUILDING;

  const stage=!eligible
    ?"not_selected"
    :companyExists===false
      ?"onboarding"
      :readinessState===READINESS.DECISION_READY
        ?"decision_ready"
        :readinessState===READINESS.RESEARCH_READY
          ?"research_ready"
          :valuation?.base_fair_value!=null
            ?"research_building"
            :"valuation_building";

  const actions=nextActions({
    eligible,companyExists,preflight,valuation:valuation??{},decision,
  });

  return {
    pipelineVersion:RESEARCH_CANDIDATE_PIPELINE_VERSION,
    ticker:text(screenResult.ticker),
    companyName:screenResult.companyName??screenResult.company_name??null,
    screening:{
      methodologyVersion:screenResult.methodologyVersion??screenResult.methodology_version??null,
      state:screenResult.state??screenResult.screen_state??null,
      stateLabel:screeningStateLabel(screenResult.state??screenResult.screen_state),
      screenScore:n(screenResult.screenScore??screenResult.screen_score),
      qualityCoreScore:n(screenResult.qualityCoreScore??screenResult.quality_core_score),
      evidenceCoveragePct:n(screenResult.evidenceCoveragePct??screenResult.evidence_coverage_pct),
      proposedForDeepResearch:Boolean(screenResult.proposedForDeepResearch??screenResult.proposed_for_deep_research),
      eligible,
    },
    valuation:{
      engineVersion:VALUATION_ENGINE_VERSION,
      methodologyVersion:VALUATION_METHODOLOGY_VERSION,
      preflight,
      result:valuation,
      base5yCagr,
    },
    readiness:{
      methodologyVersion:decision?.readinessMethodologyVersion??null,
      state:readinessState,
      label:readinessLabel(readinessState),
      decision,
    },
    stage,
    nextActions:actions,
    safeguards:[
      "Universe screening score is not reused as Business Quality, Decision Score, or Evidence Confidence.",
      "Valuation V3 runs only from explicit inputs; missing assumptions remain missing.",
      "Readiness V1 uses reviewed research scores and coverage, not broad-screening proxies.",
    ],
  };
}
