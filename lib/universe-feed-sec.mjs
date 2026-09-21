import {
  extractFiscalPeriods,
  normalizeCompanyFacts,
  quarterMetric,
} from "./sec-companyfacts.mjs";

const TAX_TAGS=[
  "IncomeTaxExpenseBenefit",
  "IncomeTaxExpenseBenefitContinuingOperations",
];
const PRETAX_TAGS=[
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxes",
];
const DA_TAGS=[
  "DepreciationDepletionAndAmortization",
  "DepreciationDepletionAndAmortizationPropertyPlantAndEquipment",
  "Depreciation",
];

const n=(v)=>{
  if(v===null||v===undefined||v==="")return null;
  const x=Number(v);
  return Number.isFinite(x)?x:null;
};
const sum=(values)=>{
  const xs=values.filter(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))).map(Number);
  return xs.length?xs.reduce((a,b)=>a+b,0):null;
};
const safeDiv=(a,b)=>n(a)!==null&&n(b)!==null&&Number(b)!==0?Number(a)/Number(b):null;
const pct=(a,b)=>{const x=safeDiv(a,b);return x===null?null:x*100;};
const cagr=(newer,older,years)=>{
  const a=n(newer),b=n(older);
  if(a===null||b===null||a<=0||b<=0||years<=0)return null;
  return (Math.pow(a/b,1/years)-1)*100;
};
const stddev=(values)=>{
  const xs=values.map(n).filter(v=>v!==null);
  if(xs.length<2)return null;
  const mean=xs.reduce((a,b)=>a+b,0)/xs.length;
  return Math.sqrt(xs.reduce((s,x)=>s+(x-mean)**2,0)/xs.length);
};

function quarterExtras(companyFacts){
  const byKey=new Map();
  for(const period of extractFiscalPeriods(companyFacts)){
    const tax=quarterMetric(companyFacts,TAX_TAGS,["USD"],period);
    const pretax=quarterMetric(companyFacts,PRETAX_TAGS,["USD"],period);
    const da=quarterMetric(companyFacts,DA_TAGS,["USD"],period);
    byKey.set([period.fy,period.fp,period.end].join("|"),{
      tax_expense:tax?.value??null,
      pretax_income:pretax?.value??null,
      depreciation_amortization:da?.value??null,
    });
  }
  return byKey;
}

function latestEntityShares(companyFacts){
  const units=companyFacts?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares;
  if(!Array.isArray(units))return null;
  const rows=units.filter(row=>n(row?.val)!==null&&row?.end);
  rows.sort((a,b)=>{
    const end=String(b.end).localeCompare(String(a.end));
    return end||String(b.filed??"").localeCompare(String(a.filed??""));
  });
  return n(rows[0]?.val);
}

function balance(row){
  return row?.raw_payload?.balance_sheet??{};
}
function income(row){
  return row?.raw_payload?.income??{};
}

function annualize(rows){
  const byYear=new Map();
  for(const row of rows){
    const fy=Number(row.fiscal_year);
    if(!Number.isInteger(fy))continue;
    const list=byYear.get(fy)??[];
    list.push(row);
    byYear.set(fy,list);
  }
  const out=[];
  for(const [fy,list] of byYear){
    list.sort((a,b)=>String(a.period_end).localeCompare(String(b.period_end)));
    const complete=["Q1","Q2","Q3","Q4"].every(fp=>list.some(r=>r.fiscal_period===fp));
    if(!complete)continue;
    const latest=list.at(-1);
    const revenue=sum(list.map(r=>n(r.revenue)));
    const netIncome=sum(list.map(r=>n(r.net_income)));
    const ocf=sum(list.map(r=>n(r.operating_cash_flow)));
    const fcf=sum(list.map(r=>n(r.free_cash_flow)));
    const opIncome=sum(list.map(r=>n(income(r).operatingIncome)));
    const interest=sum(list.map(r=>n(income(r).interestExpense)));
    const tax=sum(list.map(r=>n(r._universe_extra?.tax_expense)));
    const pretax=sum(list.map(r=>n(r._universe_extra?.pretax_income)));
    const da=sum(list.map(r=>n(r._universe_extra?.depreciation_amortization)));
    const shares=list.map(r=>n(r.shares_outstanding)).filter(v=>v!==null);
    const avgShares=shares.length?shares.reduce((a,b)=>a+b,0)/shares.length:null;
    const eps=netIncome!==null&&avgShares?netIncome/avgShares:null;
    out.push({
      fiscal_year:fy,
      period_end:latest?.period_end??null,
      revenue,
      net_income:netIncome,
      operating_cash_flow:ocf,
      free_cash_flow:fcf,
      operating_income:opIncome,
      interest_expense:interest,
      tax_expense:tax,
      pretax_income:pretax,
      depreciation_amortization:da,
      ebitda:opIncome!==null&&da!==null?opIncome+da:null,
      avg_diluted_shares:avgShares,
      eps,
      cash:n(balance(latest).cashAndCashEquivalents),
      total_debt:n(balance(latest).totalDebt),
      equity:n(balance(latest).stockholdersEquity),
      current_assets:n(balance(latest).currentAssets),
      current_liabilities:n(balance(latest).currentLiabilities),
    });
  }
  return out.sort((a,b)=>b.fiscal_year-a.fiscal_year);
}

function ttm(rows){
  const latest=rows.slice(0,4);
  if(latest.length<4)return null;
  const sumField=(getter)=>{
    const values=latest.map(getter);
    return values.every(v=>n(v)!==null)?values.reduce((a,b)=>a+Number(b),0):null;
  };
  return{
    revenue:sumField(r=>r.revenue),
    net_income:sumField(r=>r.net_income),
    operating_cash_flow:sumField(r=>r.operating_cash_flow),
    free_cash_flow:sumField(r=>r.free_cash_flow),
    operating_income:sumField(r=>income(r).operatingIncome),
    interest_expense:sumField(r=>income(r).interestExpense),
    tax_expense:sumField(r=>r._universe_extra?.tax_expense),
    pretax_income:sumField(r=>r._universe_extra?.pretax_income),
    depreciation_amortization:sumField(r=>r._universe_extra?.depreciation_amortization),
  };
}

function positiveCount(values,max=5){
  return values.slice(0,max).filter(v=>n(v)!==null&&Number(v)>0).length;
}
function positiveGrowthCount(values,maxComparisons=5){
  const xs=values.slice(0,maxComparisons+1);
  let count=0;
  for(let i=0;i<xs.length-1;i++){
    if(n(xs[i])!==null&&n(xs[i+1])!==null&&Number(xs[i])>Number(xs[i+1]))count++;
  }
  return count;
}

export function sectorFromSic(sic,description=""){
  const code=Number(sic);
  const text=String(description??"").toLowerCase();
  if(/pharma|biolog|biotech/.test(text))return{sector:"Health Care",industry:"Pharmaceuticals"};
  if(/medical|surgical|health|hospital/.test(text))return{sector:"Health Care",industry:description||"Healthcare"};
  if(/software|computer programming|prepackaged software|data processing/.test(text))return{sector:"Information Technology",industry:"Software"};
  if(/semiconductor|electronic component|computer.*equipment/.test(text))return{sector:"Information Technology",industry:description||"Technology"};
  if(/bank|credit|loan|insurance|broker|investment advice|security broker/.test(text))return{sector:"Financials",industry:description||"Financials"};
  if(/real estate investment trust|reit/.test(text)||code===6798)return{sector:"Real Estate",industry:"REIT"};
  if(/electric service|natural gas transmission|water supply|utility/.test(text)||code>=4900&&code<5000)return{sector:"Utilities",industry:description||"Utilities"};
  if(/oil|gas|petroleum|drilling/.test(text))return{sector:"Energy",industry:description||"Energy"};
  if(/mining|metal|chemical|paper|lumber/.test(text))return{sector:"Materials",industry:description||"Materials"};
  if(code>=5200&&code<6000)return{sector:"Consumer Discretionary",industry:description||"Retail"};
  if(code>=2000&&code<4000)return{sector:"Industrials",industry:description||"Manufacturing"};
  if(code>=4000&&code<4900)return{sector:"Industrials",industry:description||"Transportation"};
  if(code>=6000&&code<6800)return{sector:"Financials",industry:description||"Financials"};
  if(code>=7000&&code<9000)return{sector:"Services",industry:description||"Services"};
  return{sector:null,industry:description||null};
}

export function buildSecScreenFundamentals({
  companyFacts,
  ticker,
  cik,
  companyName,
  exchange,
  sic=null,
  sicDescription=null,
}={}){
  const normalized=normalizeCompanyFacts(companyFacts,{
    companyId:null,ticker,cik,observedAt:new Date(0).toISOString(),maxQuarters:44,
  });
  const extras=quarterExtras(companyFacts);
  const rows=normalized.map(row=>({
    ...row,
    _universe_extra:extras.get([row.fiscal_year,row.fiscal_period,row.period_end].join("|"))??{},
  })).sort((a,b)=>String(b.period_end).localeCompare(String(a.period_end)));
  if(!rows.length)return null;

  const annual=annualize(rows);
  const trailing=ttm(rows);
  const latest=rows[0];
  const yearAgo=rows[4]??null;
  const latestBalance=balance(latest);
  const yearAgoBalance=balance(yearAgo);

  const taxRate=trailing?.tax_expense!==null&&trailing?.pretax_income&&trailing.pretax_income>0
    ? trailing.tax_expense/trailing.pretax_income
    : null;
  const validTaxRate=taxRate!==null&&taxRate>=0&&taxRate<=0.6?taxRate:null;
  const invested=(b)=>{
    const equity=n(b?.stockholdersEquity),debt=n(b?.totalDebt),cash=n(b?.cashAndCashEquivalents);
    return equity!==null&&debt!==null?equity+debt-(cash??0):null;
  };
  const investedNow=invested(latestBalance),investedAgo=invested(yearAgoBalance);
  const avgInvested=investedNow!==null&&investedAgo!==null?(investedNow+investedAgo)/2:investedNow;
  const roic=trailing?.operating_income!==null&&validTaxRate!==null&&avgInvested&&avgInvested>0
    ? trailing.operating_income*(1-validTaxRate)/avgInvested*100
    : null;

  const annualRevenue=annual.map(x=>x.revenue);
  const annualFcf=annual.map(x=>x.free_cash_flow);
  const annualEps=annual.map(x=>x.eps);
  const annualMargins=annual.map(x=>pct(x.operating_income,x.revenue));
  const latestAnnual=annual[0]??null;
  const annual3=annual[3]??null;

  const roe=trailing?.net_income!==null&&n(latestBalance.stockholdersEquity)>0
    ? trailing.net_income/n(latestBalance.stockholdersEquity)*100
    : null;
  const ebitda=trailing?.operating_income!==null&&trailing?.depreciation_amortization!==null
    ? trailing.operating_income+trailing.depreciation_amortization
    : null;
  const debt=n(latestBalance.totalDebt),cash=n(latestBalance.cashAndCashEquivalents);
  const netDebtToEbitda=ebitda&&ebitda>0&&debt!==null?(debt-(cash??0))/ebitda:null;
  const interestCoverage=trailing?.operating_income!==null&&trailing?.interest_expense&&trailing.interest_expense!==0
    ? trailing.operating_income/Math.abs(trailing.interest_expense)
    : null;
  const currentAssets=n(latestBalance.currentAssets),currentLiabilities=n(latestBalance.currentLiabilities);
  const currentRatio=currentAssets!==null&&currentLiabilities!==null&&currentLiabilities>0
    ? currentAssets/currentLiabilities
    : null;

  const sharesCurrent=latestEntityShares(companyFacts)??n(latest.shares_outstanding);
  const shares3y=annual3?.avg_diluted_shares??null;
  const sectorInfo=sectorFromSic(sic,sicDescription??"");

  return{
    ticker:String(ticker??"").toUpperCase(),
    company_name:companyName??companyFacts?.entityName??ticker,
    exchange:exchange??null,
    sector:sectorInfo.sector,
    industry:sectorInfo.industry,
    cik:String(cik??companyFacts?.cik??"").replace(/\D/g,"").padStart(10,"0"),
    sic:sic?String(sic):null,
    sic_description:sicDescription??null,
    revenue_ttm:trailing?.revenue??null,
    roic,
    roe,
    fcf_margin:pct(trailing?.free_cash_flow,trailing?.revenue),
    cash_conversion_pct:pct(trailing?.operating_cash_flow,trailing?.net_income),
    operating_margin:pct(trailing?.operating_income,trailing?.revenue),
    positive_fcf_years:positiveCount(annualFcf),
    positive_eps_years:positiveCount(annualEps),
    positive_revenue_growth_years:positiveGrowthCount(annualRevenue),
    operating_margin_volatility_pct:stddev(annualMargins.slice(0,5)),
    share_dilution_3y_pct:sharesCurrent&&shares3y&&shares3y>0?(sharesCurrent/shares3y-1)*100:null,
    net_debt_to_ebitda:netDebtToEbitda,
    debt_to_equity:n(latestBalance.stockholdersEquity)>0&&debt!==null?debt/n(latestBalance.stockholdersEquity):null,
    interest_coverage:interestCoverage,
    current_ratio:currentRatio,
    revenue_growth_3y_cagr:latestAnnual&&annual3?cagr(latestAnnual.revenue,annual3.revenue,3):null,
    eps_growth_3y_cagr:latestAnnual&&annual3?cagr(latestAnnual.eps,annual3.eps,3):null,
    fcf_growth_3y_cagr:latestAnnual&&annual3?cagr(latestAnnual.free_cash_flow,annual3.free_cash_flow,3):null,
    shares_outstanding_latest:sharesCurrent,
    latest_fundamental_period:latest.period_end??null,
    latest_filed_at:latest.filed_at??null,
    price:null,
    market_cap:null,
    avg_dollar_volume_30d:null,
    price_to_fcf:null,
    fcf_yield_pct:null,
    forward_pe:null,
    ev_to_ebitda:null,
    peg_ratio:null,
    bankruptcy_flag:null,
    going_concern_flag:null,
    _sec_internal:{
      free_cash_flow_ttm:trailing?.free_cash_flow??null,
      ebitda_ttm:ebitda,
      total_debt:debt,
      cash,
      source:"SEC EDGAR companyfacts",
    },
  };
}

export function marketMetricsFromYahooChart(chartResult){
  const timestamps=chartResult?.timestamp??[];
  const quote=chartResult?.indicators?.quote?.[0]??{};
  const closes=quote.close??[];
  const volumes=quote.volume??[];
  const sessions=[];
  for(let i=0;i<timestamps.length;i++){
    const price=n(closes[i]),volume=n(volumes[i]);
    if(price===null||volume===null||price<=0||volume<0)continue;
    sessions.push({
      date:new Date(Number(timestamps[i])*1000).toISOString().slice(0,10),
      price,volume,dollarVolume:price*volume,
    });
  }
  sessions.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const recent=sessions.slice(0,30);
  return{
    price:recent[0]?.price??null,
    market_date:recent[0]?.date??null,
    avg_dollar_volume_30d:recent.length>=20
      ? recent.reduce((s,r)=>s+r.dollarVolume,0)/recent.length
      : null,
    observed_sessions:recent.length,
  };
}

export function mergeSecMarketMetrics(row,market){
  const price=n(market?.price);
  const shares=n(row?.shares_outstanding_latest);
  const marketCap=price!==null&&shares!==null&&shares>0?price*shares:null;
  const fcf=n(row?._sec_internal?.free_cash_flow_ttm);
  const ebitda=n(row?._sec_internal?.ebitda_ttm);
  const debt=n(row?._sec_internal?.total_debt),cash=n(row?._sec_internal?.cash);
  return{
    ...row,
    price,
    market_cap:marketCap,
    avg_dollar_volume_30d:n(market?.avg_dollar_volume_30d),
    price_to_fcf:marketCap!==null&&fcf!==null&&fcf>0?marketCap/fcf:null,
    fcf_yield_pct:marketCap!==null&&marketCap>0&&fcf!==null?fcf/marketCap*100:null,
    ev_to_ebitda:marketCap!==null&&ebitda!==null&&ebitda>0
      ?(marketCap+(debt??0)-(cash??0))/ebitda
      :null,
    _market_metadata:{
      provider:"yahoo-chart-history",
      temporary_source:true,
      market_date:market?.market_date??null,
      observed_sessions:market?.observed_sessions??0,
      market_cap_basis:"latest SEC shares × Yahoo close",
    },
  };
}
