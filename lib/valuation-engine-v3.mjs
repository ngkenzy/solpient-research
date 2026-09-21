export const VALUATION_ENGINE_VERSION="valuation-v3-core";
export const VALUATION_METHODOLOGY_VERSION="solpient-valuation-methodology-v3";

const n=(v)=>{
  if(v===null||v===undefined||v==="")return null;
  const x=Number(v);
  return Number.isFinite(x)?x:null;
};
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,v));
const round=(v,d=2)=>v==null?null:Math.round(v*10**d)/10**d;
const median=(values)=>{
  const xs=(values??[]).map(n).filter(v=>v!=null).sort((a,b)=>a-b);
  if(!xs.length)return null;
  const m=Math.floor(xs.length/2);
  return xs.length%2?xs[m]:(xs[m-1]+xs[m])/2;
};
const quantile=(values,q)=>{
  const xs=(values??[]).map(n).filter(v=>v!=null).sort((a,b)=>a-b);
  if(!xs.length)return null;
  if(xs.length===1)return xs[0];
  const pos=(xs.length-1)*q;
  const lo=Math.floor(pos),hi=Math.ceil(pos);
  if(lo===hi)return xs[lo];
  return xs[lo]+(xs[hi]-xs[lo])*(pos-lo);
};
const cagr=(start,end,years)=>{
  const a=n(start),b=n(end),y=n(years);
  if(a==null||b==null||y==null||a<=0||b<=0||y<=0)return null;
  return (Math.pow(b/a,1/y)-1)*100;
};

export const INDUSTRY_VALUATION_PROFILES=Object.freeze({
  consumer_brand:{methods:["fcf_dcf","historical_multiple","peer_multiple"],multipleMetric:"price_to_fcf",perShareMetric:"fcf_per_share",expectedIndependentAnchors:3},
  software_platform:{methods:["fcf_dcf","historical_multiple","peer_multiple"],multipleMetric:"price_to_fcf",perShareMetric:"fcf_per_share",expectedIndependentAnchors:3},
  advertising_platform:{methods:["fcf_dcf","historical_multiple","peer_multiple"],multipleMetric:"price_to_fcf",perShareMetric:"fcf_per_share",expectedIndependentAnchors:3},
  industrial_manufacturing:{methods:["fcf_dcf","historical_multiple","peer_multiple"],multipleMetric:"price_to_fcf",perShareMetric:"fcf_per_share",expectedIndependentAnchors:3},
  healthcare_medtech:{methods:["fcf_dcf","historical_multiple","peer_multiple"],multipleMetric:"price_to_fcf",perShareMetric:"fcf_per_share",expectedIndependentAnchors:3},
  transaction_network:{methods:["fcf_dcf","historical_multiple","peer_multiple"],multipleMetric:"price_to_fcf",perShareMetric:"fcf_per_share",expectedIndependentAnchors:3},
  data_subscription:{methods:["fcf_dcf","historical_multiple","peer_multiple"],multipleMetric:"price_to_fcf",perShareMetric:"fcf_per_share",expectedIndependentAnchors:3},
  healthcare_distribution:{methods:["fcf_dcf","historical_multiple","peer_multiple"],multipleMetric:"price_to_fcf",perShareMetric:"fcf_per_share",expectedIndependentAnchors:3},
  industrial_distribution:{methods:["fcf_dcf","historical_multiple","peer_multiple"],multipleMetric:"price_to_fcf",perShareMetric:"fcf_per_share",expectedIndependentAnchors:3},
  franchise_consumer:{methods:["fcf_dcf","historical_multiple","peer_multiple"],multipleMetric:"price_to_fcf",perShareMetric:"fcf_per_share",expectedIndependentAnchors:3},
  biopharma:{methods:["fcf_dcf","normalized_eps_multiple","historical_multiple","peer_multiple"],multipleMetric:"forward_pe",perShareMetric:"normalized_eps",expectedIndependentAnchors:4},
  financial_bank:{methods:["normalized_eps_multiple","book_value_multiple","historical_multiple","peer_multiple"],multipleMetric:"price_to_tangible_book",perShareMetric:"tangible_book_value_per_share",expectedIndependentAnchors:4},
  generic:{methods:["fcf_dcf","historical_multiple","peer_multiple"],multipleMetric:"price_to_fcf",perShareMetric:"fcf_per_share",expectedIndependentAnchors:3},
});

function profileFor(industryModule){
  return INDUSTRY_VALUATION_PROFILES[industryModule]??INDUSTRY_VALUATION_PROFILES.generic;
}

function scenarioAssumption(input,scenario,key){
  return n(input?.assumptions?.[scenario]?.[key]);
}

function projectGrowthRateSeries({initialGrowth,matureGrowth,years}){
  const g0=n(initialGrowth),gm=n(matureGrowth),y=Math.max(1,Math.floor(n(years)??0));
  if(g0==null||gm==null||!y)return null;
  if(y===1)return[g0];
  return Array.from({length:y},(_,i)=>g0+(gm-g0)*(i/(y-1)));
}

export function dcfPerShareV3({
  startingCashFlowPerShare,
  initialGrowth,
  matureGrowth,
  projectionYears=5,
  discountRate,
  terminalGrowth,
}={}){
  const start=n(startingCashFlowPerShare),r=n(discountRate),tg=n(terminalGrowth),years=Math.floor(n(projectionYears)??0);
  if(start==null||start<=0||r==null||tg==null||years<1||r<=tg)return null;
  const rates=projectGrowthRateSeries({initialGrowth,matureGrowth,years});
  if(!rates)return null;
  let cashFlow=start,pv=0;
  const projected=[];
  for(let i=0;i<rates.length;i++){
    cashFlow*=1+rates[i]/100;
    const discounted=cashFlow/Math.pow(1+r/100,i+1);
    pv+=discounted;
    projected.push({year:i+1,growth_rate:round(rates[i],2),cash_flow_per_share:round(cashFlow,4),present_value:round(discounted,4)});
  }
  const terminal=cashFlow*(1+tg/100)/((r-tg)/100);
  const terminalPv=terminal/Math.pow(1+r/100,years);
  return{
    value:round(pv+terminalPv,4),
    projected,
    terminal_value:round(terminal,4),
    terminal_present_value:round(terminalPv,4),
    discount_rate:r,
    terminal_growth:tg,
  };
}

function multipleValue(perShare,multiple){
  const p=n(perShare),m=n(multiple);
  if(p==null||p<=0||m==null||m<=0)return null;
  return round(p*m,4);
}

function metricForProfile(input,profile){
  if(profile.perShareMetric==="normalized_eps")return n(input.normalizedEpsPerShare);
  if(profile.perShareMetric==="tangible_book_value_per_share")return n(input.tangibleBookValuePerShare);
  return n(input.fcfPerShare);
}

function multipleForScenario(input,scenario,kind,profile){
  if(kind==="historical")return n(input?.multiples?.historical?.[scenario]??input?.multiples?.historical?.base);
  if(kind==="peer")return n(input?.multiples?.peer?.[scenario]??input?.multiples?.peer?.base);
  if(kind==="normalized_eps")return n(input?.multiples?.normalizedEps?.[scenario]??input?.multiples?.normalizedEps?.base);
  if(kind==="book")return n(input?.multiples?.book?.[scenario]??input?.multiples?.book?.base);
  return null;
}

function buildScenarioMethods(input,scenario,profile){
  const methods=[];

  if(profile.methods.includes("fcf_dcf")){
    const fcf=n(input.fcfPerShare);
    const result=dcfPerShareV3({
      startingCashFlowPerShare:fcf,
      initialGrowth:scenarioAssumption(input,scenario,"initialGrowth"),
      matureGrowth:scenarioAssumption(input,scenario,"matureGrowth"),
      projectionYears:n(input?.assumptions?.[scenario]?.projectionYears)??5,
      discountRate:scenarioAssumption(input,scenario,"discountRate"),
      terminalGrowth:scenarioAssumption(input,scenario,"terminalGrowth"),
    });
    methods.push({
      key:"fcf_dcf",
      family:"intrinsic_cash_flow",
      status:result?"applied":"unavailable",
      value:result?.value??null,
      detail:result,
      reason:result?"Explicit two-stage per-share FCF DCF.":"Requires positive FCF/share plus explicit growth, discount-rate and terminal assumptions.",
    });
  }

  if(profile.methods.includes("normalized_eps_multiple")){
    const eps=n(input.normalizedEpsPerShare??input.epsPerShare);
    const multiple=multipleForScenario(input,scenario,"normalized_eps",profile);
    const value=multipleValue(eps,multiple);
    methods.push({
      key:"normalized_eps_multiple",
      family:"normalized_earnings",
      status:value!=null?"applied":"unavailable",
      value,
      detail:value==null?null:{per_share_metric:eps,multiple},
      reason:value!=null?"Normalized earnings per share × explicit scenario P/E.":"Requires positive normalized EPS/share and explicit scenario P/E.",
    });
  }

  if(profile.methods.includes("book_value_multiple")){
    const tbv=n(input.tangibleBookValuePerShare??input.bookValuePerShare);
    const multiple=multipleForScenario(input,scenario,"book",profile);
    const value=multipleValue(tbv,multiple);
    methods.push({
      key:"book_value_multiple",
      family:"book_value",
      status:value!=null?"applied":"unavailable",
      value,
      detail:value==null?null:{per_share_metric:tbv,multiple},
      reason:value!=null?"Tangible/book value per share × explicit scenario multiple.":"Requires tangible/book value per share and explicit scenario P/TBV or P/B.",
    });
  }

  if(profile.methods.includes("historical_multiple")){
    const perShare=metricForProfile(input,profile);
    const multiple=multipleForScenario(input,scenario,"historical",profile);
    const value=multipleValue(perShare,multiple);
    methods.push({
      key:"historical_multiple",
      family:"historical_relative",
      status:value!=null?"applied":"unavailable",
      value,
      detail:value==null?null:{per_share_metric:perShare,multiple,metric:profile.multipleMetric},
      reason:value!=null?"Current normalized per-share metric × explicit historical valuation anchor.":"Requires the profile per-share metric and an explicit historical multiple.",
    });
  }

  if(profile.methods.includes("peer_multiple")){
    const perShare=metricForProfile(input,profile);
    const multiple=multipleForScenario(input,scenario,"peer",profile);
    const value=multipleValue(perShare,multiple);
    methods.push({
      key:"peer_multiple",
      family:"peer_relative",
      status:value!=null?"applied":"unavailable",
      value,
      detail:value==null?null:{per_share_metric:perShare,multiple,metric:profile.multipleMetric},
      reason:value!=null?"Current normalized per-share metric × explicit peer valuation anchor.":"Requires the profile per-share metric and an explicit peer multiple.",
    });
  }

  if(n(input.ownerEarningsPerShare)!=null){
    if(input.ownerEarningsIndependent===true){
      const result=dcfPerShareV3({
        startingCashFlowPerShare:input.ownerEarningsPerShare,
        initialGrowth:scenarioAssumption(input,scenario,"initialGrowth"),
        matureGrowth:scenarioAssumption(input,scenario,"matureGrowth"),
        projectionYears:n(input?.assumptions?.[scenario]?.projectionYears)??5,
        discountRate:scenarioAssumption(input,scenario,"discountRate"),
        terminalGrowth:scenarioAssumption(input,scenario,"terminalGrowth"),
      });
      methods.push({
        key:"owner_earnings_dcf",
        family:"owner_earnings",
        status:result?"applied":"unavailable",
        value:result?.value??null,
        detail:result,
        reason:result?"Independent owner-earnings DCF.":"Requires explicit independent owner earnings plus full DCF assumptions.",
      });
    }else{
      methods.push({
        key:"owner_earnings_dcf",
        family:"owner_earnings",
        status:"excluded_duplicate",
        value:null,
        detail:null,
        reason:"Owner earnings was not demonstrated to be independent from FCF, so it is excluded as a duplicate anchor.",
      });
    }
  }

  return methods;
}

function scenarioSummary(methods){
  const applied=methods.filter(m=>m.status==="applied"&&n(m.value)!=null);
  const byFamily=new Map();
  for(const method of applied){
    if(!byFamily.has(method.family))byFamily.set(method.family,method);
  }
  const independent=[...byFamily.values()];
  const values=independent.map(m=>m.value);
  return{
    central_value:round(median(values),2),
    low_anchor:round(quantile(values,.25),2),
    high_anchor:round(quantile(values,.75),2),
    min_anchor:round(values.length?Math.min(...values):null,2),
    max_anchor:round(values.length?Math.max(...values):null,2),
    independent_anchor_count:independent.length,
    anchors:independent.map(m=>({key:m.key,family:m.family,value:round(m.value,2)})),
  };
}

function confidenceScore(input,profile,baseSummary){
  const anchorPct=clamp((baseSummary.independent_anchor_count/Math.max(1,profile.expectedIndependentAnchors))*100);
  const historyYears=n(input.evidence?.valuationHistoryYears);
  const historyPct=historyYears==null?0:clamp(historyYears/5*100);
  const peers=n(input.evidence?.peerCount);
  const peerPct=peers==null?0:clamp(peers/4*100);
  const primary=n(input.evidence?.primarySourcePct);
  const primaryPct=primary==null?0:clamp(primary);
  const assumptionPct=clamp(
    ["bear","base","bull"].reduce((sum,s)=>{
      const req=profile.methods.includes("fcf_dcf")
        ? ["initialGrowth","matureGrowth","discountRate","terminalGrowth"]
        : [];
      return sum+req.filter(k=>scenarioAssumption(input,s,k)!=null).length;
    },0) /
    Math.max(1,(profile.methods.includes("fcf_dcf")?12:1))*100
  );
  const score=anchorPct*.35+historyPct*.25+peerPct*.15+primaryPct*.15+assumptionPct*.10;
  const band=score>=85?"high":score>=65?"medium":score>=45?"developing":"low";
  return{
    score:round(score,1),
    band,
    components:{
      anchor_sufficiency_pct:round(anchorPct,1),
      valuation_history_pct:round(historyPct,1),
      peer_coverage_pct:round(peerPct,1),
      primary_source_pct:round(primaryPct,1),
      assumption_completeness_pct:round(assumptionPct,1),
    },
  };
}

function displayRange(baseSummary,confidence){
  const central=n(baseSummary.central_value);
  if(central==null)return{low:null,high:null,precision:"unavailable"};
  const qLow=n(baseSummary.low_anchor),qHigh=n(baseSummary.high_anchor);
  const spreadFloor=confidence.band==="high"?.08:confidence.band==="medium"?.12:confidence.band==="developing"?.18:.25;
  const low=qLow??central*(1-spreadFloor);
  const high=qHigh??central*(1+spreadFloor);
  const paddedLow=Math.min(low,central*(1-spreadFloor));
  const paddedHigh=Math.max(high,central*(1+spreadFloor));
  return{
    low:round(paddedLow,2),
    high:round(paddedHigh,2),
    precision:confidence.band==="high"?"narrow":confidence.band==="medium"?"moderate":"wide",
  };
}

export function buildDcfSensitivity({
  startingCashFlowPerShare,
  initialGrowth,
  matureGrowth,
  projectionYears=5,
  discountRate,
  terminalGrowth,
  discountRateSteps=[-1,0,1],
  terminalGrowthSteps=[-.5,0,.5],
}={}){
  const rows=[];
  const baseR=n(discountRate),baseG=n(terminalGrowth);
  if(baseR==null||baseG==null)return rows;
  for(const dr of discountRateSteps){
    for(const dg of terminalGrowthSteps){
      const r=baseR+dr,g=baseG+dg;
      const result=dcfPerShareV3({startingCashFlowPerShare,initialGrowth,matureGrowth,projectionYears,discountRate:r,terminalGrowth:g});
      rows.push({discount_rate:round(r,2),terminal_growth:round(g,2),value:result?.value??null});
    }
  }
  return rows;
}

function terminalMetricAtHorizon(start,growthRate,horizon){
  const s=n(start),g=n(growthRate),h=n(horizon);
  if(s==null||g==null||h==null||s<=0||h<=0)return null;
  return s*Math.pow(1+g/100,h);
}

function dividendTotal({annualDividendPerShare=0,dividendGrowthRate=0,horizon}={}){
  const d=n(annualDividendPerShare)??0,g=n(dividendGrowthRate)??0,h=Math.floor(n(horizon)??0);
  if(d<=0||h<=0)return 0;
  let total=0,current=d;
  for(let year=1;year<=h;year++){
    total+=current;
    current*=1+g/100;
  }
  return total;
}

export function expectedReturnScenariosV3({
  currentPrice,
  scenarios={},
  horizons=[3,5,10],
}={}){
  const price=n(currentPrice);
  if(price==null||price<=0)return[];
  const out=[];
  for(const scenario of ["bear","base","bull"]){
    const s=scenarios?.[scenario]??{};
    const startMetric=n(s.startingMetricPerShare);
    const growth=n(s.metricGrowthRate);
    const exitMultiple=n(s.exitMultiple);
    for(const horizon of horizons){
      const terminalMetric=terminalMetricAtHorizon(startMetric,growth,horizon);
      const terminalValue=multipleValue(terminalMetric,exitMultiple);
      const dividends=dividendTotal({
        annualDividendPerShare:s.annualDividendPerShare,
        dividendGrowthRate:s.dividendGrowthRate,
        horizon,
      });
      const endingWealth=terminalValue==null?null:terminalValue+dividends;
      out.push({
        scenario,
        horizon_years:horizon,
        expected_cagr:cagr(price,endingWealth,horizon)==null?null:round(cagr(price,endingWealth,horizon),2),
        terminal_metric_per_share:round(terminalMetric,4),
        exit_multiple:exitMultiple,
        terminal_value:round(terminalValue,2),
        cumulative_dividends:round(dividends,2),
        ending_wealth:round(endingWealth,2),
        status:endingWealth==null?"unavailable":"applied",
        note:endingWealth==null
          ?"Requires explicit starting per-share metric, growth rate and exit multiple."
          :"Terminal value is projected separately for each horizon; the same fair value is never reused across 3/5/10 years.",
      });
    }
  }
  return out;
}

export function valueCompanyV3(input={}){
  const profile=profileFor(input.industryModule);
  const scenarioResults={};
  for(const scenario of ["bear","base","bull"]){
    const methods=buildScenarioMethods(input,scenario,profile);
    scenarioResults[scenario]={
      methods,
      summary:scenarioSummary(methods),
    };
  }
  const base=scenarioResults.base.summary;
  const confidence=confidenceScore(input,profile,base);
  const range=displayRange(base,confidence);
  const currentPrice=n(input.currentPrice);
  const central=n(base.central_value);
  const upside=currentPrice!=null&&central!=null&&currentPrice>0?(central/currentPrice-1)*100:null;

  const fcfSensitivity=profile.methods.includes("fcf_dcf")
    ? buildDcfSensitivity({
        startingCashFlowPerShare:input.fcfPerShare,
        initialGrowth:scenarioAssumption(input,"base","initialGrowth"),
        matureGrowth:scenarioAssumption(input,"base","matureGrowth"),
        projectionYears:n(input?.assumptions?.base?.projectionYears)??5,
        discountRate:scenarioAssumption(input,"base","discountRate"),
        terminalGrowth:scenarioAssumption(input,"base","terminalGrowth"),
      })
    : [];

  const expectedReturns=expectedReturnScenariosV3({
    currentPrice,
    scenarios:input.returnScenarios??{},
  });

  return{
    engine_version:VALUATION_ENGINE_VERSION,
    methodology_version:VALUATION_METHODOLOGY_VERSION,
    industry_module:input.industryModule??"generic",
    profile,
    current_price:currentPrice,
    scenarios:scenarioResults,
    base_fair_value:central==null?null:round(central,2),
    fair_value_range:range,
    upside_downside_pct:upside==null?null:round(upside,1),
    confidence,
    margin_of_safety:{
      mos_25_price:central==null?null:round(central*.75,2),
      mos_35_price:central==null?null:round(central*.65,2),
      mos_50_price:central==null?null:round(central*.50,2),
    },
    sensitivities:{fcf_dcf:fcfSensitivity},
    expected_return_scenarios:expectedReturns,
    limitations:[
      "No valuation assumption is silently imputed. Missing inputs make the affected method unavailable.",
      "Relative valuation anchors are inputs, not generated facts; historical and peer multiples must come from point-in-time evidence.",
      "Confidence measures evidence/model support, not investment attractiveness.",
      "Fair-value range is widened when confidence is weak to avoid false precision.",
    ],
  };
}
