export const UNIVERSE_SCREENING_VERSION="solpient-universe-screen-v1";
export const UNIVERSE_SELECTION_VERSION="solpient-100-selection-v1";

export const SCREEN_STATE=Object.freeze({
  EXCLUDED:"excluded",
  WATCH:"watch",
  RESEARCH_CANDIDATE:"research_candidate",
  SOLPIENT_100_CANDIDATE:"solpient_100_candidate",
  SOLPIENT_100:"solpient_100",
});

const n=(v)=>{
  if(v===null||v===undefined||v==="")return null;
  const x=Number(v);
  return Number.isFinite(x)?x:null;
};
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,v));
const round1=(v)=>v==null?null:Math.round(v*10)/10;

function linearHigher(value,bad,good){
  const x=n(value);
  if(x==null)return null;
  if(good===bad)return x>=good?100:0;
  return clamp((x-bad)/(good-bad)*100);
}
function linearLower(value,bad,good){
  const x=n(value);
  if(x==null)return null;
  if(bad===good)return x<=good?100:0;
  return clamp((bad-x)/(bad-good)*100);
}
function positiveYearsScore(value,target=5){
  const x=n(value);
  if(x==null)return null;
  return clamp(x/target*100);
}
function weighted(components={}){
  const rows=Object.entries(components).map(([key,v])=>({
    key,
    value:n(v?.value),
    weight:Number(v?.weight??0),
    note:v?.note??null,
  }));
  const intended=rows.reduce((s,r)=>s+Math.max(0,r.weight),0);
  const available=rows.filter(r=>r.value!=null&&r.weight>0);
  const availableWeight=available.reduce((s,r)=>s+r.weight,0);
  if(!intended||!availableWeight)return{
    score:null,coveragePct:0,missing:rows.filter(r=>r.weight>0).map(r=>r.key),contributions:[]
  };
  return{
    score:round1(available.reduce((s,r)=>s+clamp(r.value)*r.weight,0)/availableWeight),
    coveragePct:round1(availableWeight/intended*100),
    missing:rows.filter(r=>r.weight>0&&r.value==null).map(r=>r.key),
    contributions:available.map(r=>({
      key:r.key,value:round1(r.value),weight:r.weight,
      effectiveWeightPct:round1(r.weight/availableWeight*100),note:r.note,
    })),
  };
}

export const PROFILE_ALIASES=Object.freeze({
  "information technology":"software",
  "technology":"software",
  "software":"software",
  "internet":"software",
  "consumer discretionary":"consumer",
  "consumer staples":"consumer",
  "retail":"consumer",
  "industrials":"industrial",
  "industrial":"industrial",
  "health care":"healthcare",
  "healthcare":"healthcare",
  "medical devices":"healthcare",
  "biotechnology":"biopharma",
  "pharmaceuticals":"biopharma",
  "biopharma":"biopharma",
  "financials":"financial",
  "banks":"financial",
  "banking":"financial",
  "real estate":"reit",
  "reit":"reit",
  "utilities":"utility",
  "energy":"cyclical",
  "materials":"cyclical",
});

export const SCREEN_PROFILES=Object.freeze({
  general:{
    minMarketCap:500_000_000,minDollarVolume:2_000_000,minPrice:2,
    dimensions:{quality:35,durability:20,balanceSheet:15,growth:15,valuation:15},
    valuationMetric:"price_to_fcf",
  },
  software:{
    minMarketCap:750_000_000,minDollarVolume:3_000_000,minPrice:2,
    dimensions:{quality:38,durability:18,balanceSheet:12,growth:20,valuation:12},
    valuationMetric:"price_to_fcf",
  },
  consumer:{
    minMarketCap:500_000_000,minDollarVolume:2_000_000,minPrice:2,
    dimensions:{quality:35,durability:22,balanceSheet:15,growth:13,valuation:15},
    valuationMetric:"price_to_fcf",
  },
  industrial:{
    minMarketCap:500_000_000,minDollarVolume:2_000_000,minPrice:2,
    dimensions:{quality:32,durability:22,balanceSheet:18,growth:13,valuation:15},
    valuationMetric:"ev_to_ebitda",
  },
  healthcare:{
    minMarketCap:500_000_000,minDollarVolume:2_000_000,minPrice:2,
    dimensions:{quality:35,durability:18,balanceSheet:15,growth:17,valuation:15},
    valuationMetric:"price_to_fcf",
  },
  biopharma:{
    minMarketCap:1_000_000_000,minDollarVolume:3_000_000,minPrice:2,
    dimensions:{quality:30,durability:20,balanceSheet:18,growth:17,valuation:15},
    valuationMetric:"forward_pe",
    requireCommercialScale:true,
  },
  financial:{
    minMarketCap:1_000_000_000,minDollarVolume:3_000_000,minPrice:2,
    dimensions:{quality:35,durability:22,balanceSheet:18,growth:10,valuation:15},
    valuationMetric:"price_to_tangible_book",
    ignoreCorporateDebt:true,
  },
  reit:{
    minMarketCap:1_000_000_000,minDollarVolume:2_000_000,minPrice:2,
    dimensions:{quality:28,durability:25,balanceSheet:20,growth:10,valuation:17},
    valuationMetric:"price_to_affo",
  },
  utility:{
    minMarketCap:1_000_000_000,minDollarVolume:2_000_000,minPrice:2,
    dimensions:{quality:28,durability:27,balanceSheet:20,growth:8,valuation:17},
    valuationMetric:"forward_pe",
  },
  cyclical:{
    minMarketCap:1_000_000_000,minDollarVolume:3_000_000,minPrice:2,
    dimensions:{quality:28,durability:27,balanceSheet:20,growth:10,valuation:15},
    valuationMetric:"ev_to_ebitda",
  },
});

export function resolveScreenProfile(row={}){
  const explicit=String(row.screen_profile??"").trim().toLowerCase();
  if(explicit&&SCREEN_PROFILES[explicit])return explicit;
  const sector=String(row.sector??"").trim().toLowerCase();
  const industry=String(row.industry??"").trim().toLowerCase();
  for(const key of [industry,sector]){
    if(PROFILE_ALIASES[key])return PROFILE_ALIASES[key];
    for(const [needle,profile] of Object.entries(PROFILE_ALIASES)){
      if(key.includes(needle))return profile;
    }
  }
  return "general";
}

function qualityComponents(row,profile){
  if(profile==="financial"){
    return{
      roe:{value:linearHigher(row.roe,5,18),weight:35,note:"ROE adjusted for financial-sector economics."},
      earnings_quality:{value:positiveYearsScore(row.positive_eps_years,5),weight:25},
      efficiency:{value:linearLower(row.efficiency_ratio,70,45),weight:20},
      asset_quality:{value:linearLower(row.nonperforming_assets_pct,3,.5),weight:20},
    };
  }
  if(profile==="reit"){
    return{
      return_on_capital:{value:linearHigher(row.roic,2,10),weight:20},
      affo_margin:{value:linearHigher(row.affo_margin,15,45),weight:35},
      fcf_conversion:{value:linearHigher(row.cash_conversion_pct,50,100),weight:20},
      operating_margin:{value:linearHigher(row.operating_margin,10,40),weight:25},
    };
  }
  return{
    roic:{value:linearHigher(row.roic,0,20),weight:30},
    roe:{value:linearHigher(row.roe,5,25),weight:15},
    fcf_margin:{value:linearHigher(row.fcf_margin,0,20),weight:25},
    cash_conversion:{value:linearHigher(row.cash_conversion_pct,50,110),weight:15},
    operating_margin:{value:linearHigher(row.operating_margin,5,25),weight:15},
  };
}

function durabilityComponents(row,profile){
  const common={
    positive_fcf_years:{value:positiveYearsScore(row.positive_fcf_years,5),weight:30},
    positive_eps_years:{value:positiveYearsScore(row.positive_eps_years,5),weight:25},
    revenue_consistency:{value:positiveYearsScore(row.positive_revenue_growth_years,5),weight:20},
    margin_stability:{value:linearLower(row.operating_margin_volatility_pct,12,3),weight:15},
    dilution:{value:linearLower(row.share_dilution_3y_pct,10,0),weight:10},
  };
  if(profile==="financial"){
    return{
      positive_eps_years:{value:positiveYearsScore(row.positive_eps_years,5),weight:45},
      book_value_growth_years:{value:positiveYearsScore(row.positive_book_value_growth_years,5),weight:25},
      credit_loss_stability:{value:linearLower(row.credit_loss_volatility_pct,4,.5),weight:20},
      dilution:{value:linearLower(row.share_dilution_3y_pct,10,0),weight:10},
    };
  }
  if(profile==="cyclical"){
    common.positive_fcf_years.weight=40;
    common.revenue_consistency.weight=10;
  }
  return common;
}

function balanceSheetComponents(row,profile){
  if(profile==="financial"){
    return{
      capital_ratio:{value:linearHigher(row.cet1_ratio,8,14),weight:45},
      tangible_equity:{value:linearHigher(row.tangible_common_equity_ratio,5,10),weight:25},
      liquidity:{value:linearHigher(row.liquidity_coverage_ratio,100,140),weight:20},
      payout:{value:linearLower(row.payout_ratio,80,30),weight:10},
    };
  }
  if(profile==="reit"){
    return{
      net_debt_ebitda:{value:linearLower(row.net_debt_to_ebitda,7,3),weight:45},
      interest_coverage:{value:linearHigher(row.interest_coverage,1.5,5),weight:30},
      fixed_charge:{value:linearHigher(row.fixed_charge_coverage,1.3,3),weight:25},
    };
  }
  if(profile==="utility"){
    return{
      debt_ebitda:{value:linearLower(row.net_debt_to_ebitda,6,3),weight:45},
      interest_coverage:{value:linearHigher(row.interest_coverage,1.5,5),weight:35},
      current_ratio:{value:linearHigher(row.current_ratio,.5,1.5),weight:20},
    };
  }
  return{
    net_debt_ebitda:{value:linearLower(row.net_debt_to_ebitda,4,0),weight:35},
    debt_to_equity:{value:linearLower(row.debt_to_equity,2,.2),weight:20},
    interest_coverage:{value:linearHigher(row.interest_coverage,2,12),weight:30},
    current_ratio:{value:linearHigher(row.current_ratio,.75,2),weight:15},
  };
}

function growthComponents(row,profile){
  if(profile==="financial"){
    return{
      eps_growth_3y:{value:linearHigher(row.eps_growth_3y_cagr,-5,15),weight:45},
      book_growth_3y:{value:linearHigher(row.book_value_growth_3y_cagr,0,12),weight:30},
      revenue_growth_3y:{value:linearHigher(row.revenue_growth_3y_cagr,-3,12),weight:25},
    };
  }
  if(profile==="reit"){
    return{
      affo_growth_3y:{value:linearHigher(row.affo_growth_3y_cagr,-3,10),weight:45},
      revenue_growth_3y:{value:linearHigher(row.revenue_growth_3y_cagr,-3,10),weight:25},
      fcf_growth_3y:{value:linearHigher(row.fcf_growth_3y_cagr,-5,12),weight:30},
    };
  }
  return{
    revenue_growth_3y:{value:linearHigher(row.revenue_growth_3y_cagr,-5,15),weight:35},
    eps_growth_3y:{value:linearHigher(row.eps_growth_3y_cagr,-10,20),weight:35},
    fcf_growth_3y:{value:linearHigher(row.fcf_growth_3y_cagr,-10,20),weight:30},
  };
}

function valuationComponents(row,profile){
  if(profile==="financial"){
    return{
      forward_pe:{value:linearLower(row.forward_pe,24,8),weight:45},
      price_to_tangible_book:{value:linearLower(row.price_to_tangible_book,3.5,1),weight:35},
      peg:{value:linearLower(row.peg_ratio,3,1),weight:20},
    };
  }
  if(profile==="reit"){
    return{
      price_to_affo:{value:linearLower(row.price_to_affo,28,12),weight:50},
      forward_pe:{value:linearLower(row.forward_pe,30,12),weight:20},
      fcf_yield:{value:linearHigher(row.fcf_yield_pct,2,8),weight:30},
    };
  }
  if(profile==="industrial"||profile==="cyclical"){
    return{
      ev_ebitda:{value:linearLower(row.ev_to_ebitda,20,7),weight:45},
      price_to_fcf:{value:linearLower(row.price_to_fcf,35,12),weight:35},
      peg:{value:linearLower(row.peg_ratio,3,1),weight:20},
    };
  }
  return{
    price_to_fcf:{value:linearLower(row.price_to_fcf,40,12),weight:35},
    forward_pe:{value:linearLower(row.forward_pe,35,12),weight:30},
    ev_ebitda:{value:linearLower(row.ev_to_ebitda,25,8),weight:20},
    peg:{value:linearLower(row.peg_ratio,3,1),weight:15},
  };
}

function hardGates(row,profileName,profile){
  const gates=[];
  const add=(key,pass,reason,actual,target)=>gates.push({key,pass:Boolean(pass),reason,actual:actual??null,target});
  const marketCap=n(row.market_cap);
  const dollarVolume=n(row.avg_dollar_volume_30d);
  const price=n(row.price);
  add("market_cap",marketCap!=null&&marketCap>=profile.minMarketCap,
      "Minimum market capitalization for an investable research universe.",marketCap,profile.minMarketCap);
  add("liquidity",dollarVolume!=null&&dollarVolume>=profile.minDollarVolume,
      "Minimum 30-day average dollar trading volume.",dollarVolume,profile.minDollarVolume);
  add("price",price!=null&&price>=profile.minPrice,
      "Avoid penny-stock/micro-price screening noise.",price,profile.minPrice);
  add("going_concern",row.going_concern_flag!==true,
      "Going-concern warnings require special-situation analysis outside the core screen.",row.going_concern_flag,false);
  add("bankruptcy",row.bankruptcy_flag!==true,
      "Bankruptcy/restructuring situations are outside the core Solpient 100 screen.",row.bankruptcy_flag,false);

  if(profile.requireCommercialScale){
    const revenue=n(row.revenue_ttm);
    add("commercial_scale",revenue!=null&&revenue>=500_000_000,
        "Mature biopharma screen requires commercial-scale revenue.",revenue,500_000_000);
  }
  if(!profile.ignoreCorporateDebt&&profileName!=="reit"&&profileName!=="utility"){
    const nde=n(row.net_debt_to_ebitda);
    if(nde!=null)add("leverage_extreme",nde<=8,
      "Extreme leverage fails the core long-term quality screen.",nde,8);
  }
  return gates;
}

function profileDimensions(row,profileName){
  const profile=SCREEN_PROFILES[profileName];
  return{
    quality:weighted(qualityComponents(row,profileName)),
    durability:weighted(durabilityComponents(row,profileName)),
    balanceSheet:weighted(balanceSheetComponents(row,profileName)),
    growth:weighted(growthComponents(row,profileName)),
    valuation:weighted(valuationComponents(row,profileName)),
    profile,
  };
}

function evidenceCoverage(dimensions){
  const w=dimensions.profile.dimensions;
  const intended=Object.values(w).reduce((a,b)=>a+b,0);
  const covered=
    dimensions.quality.coveragePct/100*w.quality+
    dimensions.durability.coveragePct/100*w.durability+
    dimensions.balanceSheet.coveragePct/100*w.balanceSheet+
    dimensions.growth.coveragePct/100*w.growth+
    dimensions.valuation.coveragePct/100*w.valuation;
  return round1(covered/intended*100);
}

function overallScore(dimensions){
  const w=dimensions.profile.dimensions;
  const rows=[
    [dimensions.quality,w.quality],
    [dimensions.durability,w.durability],
    [dimensions.balanceSheet,w.balanceSheet],
    [dimensions.growth,w.growth],
    [dimensions.valuation,w.valuation],
  ];
  const available=rows.filter(([d])=>d.score!=null);
  if(!available.length)return null;
  const total=available.reduce((s,[,weight])=>s+weight,0);
  return round1(available.reduce((s,[d,weight])=>s+d.score*weight,0)/total);
}

function qualityCore(dimensions){
  const rows=[
    [dimensions.quality,45],
    [dimensions.durability,25],
    [dimensions.balanceSheet,20],
    [dimensions.growth,10],
  ].filter(([d])=>d.score!=null);
  if(!rows.length)return null;
  const total=rows.reduce((s,[,w])=>s+w,0);
  return round1(rows.reduce((s,[d,w])=>s+d.score*w,0)/total);
}

function determineState({gates,score,qualityScore,coverage,approvedMember=false}){
  if(gates.some(g=>!g.pass))return SCREEN_STATE.EXCLUDED;
  if(approvedMember&&coverage>=60&&qualityScore>=60)return SCREEN_STATE.SOLPIENT_100;
  if(coverage<55||score==null||qualityScore==null)return SCREEN_STATE.WATCH;
  if(score>=75&&qualityScore>=72&&coverage>=70)return SCREEN_STATE.SOLPIENT_100_CANDIDATE;
  if(score>=60&&qualityScore>=60&&coverage>=60)return SCREEN_STATE.RESEARCH_CANDIDATE;
  return SCREEN_STATE.WATCH;
}

function reasonsFor(result){
  const positives=[];
  const concerns=[];
  const dims=[
    ["Quality",result.dimensions.quality.score],
    ["Durability",result.dimensions.durability.score],
    ["Balance sheet",result.dimensions.balanceSheet.score],
    ["Growth",result.dimensions.growth.score],
    ["Valuation",result.dimensions.valuation.score],
  ];
  for(const [label,score] of dims){
    if(score==null)concerns.push(label+" evidence is incomplete.");
    else if(score>=80)positives.push(label+" is a screening strength ("+round1(score)+").");
    else if(score<45)concerns.push(label+" is weak ("+round1(score)+").");
  }
  for(const gate of result.gates.filter(g=>!g.pass))concerns.push(gate.reason);
  if(result.evidenceCoveragePct<70)concerns.push("Screening evidence coverage is only "+result.evidenceCoveragePct+"%.");
  return{positives:positives.slice(0,4),concerns:concerns.slice(0,5)};
}

export function screenCompany(row={}){
  const profileName=resolveScreenProfile(row);
  const profile=SCREEN_PROFILES[profileName];
  const gates=hardGates(row,profileName,profile);
  const dimensions=profileDimensions(row,profileName);
  const coverage=evidenceCoverage(dimensions);
  const score=overallScore(dimensions);
  const qualityScore=qualityCore(dimensions);
  const state=determineState({
    gates,score,qualityScore,coverage,approvedMember:row.approved_solpient_100===true
  });
  const result={
    methodologyVersion:UNIVERSE_SCREENING_VERSION,
    ticker:String(row.ticker??"").toUpperCase(),
    companyName:row.company_name??row.companyName??null,
    sector:row.sector??null,
    industry:row.industry??null,
    profile:profileName,
    screenScore:score,
    qualityCoreScore:qualityScore,
    evidenceCoveragePct:coverage,
    state,
    gates,
    dimensions:{
      quality:dimensions.quality,
      durability:dimensions.durability,
      balanceSheet:dimensions.balanceSheet,
      growth:dimensions.growth,
      valuation:dimensions.valuation,
    },
    input:{
      marketCap:n(row.market_cap),
      avgDollarVolume30d:n(row.avg_dollar_volume_30d),
      price:n(row.price),
    },
  };
  return{...result,reasons:reasonsFor(result)};
}

export function rankUniverse(rows=[]){
  const screened=rows.map(screenCompany);
  const stateTier={
    [SCREEN_STATE.SOLPIENT_100]:4,
    [SCREEN_STATE.SOLPIENT_100_CANDIDATE]:3,
    [SCREEN_STATE.RESEARCH_CANDIDATE]:2,
    [SCREEN_STATE.WATCH]:1,
    [SCREEN_STATE.EXCLUDED]:0,
  };
  screened.sort((a,b)=>
    (stateTier[b.state]-stateTier[a.state])||
    ((b.screenScore??-1)-(a.screenScore??-1))||
    ((b.qualityCoreScore??-1)-(a.qualityCoreScore??-1))||
    ((b.evidenceCoveragePct??-1)-(a.evidenceCoveragePct??-1))||
    a.ticker.localeCompare(b.ticker)
  );
  return screened.map((row,index)=>({...row,universeRank:index+1}));
}

export function selectSolpient100Candidates(rows=[],{limit=100}={}){
  const ranked=rankUniverse(rows);
  const eligible=ranked.filter(r=>
    [SCREEN_STATE.SOLPIENT_100,SCREEN_STATE.SOLPIENT_100_CANDIDATE,SCREEN_STATE.RESEARCH_CANDIDATE].includes(r.state)
  );
  const selected=eligible.slice(0,Math.max(0,limit));
  const selectedTickers=new Set(selected.map(r=>r.ticker));
  return ranked.map(row=>({
    ...row,
    shortlistRank:selectedTickers.has(row.ticker)?selected.findIndex(r=>r.ticker===row.ticker)+1:null,
    proposedForDeepResearch:selectedTickers.has(row.ticker),
    finalMembershipRequiresReview:row.state!==SCREEN_STATE.SOLPIENT_100,
  }));
}

export function stateLabel(state){
  if(state===SCREEN_STATE.SOLPIENT_100)return "Solpient 100";
  if(state===SCREEN_STATE.SOLPIENT_100_CANDIDATE)return "Solpient 100 Candidate";
  if(state===SCREEN_STATE.RESEARCH_CANDIDATE)return "Research Candidate";
  if(state===SCREEN_STATE.WATCH)return "Watch";
  return "Excluded";
}
