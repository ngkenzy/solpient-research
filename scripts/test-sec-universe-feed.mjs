import assert from "node:assert/strict";
import {
  buildSecScreenFundamentals,
  marketMetricsFromYahooChart,
  mergeSecMarketMetrics,
} from "../lib/universe-feed-sec.mjs";
import { screenCompany } from "../lib/universe-screening-engine.mjs";

const facts={cik:"0000000001",entityName:"Fixture Software",facts:{"us-gaap":{},dei:{EntityCommonStockSharesOutstanding:{units:{shares:[]}}}}};
function add(tag,unit,row){
  facts.facts["us-gaap"][tag]??={units:{}};
  facts.facts["us-gaap"][tag].units[unit]??=[];
  facts.facts["us-gaap"][tag].units[unit].push(row);
}
function addInstant(tag,year,fp,end,val){
  add(tag,"USD",{fy:year,fp,end,val,form:fp==="FY"?"10-K":"10-Q",filed:end});
}
const quarterEnds=[["Q1","03-31"],["Q2","06-30"],["Q3","09-30"]];
for(let year=2022;year<=2025;year++){
  const scale=1+(year-2022)*0.12;
  const quarters=[
    {fp:"Q1",start:`${year}-01-01`,end:`${year}-03-31`,rev:900e6*scale,ni:140e6*scale,ocf:190e6*scale,capex:35e6,op:210e6*scale,tax:35e6*scale,pretax:175e6*scale,da:25e6},
    {fp:"Q2",start:`${year}-04-01`,end:`${year}-06-30`,rev:950e6*scale,ni:150e6*scale,ocf:200e6*scale,capex:36e6,op:220e6*scale,tax:38e6*scale,pretax:188e6*scale,da:26e6},
    {fp:"Q3",start:`${year}-07-01`,end:`${year}-09-30`,rev:1000e6*scale,ni:160e6*scale,ocf:215e6*scale,capex:37e6,op:235e6*scale,tax:40e6*scale,pretax:200e6*scale,da:27e6},
    {fp:"Q4",start:`${year}-10-01`,end:`${year}-12-31`,rev:1050e6*scale,ni:170e6*scale,ocf:225e6*scale,capex:38e6,op:245e6*scale,tax:42e6*scale,pretax:212e6*scale,da:28e6},
  ];
  const durationTags=[
    ["RevenueFromContractWithCustomerExcludingAssessedTax","USD","rev"],
    ["NetIncomeLoss","USD","ni"],
    ["NetCashProvidedByUsedInOperatingActivities","USD","ocf"],
    ["PaymentsToAcquirePropertyPlantAndEquipment","USD","capex"],
    ["OperatingIncomeLoss","USD","op"],
    ["InterestExpenseNonOperating","USD",()=>25e6],
    ["IncomeTaxExpenseBenefit","USD","tax"],
    ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest","USD","pretax"],
    ["DepreciationDepletionAndAmortization","USD","da"],
  ];
  for(const q of quarters.slice(0,3)){
    for(const [tag,unit,key] of durationTags){
      const val=typeof key==="function"?key():q[key];
      add(tag,unit,{fy:year,fp:q.fp,start:q.start,end:q.end,val,form:"10-Q",filed:q.end});
    }
    add("WeightedAverageNumberOfDilutedSharesOutstanding","shares",{fy:year,fp:q.fp,start:q.start,end:q.end,val:100e6,form:"10-Q",filed:q.end});
    add("EarningsPerShareDiluted","USD/shares",{fy:year,fp:q.fp,start:q.start,end:q.end,val:q.ni/100e6,form:"10-Q",filed:q.end});
  }
  for(const [tag,unit,key] of durationTags){
    const annual=quarters.reduce((s,q)=>s+(typeof key==="function"?key():q[key]),0);
    add(tag,unit,{fy:year,fp:"FY",start:`${year}-01-01`,end:`${year}-12-31`,val:annual,form:"10-K",filed:`${year}-12-31`});
  }
  add("WeightedAverageNumberOfDilutedSharesOutstanding","shares",{fy:year,fp:"FY",start:`${year}-10-01`,end:`${year}-12-31`,val:100e6,form:"10-K",filed:`${year}-12-31`});
  add("EarningsPerShareDiluted","USD/shares",{fy:year,fp:"FY",start:`${year}-10-01`,end:`${year}-12-31`,val:quarters[3].ni/100e6,form:"10-K",filed:`${year}-12-31`});

  for(const [fp,suffix] of [...quarterEnds,["FY","12-31"]]){
    const end=`${year}-${suffix}`;
    addInstant("CashAndCashEquivalentsAtCarryingValue",year,fp,end,700e6);
    addInstant("AssetsCurrent",year,fp,end,1800e6);
    addInstant("LiabilitiesCurrent",year,fp,end,700e6);
    addInstant("StockholdersEquity",year,fp,end,3200e6);
    addInstant("LongTermDebt",year,fp,end,500e6);
  }
}
facts.facts.dei.EntityCommonStockSharesOutstanding.units.shares.push({
  end:"2025-12-31",val:100e6,form:"10-K",filed:"2025-12-31"
});

const fundamental=buildSecScreenFundamentals({
  companyFacts:facts,ticker:"TEST",cik:"1",companyName:"Fixture Software",exchange:"Nasdaq",
  sic:7372,sicDescription:"SERVICES-PREPACKAGED SOFTWARE",
});
assert.ok(fundamental);
assert.equal(fundamental.sector,"Information Technology");
assert.equal(fundamental.industry,"Software & IT Services");
assert.equal(fundamental.screen_profile,"software");
assert.equal(fundamental.sector_taxonomy_version,"solpient-universe-sector-model-v2.3");
assert.equal(fundamental.sector_classification_method,"base_v2");
assert.ok(fundamental.revenue_ttm>0);
assert.ok(fundamental.fcf_margin>10);
assert.ok(fundamental.roic>0);
assert.ok(fundamental.positive_fcf_years>=4);
assert.ok(fundamental.revenue_growth_3y_cagr>0);

const sparseFacts=structuredClone(facts);
for(const namespace of ["us-gaap"]){
  for(const node of Object.values(sparseFacts.facts[namespace]??{})){
    for(const [unit,rows] of Object.entries(node.units??{})){
      node.units[unit]=rows.filter(r=>Number(r.fy)===2025&&String(r.fp)==="Q1");
    }
  }
}
sparseFacts.facts.dei.EntityCommonStockSharesOutstanding.units.shares=
  sparseFacts.facts.dei.EntityCommonStockSharesOutstanding.units.shares.slice(-1);

const sparseFundamental=buildSecScreenFundamentals({
  companyFacts:sparseFacts,ticker:"SPARSE",cik:"2",companyName:"Sparse Filing Co",exchange:"Nasdaq",
  sic:7372,sicDescription:"SERVICES-PREPACKAGED SOFTWARE",
});
assert.ok(sparseFundamental);
assert.equal(sparseFundamental.revenue_ttm,null);
assert.equal(sparseFundamental.roe,null);
assert.equal(sparseFundamental.roic,null);
assert.equal(sparseFundamental._sec_internal.ebitda_ttm,null);

const now=Math.floor(new Date("2026-09-18T20:00:00Z").getTime()/1000);
const timestamps=[],close=[],volume=[];
for(let i=0;i<30;i++){timestamps.push(now-i*86400);close.push(100+i*.1);volume.push(500000);}
const chart={timestamp:timestamps,indicators:{quote:[{close,volume}]}};
const market=marketMetricsFromYahooChart(chart);
assert.equal(market.observed_sessions,30);
assert.ok(market.avg_dollar_volume_30d>40_000_000);

const row=mergeSecMarketMetrics(fundamental,market);
assert.ok(row.market_cap>9_000_000_000);
assert.ok(row.price_to_fcf>0);
const screened=screenCompany(row);
assert.notEqual(screened.state,"excluded");
assert.ok(screened.evidenceCoveragePct>=60);

const sparse=marketMetricsFromYahooChart({timestamp:timestamps.slice(0,8),indicators:{quote:[{close:close.slice(0,8),volume:volume.slice(0,8)}]}});
const sparseRow=mergeSecMarketMetrics(fundamental,sparse);
assert.equal(sparseRow.avg_dollar_volume_30d,null);
assert.equal(screenCompany(sparseRow).state,"excluded");

console.log("SEC-first Universe Feed V1 tests passed.");
