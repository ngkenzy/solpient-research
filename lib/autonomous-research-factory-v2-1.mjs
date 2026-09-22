import { canonicalSha256 } from "./integrity-hash.mjs";
import {
  INDUSTRY_MODULES,
  TICKER_INDUSTRY_MODULE,
} from "./industry-modules.mjs";
import { valuationPreflight } from "./research-candidate-pipeline.mjs";

export const AUTONOMOUS_RESEARCH_FACTORY_VERSION="autonomous-research-factory-v2.1";
export const AUTONOMOUS_INDUSTRY_POLICY_VERSION="industry-assignment-v2.1";
export const AUTONOMOUS_VALUATION_POLICY_VERSION="valuation-assumptions-v2.1.1";
export const AUTONOMOUS_DECISION_MIN_CONFIDENCE=0.80;
export const AUTONOMOUS_VALUATION_MIN_CONFIDENCE=78;

const n=(value)=>{
  if(value===null||value===undefined||value==="")return null;
  const x=Number(value);
  return Number.isFinite(x)?x:null;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const round=(value,digits=2)=>{
  const x=n(value);
  return x==null?null:Math.round(x*10**digits)/10**digits;
};
const median=(values)=>{
  const xs=(values??[]).map(n).filter(x=>x!=null).sort((a,b)=>a-b);
  if(!xs.length)return null;
  const i=Math.floor(xs.length/2);
  return xs.length%2?xs[i]:(xs[i-1]+xs[i])/2;
};
const quantile=(values,q)=>{
  const xs=(values??[]).map(n).filter(x=>x!=null).sort((a,b)=>a-b);
  if(!xs.length)return null;
  if(xs.length===1)return xs[0];
  const pos=(xs.length-1)*q;
  const lo=Math.floor(pos),hi=Math.ceil(pos);
  if(lo===hi)return xs[lo];
  return xs[lo]+(xs[hi]-xs[lo])*(pos-lo);
};
const pctChange=(current,previous)=>{
  const a=n(current),b=n(previous);
  if(a==null||b==null||b===0)return null;
  return (a/b-1)*100;
};
const canonicalTicker=(value)=>String(value??"").trim().toUpperCase();

const TICKER_AUTONOMOUS_OVERRIDES=Object.freeze({
  ...TICKER_INDUSTRY_MODULE,
  ACN:"business_services",
  G:"business_services",
  EXLS:"business_services",
  SEZL:"generic_corporate",
  HQY:"generic_corporate",
  V:"transaction_network",
  BR:"data_subscription",
  PAYX:"data_subscription",
  DVA:"healthcare_services",
  NFLX:"interactive_media",
  YELP:"interactive_media",
  PINS:"advertising_platform",
  MCD:"franchise_consumer",
  YUM:"franchise_consumer",
  WINA:"franchise_consumer",
  OLLI:"consumer_retail",
  PG:"consumer_staples",
  WM:"utility_infrastructure",
});

function sectorConfidence(classification={}){
  if(classification?.reviewRequired===true)return 0.45;
  const value=String(classification?.confidence??"").toLowerCase();
  if(value==="reviewed")return 1;
  if(value==="high")return 0.95;
  if(value==="medium")return 0.75;
  if(value==="low")return 0.55;
  return 0.70;
}

function moduleFromScreen({ticker,screenProfile,sector,industry}={}){
  const symbol=canonicalTicker(ticker);
  if(TICKER_AUTONOMOUS_OVERRIDES[symbol]){
    return{
      module:TICKER_AUTONOMOUS_OVERRIDES[symbol],
      rule:"ticker_override",
      ruleConfidence:1,
    };
  }

  const profile=String(screenProfile??"").toLowerCase();
  const sectorText=String(sector??"").toLowerCase();
  const industryText=String(industry??"").toLowerCase();

  if(profile==="software")return{module:"software_platform",rule:"profile:software",ruleConfidence:.96};
  if(profile==="technology")return{module:"technology_hardware",rule:"profile:technology",ruleConfidence:.92};
  if(profile==="biopharma")return{module:"biopharma",rule:"profile:biopharma",ruleConfidence:.98};
  if(profile==="healthcare"){
    if(industryText.includes("service"))return{module:"healthcare_services",rule:"healthcare:services",ruleConfidence:.86};
    return{module:"healthcare_medtech",rule:"profile:healthcare",ruleConfidence:.90};
  }
  if(profile==="communication"){
    if(industryText.includes("telecommunication"))return{module:"telecom_network",rule:"communication:telecom",ruleConfidence:.94};
    if(industryText.includes("interactive"))return{module:"interactive_media",rule:"communication:interactive",ruleConfidence:.92};
    if(industryText.includes("media"))return{module:"interactive_media",rule:"communication:media",ruleConfidence:.88};
    return{module:"interactive_media",rule:"profile:communication",ruleConfidence:.82};
  }
  if(profile==="consumer_discretionary"){
    if(industryText.includes("education"))return{module:"education_services",rule:"consumer:education",ruleConfidence:.96};
    if(industryText.includes("leisure"))return{module:"consumer_brand",rule:"consumer:leisure",ruleConfidence:.90};
    return{module:"consumer_brand",rule:"profile:consumer_discretionary",ruleConfidence:.84};
  }
  if(profile==="consumer_staples"){
    if(industryText.includes("distribution")||industryText.includes("retail")){
      return{module:"consumer_retail",rule:"staples:retail",ruleConfidence:.92};
    }
    return{module:"consumer_staples",rule:"profile:consumer_staples",ruleConfidence:.90};
  }
  if(profile==="industrial"){
    if(industryText.includes("transportation"))return{module:"transportation_services",rule:"industrial:transportation",ruleConfidence:.92};
    if(industryText.includes("building")||industryText.includes("construction")){
      return{module:"industrial_manufacturing",rule:"industrial:building",ruleConfidence:.92};
    }
    if(industryText.includes("business service"))return{module:"business_services",rule:"industrial:business_services",ruleConfidence:.86};
    return{module:"generic_corporate",rule:"profile:industrial_fallback",ruleConfidence:.82};
  }
  if(profile==="cyclical"||sectorText.includes("materials")){
    return{module:"materials_cyclical",rule:"profile:cyclical",ruleConfidence:.90};
  }
  if(profile==="utility"||sectorText.includes("utilities")){
    return{module:"utility_infrastructure",rule:"profile:utility",ruleConfidence:.95};
  }

  if(
    sectorText&&
    !sectorText.includes("financial")&&
    !sectorText.includes("real estate")
  ){
    return{module:"generic_corporate",rule:"operating_company_fallback",ruleConfidence:.80};
  }
  return{module:null,rule:"unsupported_profile",ruleConfidence:0};
}

export function assignAutonomousIndustryModule({
  ticker,
  screenProfile,
  sector,
  industry,
  sectorClassification={},
}={}){
  const proposed=moduleFromScreen({ticker,screenProfile,sector,industry});
  const classificationConfidence=sectorConfidence(sectorClassification);
  const confidence=Math.min(classificationConfidence,proposed.ruleConfidence??0);
  const moduleSupported=Boolean(proposed.module&&INDUSTRY_MODULES[proposed.module]);
  const applied=
    moduleSupported&&
    sectorClassification?.reviewRequired!==true&&
    confidence>=AUTONOMOUS_DECISION_MIN_CONFIDENCE;

  const evidence={
    ticker:canonicalTicker(ticker),
    screen_profile:screenProfile??null,
    sector:sector??null,
    industry:industry??null,
    sector_classification:sectorClassification??{},
    proposed_module:proposed.module,
    rule:proposed.rule,
    rule_confidence:proposed.ruleConfidence,
    classification_confidence:classificationConfidence,
    policy_version:AUTONOMOUS_INDUSTRY_POLICY_VERSION,
  };
  return{
    policy_version:AUTONOMOUS_INDUSTRY_POLICY_VERSION,
    ticker:canonicalTicker(ticker),
    module:applied?proposed.module:null,
    proposed_module:proposed.module,
    status:applied?"applied":"quarantined",
    confidence:round(confidence,4),
    confidence_pct:round(confidence*100,1),
    method:proposed.rule,
    reason:applied
      ?"Sector classification and deterministic industry policy exceed the autonomous assignment threshold."
      : sectorClassification?.reviewRequired===true
        ?"Source sector classification explicitly requires review."
        : !moduleSupported
          ?"No supported Solpient industry module exists for this profile."
          :"Industry assignment confidence is below the autonomous threshold.",
    evidence,
    decision_hash:canonicalSha256({
      contract:"solpient-autonomous-industry-assignment-v2.1",
      evidence,
      status:applied?"applied":"quarantined",
    }),
  };
}

function comparableYoy(rows=[],field){
  const normalized=[...rows]
    .filter(row=>String(row?.fiscal_period??"").toUpperCase()!=="FY")
    .sort((a,b)=>String(b?.period_end??"").localeCompare(String(a?.period_end??"")));
  const byKey=new Map();
  for(const row of normalized){
    const key=String(row?.fiscal_period??"").toUpperCase()+"|"+String(row?.fiscal_year??"");
    if(!byKey.has(key))byKey.set(key,row);
  }
  const values=[];
  for(const row of normalized.slice(0,16)){
    const fy=Number(row?.fiscal_year);
    const fp=String(row?.fiscal_period??"").toUpperCase();
    const prior=byKey.get(fp+"|"+String(fy-1));
    const growth=pctChange(row?.[field],prior?.[field]);
    if(growth!=null&&Math.abs(growth)<=200)values.push(growth);
  }
  return values;
}

function fcfPerShareRows(rows=[]){
  return rows.map(row=>{
    const fcf=n(row?.free_cash_flow),shares=n(row?.shares_outstanding);
    return{
      ...row,
      fcf_per_share:fcf!=null&&shares!=null&&shares>0?fcf/shares:null,
    };
  });
}

function baselineMetric(baselineDraft,key){
  const rows=Array.isArray(baselineDraft?.draft_payload?.metric_observations)
    ?baselineDraft.draft_payload.metric_observations
    :[];
  const row=rows.find(x=>x?.metric_key===key&&x?.status==="available");
  return n(row?.value_numeric);
}

function isActualPrimaryFundamental(row={}){
  const provider=String(row?.provider??"").toLowerCase();
  const sourceUrl=String(row?.source_url??"").toLowerCase();
  return provider==="sec_companyfacts"||
    provider==="sec"||
    provider.includes("edgar")||
    sourceUrl.includes("sec.gov");
}

function primarySourcePct(fundamentals=[]){
  if(!fundamentals.length)return 0;
  const primary=fundamentals.filter(isActualPrimaryFundamental).length;
  return primary/fundamentals.length*100;
}

function structuredFundamentalCorroboration(fundamentals=[]){
  const coreFields=["revenue","free_cash_flow","shares_outstanding","eps_diluted"];
  const rows=(fundamentals??[]).filter(row=>!isActualPrimaryFundamental(row));
  const providers=[...new Set(rows.map(row=>String(row?.provider??"").trim()).filter(Boolean))];
  const groups=new Map();

  for(const row of rows){
    const period=String(row?.period_end??"");
    if(!period)continue;
    const periodClass=
      String(row?.fiscal_period??"").toUpperCase()==="FY"||
      String(row?.form??"").toUpperCase()==="10-K"
        ?"annual"
        :"quarter";
    const key=period+"|"+periodClass;
    const byProvider=groups.get(key)??new Map();
    const provider=String(row?.provider??"").trim();
    if(provider&&!byProvider.has(provider))byProvider.set(provider,row);
    groups.set(key,byProvider);
  }

  let comparableMetricPeriods=0;
  let agreedMetricPeriods=0;
  for(const byProvider of groups.values()){
    if(byProvider.size<2)continue;
    const groupRows=[...byProvider.values()];
    for(const field of coreFields){
      const values=groupRows.map(row=>n(row?.[field])).filter(value=>value!=null);
      if(values.length<2)continue;
      comparableMetricPeriods+=1;
      const lo=Math.min(...values),hi=Math.max(...values);
      const scale=Math.max(Math.abs(lo),Math.abs(hi),1e-12);
      const relativeGapPct=Math.abs(hi-lo)/scale*100;
      if(relativeGapPct<=5)agreedMetricPeriods+=1;
    }
  }

  const agreementPct=comparableMetricPeriods
    ?agreedMetricPeriods/comparableMetricPeriods*100
    :0;
  const qualifies=
    providers.length>=2&&
    comparableMetricPeriods>=6&&
    agreementPct>=90;

  return{
    provider_count:providers.length,
    providers:providers.sort(),
    comparable_metric_periods:comparableMetricPeriods,
    agreed_metric_periods:agreedMetricPeriods,
    agreement_pct:round(agreementPct,1),
    qualifies,
  };
}

function fundamentalEvidenceProfile(fundamentals=[]){
  const primaryRows=(fundamentals??[]).filter(isActualPrimaryFundamental).length;
  const primaryPct=primarySourcePct(fundamentals);
  const corroboration=structuredFundamentalCorroboration(fundamentals);

  if(primaryRows>=8||primaryPct>=50){
    return{
      mode:"primary_regulatory",
      confidence_pct:100,
      qualifies:true,
      primary_rows:primaryRows,
      primary_source_pct:round(primaryPct,1),
      structured_corroboration:corroboration,
    };
  }
  if(primaryRows>=4||primaryPct>=25){
    return{
      mode:"primary_regulatory_partial",
      confidence_pct:85,
      qualifies:true,
      primary_rows:primaryRows,
      primary_source_pct:round(primaryPct,1),
      structured_corroboration:corroboration,
    };
  }
  if(corroboration.qualifies){
    return{
      mode:"structured_provider_corroboration",
      confidence_pct:70,
      qualifies:true,
      primary_rows:primaryRows,
      primary_source_pct:round(primaryPct,1),
      structured_corroboration:corroboration,
    };
  }
  return{
    mode:"insufficient_source_corroboration",
    confidence_pct:0,
    qualifies:false,
    primary_rows:primaryRows,
    primary_source_pct:round(primaryPct,1),
    structured_corroboration:corroboration,
  };
}

function moduleRiskRate(module){
  const map={
    software_platform:9.75,
    data_subscription:9.5,
    advertising_platform:10.25,
    technology_hardware:10.25,
    biopharma:10.75,
    healthcare_medtech:9.75,
    healthcare_services:9.75,
    consumer_brand:10,
    consumer_retail:10,
    consumer_staples:8.75,
    franchise_consumer:9.5,
    transaction_network:8.75,
    industrial_manufacturing:9.5,
    industrial_distribution:9.5,
    business_services:9.5,
    transportation_services:10,
    materials_cyclical:10.5,
    education_services:10,
    telecom_network:9.25,
    interactive_media:10.25,
    utility_infrastructure:8.5,
    generic_corporate:10,
  };
  return map[module]??10;
}

function moduleGrowthCap(module){
  if(["software_platform","technology_hardware","interactive_media","advertising_platform"].includes(module))return 22;
  if(module==="biopharma")return 18;
  if(["utility_infrastructure","consumer_staples","telecom_network"].includes(module))return 10;
  return 15;
}

function multipleSeries({industryModule,valuationHistory=[]}={}){
  const useForwardPe=industryModule==="biopharma"||industryModule==="financial_bank";
  return valuationHistory
    .map(row=>n(useForwardPe?row.forward_pe:row.price_to_fcf))
    .filter(x=>x!=null&&x>0&&x<200);
}

function peerMultipleSeries({industryModule,contextPack}={}){
  const useForwardPe=industryModule==="biopharma"||industryModule==="financial_bank";
  return (contextPack?.peer_comparison??[])
    .filter(row=>row?.data_status==="available")
    .map(row=>n(row?.metrics?.[useForwardPe?"pe":"price_to_fcf"]))
    .filter(x=>x!=null&&x>0&&x<200);
}

function multipleAnchors(values=[]){
  if(values.length<3)return null;
  return{
    bear:round(quantile(values,.25),2),
    base:round(quantile(values,.50),2),
    bull:round(quantile(values,.75),2),
  };
}

function annualCoverageYears(valuationHistory=[]){
  const dates=valuationHistory
    .map(row=>new Date(String(row?.trading_date??"")+"T00:00:00Z"))
    .filter(date=>Number.isFinite(date.getTime()))
    .sort((a,b)=>a-b);
  if(dates.length<2)return 0;
  return (dates.at(-1)-dates[0])/(365.25*24*60*60*1000);
}

export function buildAutonomousValuationPolicy({
  screenResult={},
  industryAssignment,
  baselineDraft=null,
  fundamentals=[],
  market=null,
  consensus=null,
  valuationHistory=[],
  contextPack=null,
  coverage=null,
}={}){
  const industryModule=industryAssignment?.module??baselineDraft?.industry_module??null;
  if(!industryModule){
    return{
      policy_version:AUTONOMOUS_VALUATION_POLICY_VERSION,
      status:"quarantined",
      confidence:0,
      confidence_pct:0,
      reason:"No autonomous industry module is available.",
      valuation_input:{},
      evidence:{},
      decision_hash:canonicalSha256({
        contract:"solpient-autonomous-valuation-policy-v2.1.1",
        reason:"missing_industry_module",
        ticker:screenResult?.ticker??null,
      }),
    };
  }

  const fcfPerShare=baselineMetric(baselineDraft,"fcf_per_share");
  const netDebtToFcf=baselineMetric(baselineDraft,"net_debt_to_fcf");
  const currentPrice=n(market?.price)??n(screenResult?.input_summary?.price);

  const withFcfPerShare=fcfPerShareRows(fundamentals);
  const revenueGrowth=comparableYoy(fundamentals,"revenue");
  const fcfGrowth=comparableYoy(withFcfPerShare,"fcf_per_share");
  const epsGrowth=comparableYoy(fundamentals,"eps_diluted");

  const consensusRevenue=n(consensus?.revenue_growth_next_fy);
  const consensusEpsGrowth=n(consensus?.eps_growth_next_fy);
  const analystCount=n(consensus?.analyst_count)??0;

  const growthSignals=[
    median(revenueGrowth),
    median(fcfGrowth),
    median(epsGrowth),
    analystCount>=3?consensusRevenue:null,
    analystCount>=3?consensusEpsGrowth:null,
  ].filter(x=>x!=null&&x>-80&&x<150);

  let baseInitial=median(growthSignals);
  if(baseInitial!=null){
    const cap=moduleGrowthCap(industryModule);
    baseInitial=clamp(baseInitial,-5,cap);
  }

  const spread=Math.max(
    4,
    Math.min(
      10,
      Math.abs((quantile(growthSignals,.75)??baseInitial??0)-(quantile(growthSignals,.25)??baseInitial??0))
    )
  );

  const baseDiscount=moduleRiskRate(industryModule)
    +(netDebtToFcf!=null&&netDebtToFcf>5?1.5:netDebtToFcf!=null&&netDebtToFcf>3?0.75:0)
    +(n(coverage?.overall_pct)!=null&&n(coverage?.overall_pct)<65?0.5:0);

  const matureBase=baseInitial==null?null:clamp(baseInitial*.45,2.5,6);
  const assumptions=baseInitial==null?{}:{
    bear:{
      initialGrowth:round(clamp(baseInitial-spread,-12,moduleGrowthCap(industryModule)),2),
      matureGrowth:round(clamp((matureBase??3)-1.5,1,4.5),2),
      discountRate:round(baseDiscount+2,2),
      terminalGrowth:1.5,
      projectionYears:5,
    },
    base:{
      initialGrowth:round(baseInitial,2),
      matureGrowth:round(matureBase,2),
      discountRate:round(baseDiscount,2),
      terminalGrowth:2.5,
      projectionYears:5,
    },
    bull:{
      initialGrowth:round(clamp(baseInitial+spread,-5,moduleGrowthCap(industryModule)+5),2),
      matureGrowth:round(clamp((matureBase??3)+1.5,3.5,8),2),
      discountRate:round(Math.max(7.5,baseDiscount-1),2),
      terminalGrowth:3,
      projectionYears:5,
    },
  };

  const historySeries=multipleSeries({industryModule,valuationHistory});
  const peerSeries=peerMultipleSeries({industryModule,contextPack});
  const historical=multipleAnchors(historySeries);
  const peer=multipleAnchors(peerSeries);

  const recentQuarterly=[...fundamentals]
    .filter(row=>String(row?.fiscal_period??"").toUpperCase()!=="FY")
    .sort((a,b)=>String(b?.period_end??"").localeCompare(String(a?.period_end??"")));
  const ttmEps=recentQuarterly.slice(0,4).length===4
    ?recentQuarterly.slice(0,4)
      .map(row=>n(row?.eps_diluted))
      .reduce((acc,value)=>acc==null||value==null?null:acc+value,0)
    :null;
  const normalizedEps=n(consensus?.eps_next_fy)>0
    ?n(consensus.eps_next_fy)
    :ttmEps!=null&&ttmEps>0?ttmEps:null;

  const multiples={};
  if(historical)multiples.historical=historical;
  if(peer)multiples.peer=peer;
  if(industryModule==="biopharma"&&historical){
    multiples.normalizedEps=historical;
  }

  const perShareMetric=industryModule==="biopharma"?normalizedEps:fcfPerShare;
  const exitMultipleSet=peer??historical;
  const returnScenarios=perShareMetric!=null&&exitMultipleSet&&assumptions.base?{
    bear:{
      startingMetricPerShare:round(perShareMetric,6),
      metricGrowthRate:assumptions.bear.initialGrowth,
      exitMultiple:exitMultipleSet.bear,
    },
    base:{
      startingMetricPerShare:round(perShareMetric,6),
      metricGrowthRate:assumptions.base.initialGrowth,
      exitMultiple:exitMultipleSet.base,
    },
    bull:{
      startingMetricPerShare:round(perShareMetric,6),
      metricGrowthRate:assumptions.bull.initialGrowth,
      exitMultiple:exitMultipleSet.bull,
    },
  }:{};

  const fundamentalEvidence=fundamentalEvidenceProfile(fundamentals);

  const valuationInput={
    industryModule,
    currentPrice,
    fcfPerShare:round(fcfPerShare,6),
    normalizedEpsPerShare:round(normalizedEps,6),
    assumptions,
    multiples,
    returnScenarios,
    evidence:{
      valuationHistoryYears:round(annualCoverageYears(valuationHistory),2),
      peerCount:peerSeries.length,
      primarySourcePct:fundamentalEvidence.primary_source_pct,
      fundamentalEvidenceMode:fundamentalEvidence.mode,
      structuredCorroborationPct:fundamentalEvidence.structured_corroboration.agreement_pct,
    },
  };

  const preflight=valuationPreflight({
    ticker:screenResult?.ticker,
    profile:screenResult?.screen_profile,
  },valuationInput);

  const evidenceComponents={
    industry_assignment_pct:round((industryAssignment?.confidence??0)*100,1),
    growth_signal_count:growthSignals.length,
    consensus_analyst_count:analystCount,
    valuation_history_observations:historySeries.length,
    valuation_history_years:round(annualCoverageYears(valuationHistory),2),
    peer_multiple_count:peerSeries.length,
    primary_source_pct:fundamentalEvidence.primary_source_pct,
    fundamental_evidence_mode:fundamentalEvidence.mode,
    fundamental_evidence_confidence_pct:fundamentalEvidence.confidence_pct,
    structured_provider_count:fundamentalEvidence.structured_corroboration.provider_count,
    structured_corroboration_pct:fundamentalEvidence.structured_corroboration.agreement_pct,
    structured_comparable_metric_periods:fundamentalEvidence.structured_corroboration.comparable_metric_periods,
    coverage_pct:round(n(coverage?.overall_pct),1),
    market_price_source:market?.price!=null?"latest_market_snapshot":"immutable_screen_snapshot",
    market_trading_date:market?.trading_date??null,
  };

  const confidence=
    (industryAssignment?.confidence??0)*20+
    clamp(growthSignals.length/2*100,0,100)*.20+
    clamp(annualCoverageYears(valuationHistory)/5*100,0,100)*.20+
    clamp(peerSeries.length/4*100,0,100)*.15+
    clamp(fundamentalEvidence.confidence_pct,0,100)*.15+
    clamp(n(coverage?.overall_pct)??0,0,100)*.10;

  const criticalIssues=[];
  const valuationYears=annualCoverageYears(valuationHistory);
  if(currentPrice==null||currentPrice<=0)criticalIssues.push("missing_current_price");
  if(fcfPerShare==null||fcfPerShare<=0)criticalIssues.push("missing_positive_fcf_per_share");
  if(baseInitial==null||growthSignals.length<2)criticalIssues.push("insufficient_growth_evidence");
  if(!historical||historySeries.length<36||valuationYears<2.5){
    criticalIssues.push("insufficient_historical_multiple_evidence");
  }
  if(!peer||peerSeries.length<3)criticalIssues.push("insufficient_peer_multiple_evidence");
  if(!fundamentalEvidence.qualifies)criticalIssues.push("insufficient_fundamental_source_corroboration");
  if(industryModule==="biopharma"&&normalizedEps==null)criticalIssues.push("missing_normalized_eps");

  const autoApproved=
    preflight.complete&&
    confidence>=AUTONOMOUS_VALUATION_MIN_CONFIDENCE&&
    criticalIssues.length===0;

  const evidence={
    ...evidenceComponents,
    growth_signals:{
      revenue_growth_median:round(median(revenueGrowth),2),
      fcf_per_share_growth_median:round(median(fcfGrowth),2),
      eps_growth_median:round(median(epsGrowth),2),
      consensus_revenue_growth_next_fy:round(consensusRevenue,2),
      consensus_eps_growth_next_fy:round(consensusEpsGrowth,2),
    },
    policy_rates:{
      base_discount_rate:round(baseDiscount,2),
      method:"Solpient policy discount rate; not represented as a market-observed WACC.",
    },
    preflight,
    critical_issues:criticalIssues,
  };

  const status=autoApproved?"auto_approved":"quarantined";
  const decisionHash=canonicalSha256({
    contract:"solpient-autonomous-valuation-policy-v2.1.1",
    ticker:screenResult?.ticker??null,
    valuation_input:valuationInput,
    evidence,
    status,
  });

  return{
    policy_version:AUTONOMOUS_VALUATION_POLICY_VERSION,
    status,
    confidence:round(confidence/100,4),
    confidence_pct:round(confidence,1),
    reason:autoApproved
      ?"Explicit valuation inputs were generated from stored historical, peer, consensus and policy evidence and passed the autonomous confidence threshold."
      :"Valuation evidence did not satisfy the autonomous approval policy.",
    valuation_input:valuationInput,
    preflight,
    evidence,
    critical_issues:criticalIssues,
    decision_hash:decisionHash,
  };
}

export function autonomousDecisionHash(payload={}){
  return canonicalSha256({
    contract:"solpient-autonomous-research-factory-decision-v2.1",
    ...payload,
  });
}
