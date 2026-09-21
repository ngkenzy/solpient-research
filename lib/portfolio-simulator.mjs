export const PORTFOLIO_SIMULATOR_VERSION="portfolio-simulator-v1";

export const READINESS_TIER=Object.freeze({
  building:0,
  research_ready:1,
  decision_ready:2,
});

export const DEFAULT_GUARDRAILS=Object.freeze({
  max_position_pct:25,
  max_group_pct:40,
  min_cash_pct:5,
  max_building_pct:10,
  min_decision_ready_pct:50,
  min_weighted_evidence_score:65,
});

const n=(value)=>{
  if(value===null||value===undefined||value==="")return null;
  const x=Number(value);
  return Number.isFinite(x)?x:null;
};
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,v));
const round=(v,d=2)=>v==null?null:Math.round(v*10**d)/10**d;
const ticker=(v)=>String(v??"").trim().toUpperCase();
const readiness=(v)=>Object.prototype.hasOwnProperty.call(READINESS_TIER,String(v))?String(v):"building";

export function normalizePosition(input={}){
  const marketValue=n(input.market_value??input.marketValue)??0;
  return {
    ticker:ticker(input.ticker),
    company_name:input.company_name??input.companyName??null,
    group:input.group??input.sector??input.industry_module??"Unclassified",
    market_value:Math.max(0,marketValue),
    readiness_state:readiness(input.readiness_state??input.readinessState),
    decision_score:n(input.decision_score??input.decisionScore),
    business_quality_score:n(input.business_quality_score??input.businessQualityScore),
    investment_opportunity_score:n(input.investment_opportunity_score??input.investmentOpportunityScore),
    evidence_confidence_score:n(input.evidence_confidence_score??input.evidenceConfidenceScore),
    base_5y_cagr:n(input.base_5y_cagr??input.base5yCagr),
    current_price:n(input.current_price??input.currentPrice),
    bear_value:n(input.bear_value??input.bearValue),
    base_value:n(input.base_value??input.baseValue),
    bull_value:n(input.bull_value??input.bullValue),
    metadata:input.metadata??{},
  };
}

export function normalizePortfolio(input={}){
  const merged=new Map();
  for(const raw of Array.isArray(input.positions)?input.positions:[]){
    const pos=normalizePosition(raw);
    if(!pos.ticker||pos.market_value<=0)continue;
    if(!merged.has(pos.ticker)){
      merged.set(pos.ticker,pos);
      continue;
    }
    const prior=merged.get(pos.ticker);
    merged.set(pos.ticker,{
      ...prior,
      ...pos,
      market_value:prior.market_value+pos.market_value,
    });
  }
  return {
    name:String(input.name??"Scenario").trim()||"Scenario",
    cash:Math.max(0,n(input.cash)??0),
    cash_return_pct:n(input.cash_return_pct??input.cashReturnPct)??0,
    positions:[...merged.values()].sort((a,b)=>a.ticker.localeCompare(b.ticker)),
  };
}

function weightedMetric(positions,key){
  const invested=positions.reduce((s,p)=>s+p.market_value,0);
  const known=positions.filter(p=>n(p[key])!=null);
  const knownValue=known.reduce((s,p)=>s+p.market_value,0);
  if(!invested||!knownValue)return{value:null,coverage_pct:invested?0:100,covered_value:knownValue};
  const value=known.reduce((s,p)=>s+p.market_value*Number(p[key]),0)/knownValue;
  return{value:round(value,2),coverage_pct:round(knownValue/invested*100,1),covered_value:round(knownValue,2)};
}

function groupExposure(positions,totalValue){
  const map=new Map();
  for(const p of positions){
    const key=String(p.group??"Unclassified");
    map.set(key,(map.get(key)??0)+p.market_value);
  }
  return [...map.entries()].map(([group,value])=>({
    group,
    market_value:round(value,2),
    weight_pct:totalValue?round(value/totalValue*100,2):0,
  })).sort((a,b)=>b.market_value-a.market_value||a.group.localeCompare(b.group));
}

function readinessExposure(positions,totalValue){
  const out={building:0,research_ready:0,decision_ready:0};
  for(const p of positions)out[p.readiness_state]+=p.market_value;
  return Object.fromEntries(Object.entries(out).map(([k,v])=>[k,{
    market_value:round(v,2),
    weight_pct:totalValue?round(v/totalValue*100,2):0,
  }]));
}

function concentration(positions,totalValue){
  const invested=positions.reduce((s,p)=>s+p.market_value,0);
  const weighted=positions.map(p=>({
    ticker:p.ticker,
    market_value:p.market_value,
    weight_total:totalValue?p.market_value/totalValue:0,
    weight_invested:invested?p.market_value/invested:0,
  })).sort((a,b)=>b.market_value-a.market_value||a.ticker.localeCompare(b.ticker));
  const hhi=weighted.reduce((s,p)=>s+p.weight_invested*p.weight_invested,0);
  return {
    largest_position_pct:round((weighted[0]?.weight_total??0)*100,2),
    top_3_pct:round(weighted.slice(0,3).reduce((s,p)=>s+p.weight_total,0)*100,2),
    hhi_invested:round(hhi,4),
    effective_invested_positions:hhi>0?round(1/hhi,2):0,
    positions:weighted.map(p=>({
      ...p,
      weight_pct:round(p.weight_total*100,2),
      invested_weight_pct:round(p.weight_invested*100,2),
    })),
  };
}

function fairValueMark(portfolio,scenario){
  const key=scenario+"_value";
  const currentInvested=portfolio.positions.reduce((s,p)=>s+p.market_value,0);
  let coveredValue=0;
  let markedInvested=0;
  for(const p of portfolio.positions){
    const px=n(p.current_price),target=n(p[key]);
    if(px!=null&&px>0&&target!=null&&target>0){
      coveredValue+=p.market_value;
      markedInvested+=p.market_value*(target/px);
    }else{
      markedInvested+=p.market_value;
    }
  }
  const totalCurrent=portfolio.cash+currentInvested;
  const markedTotal=portfolio.cash+markedInvested;
  return {
    scenario,
    marked_total_value:round(markedTotal,2),
    change_pct:totalCurrent?round((markedTotal/totalCurrent-1)*100,2):null,
    coverage_pct:currentInvested?round(coveredValue/currentInvested*100,1):100,
    note:"Covered positions are repriced to the stored "+scenario+" fair value; uncovered positions remain at current market value. This is a valuation mark, not a time-based forecast.",
  };
}

export function evaluateGuardrails(analysis,constraints={}){
  const g={...DEFAULT_GUARDRAILS,...constraints};
  const checks=[];
  const add=(key,actual,limit,pass,kind,detail)=>checks.push({
    key,actual:round(actual,2),limit,pass:Boolean(pass),kind,detail,
    breach_amount:pass?0:round(kind==="max"?actual-limit:limit-actual,2),
  });

  add("max_position_pct",analysis.concentration.largest_position_pct,g.max_position_pct,
    analysis.concentration.largest_position_pct<=g.max_position_pct,"max",
    "Largest single-position weight.");
  add("max_group_pct",analysis.groups[0]?.weight_pct??0,g.max_group_pct,
    (analysis.groups[0]?.weight_pct??0)<=g.max_group_pct,"max",
    "Largest sector/industry-group weight.");
  add("min_cash_pct",analysis.cash_weight_pct,g.min_cash_pct,
    analysis.cash_weight_pct>=g.min_cash_pct,"min","Cash reserve weight.");
  add("max_building_pct",analysis.readiness.building.weight_pct,g.max_building_pct,
    analysis.readiness.building.weight_pct<=g.max_building_pct,"max",
    "Weight in companies still classified Building.");
  add("min_decision_ready_pct",analysis.readiness.decision_ready.weight_pct,g.min_decision_ready_pct,
    analysis.readiness.decision_ready.weight_pct>=g.min_decision_ready_pct,"min",
    "Weight supported by Decision Ready research.");

  const evidence=analysis.weighted_metrics.evidence_confidence_score.value;
  if(evidence==null){
    checks.push({
      key:"min_weighted_evidence_score",actual:null,limit:g.min_weighted_evidence_score,
      pass:false,kind:"min",detail:"Weighted evidence confidence is unavailable.",breach_amount:null
    });
  }else{
    add("min_weighted_evidence_score",evidence,g.min_weighted_evidence_score,
      evidence>=g.min_weighted_evidence_score,"min","Value-weighted evidence confidence.");
  }

  const passed=checks.filter(c=>c.pass).length;
  return{
    constraints:g,
    checks,
    passed,
    failed:checks.length-passed,
    pass_pct:checks.length?round(passed/checks.length*100,1):100,
  };
}

export function analyzePortfolio(input={},constraints={}){
  const portfolio=normalizePortfolio(input);
  const invested=portfolio.positions.reduce((s,p)=>s+p.market_value,0);
  const total=invested+portfolio.cash;
  const positions=portfolio.positions.map(p=>({
    ...p,
    weight_pct:total?round(p.market_value/total*100,2):0,
  })).sort((a,b)=>b.market_value-a.market_value||a.ticker.localeCompare(b.ticker));

  const weighted={
    decision_score:weightedMetric(positions,"decision_score"),
    business_quality_score:weightedMetric(positions,"business_quality_score"),
    investment_opportunity_score:weightedMetric(positions,"investment_opportunity_score"),
    evidence_confidence_score:weightedMetric(positions,"evidence_confidence_score"),
    base_5y_cagr:weightedMetric(positions,"base_5y_cagr"),
  };

  const investedBaseCagr=weighted.base_5y_cagr.value;
  const expectedReturnCoverage=weighted.base_5y_cagr.coverage_pct;
  const portfolioBaseCagr=total&&investedBaseCagr!=null&&expectedReturnCoverage===100
    ? ((invested/total)*investedBaseCagr)+((portfolio.cash/total)*portfolio.cash_return_pct)
    : null;

  const base={
    version:PORTFOLIO_SIMULATOR_VERSION,
    name:portfolio.name,
    total_value:round(total,2),
    invested_value:round(invested,2),
    cash_value:round(portfolio.cash,2),
    cash_weight_pct:total?round(portfolio.cash/total*100,2):0,
    cash_return_pct:round(portfolio.cash_return_pct,2),
    position_count:positions.length,
    positions,
    groups:groupExposure(positions,invested),
    readiness:readinessExposure(positions,invested),
    concentration:concentration(positions,total),
    weighted_metrics:weighted,
    portfolio_base_5y_cagr:round(portfolioBaseCagr,2),
    portfolio_base_5y_cagr_coverage_pct:expectedReturnCoverage,
    fair_value_marks:{
      bear:fairValueMark({...portfolio,positions},"bear"),
      base:fairValueMark({...portfolio,positions},"base"),
      bull:fairValueMark({...portfolio,positions},"bull"),
    },
  };
  return{...base,guardrails:evaluateGuardrails(base,constraints)};
}

function candidateMap(candidates=[]){
  const map=new Map();
  for(const raw of candidates){
    const p=normalizePosition({...raw,market_value:0});
    if(p.ticker)map.set(p.ticker,p);
  }
  return map;
}

export function simulateTrades({portfolio={},candidates=[],trades=[],constraints={}}={}){
  const normalized=normalizePortfolio(portfolio);
  const current=new Map(normalized.positions.map(p=>[p.ticker,{...p}]));
  const candidatesByTicker=candidateMap(candidates);
  const normalizedTrades=[];
  let netTradeAmount=0;

  for(const [index,raw] of (Array.isArray(trades)?trades:[]).entries()){
    const symbol=ticker(raw.ticker);
    const amount=n(raw.amount);
    if(!symbol)throw new Error("Trade "+(index+1)+" is missing ticker.");
    if(amount==null||amount===0)continue;
    const existing=current.get(symbol);
    if(amount<0&&(!existing||existing.market_value+amount<-.0001)){
      throw new Error("Trade "+symbol+" attempts to sell more than the current simulated position.");
    }
    if(amount>0&&!existing&&!candidatesByTicker.has(symbol)){
      throw new Error("Trade "+symbol+" requires candidate research metadata before adding a new position.");
    }
    const template=existing??candidatesByTicker.get(symbol);
    const nextValue=(existing?.market_value??0)+amount;
    if(nextValue<=.0001)current.delete(symbol);
    else current.set(symbol,{...template,market_value:nextValue});
    netTradeAmount+=amount;
    normalizedTrades.push({ticker:symbol,amount:round(amount,2),action:amount>0?"buy":"sell"});
  }

  const nextCash=normalized.cash-netTradeAmount;
  if(nextCash<-.0001){
    throw new Error("Simulated purchases exceed available cash by $"+round(Math.abs(nextCash),2)+".");
  }

  const before=analyzePortfolio(normalized,constraints);
  const after=analyzePortfolio({
    ...normalized,
    name:normalized.name+" · simulated",
    cash:Math.max(0,nextCash),
    positions:[...current.values()],
  },constraints);

  const delta=(a,b)=>a==null||b==null?null:round(b-a,2);
  return{
    version:PORTFOLIO_SIMULATOR_VERSION,
    trades:normalizedTrades,
    before,
    after,
    impact:{
      cash_weight_pct:delta(before.cash_weight_pct,after.cash_weight_pct),
      largest_position_pct:delta(before.concentration.largest_position_pct,after.concentration.largest_position_pct),
      top_3_pct:delta(before.concentration.top_3_pct,after.concentration.top_3_pct),
      decision_ready_pct:delta(before.readiness.decision_ready.weight_pct,after.readiness.decision_ready.weight_pct),
      building_pct:delta(before.readiness.building.weight_pct,after.readiness.building.weight_pct),
      weighted_decision_score:delta(before.weighted_metrics.decision_score.value,after.weighted_metrics.decision_score.value),
      weighted_evidence_score:delta(before.weighted_metrics.evidence_confidence_score.value,after.weighted_metrics.evidence_confidence_score.value),
      portfolio_base_5y_cagr:delta(before.portfolio_base_5y_cagr,after.portfolio_base_5y_cagr),
      base_fair_value_mark_pct:delta(before.fair_value_marks.base.change_pct,after.fair_value_marks.base.change_pct),
      guardrail_failures:after.guardrails.failed-before.guardrails.failed,
    },
  };
}

export function buildTradeScenario({portfolio={},candidate,amount,constraints={}}={}){
  const p=normalizePosition(candidate??{});
  if(!p.ticker)throw new Error("Candidate ticker is required.");
  return simulateTrades({
    portfolio,
    candidates:[p],
    trades:[{ticker:p.ticker,amount}],
    constraints,
  });
}

export function compareScenarioImpacts(scenarios=[]){
  return scenarios.map((scenario,index)=>({
    scenario:index+1,
    label:scenario?.after?.name??("Scenario "+(index+1)),
    trades:scenario?.trades??[],
    total_value:scenario?.after?.total_value??null,
    cash_weight_pct:scenario?.after?.cash_weight_pct??null,
    largest_position_pct:scenario?.after?.concentration?.largest_position_pct??null,
    decision_ready_pct:scenario?.after?.readiness?.decision_ready?.weight_pct??null,
    weighted_decision_score:scenario?.after?.weighted_metrics?.decision_score?.value??null,
    weighted_evidence_score:scenario?.after?.weighted_metrics?.evidence_confidence_score?.value??null,
    portfolio_base_5y_cagr:scenario?.after?.portfolio_base_5y_cagr??null,
    bear_mark_pct:scenario?.after?.fair_value_marks?.bear?.change_pct??null,
    base_mark_pct:scenario?.after?.fair_value_marks?.base?.change_pct??null,
    bull_mark_pct:scenario?.after?.fair_value_marks?.bull?.change_pct??null,
    guardrail_failures:scenario?.after?.guardrails?.failed??null,
  }));
}
