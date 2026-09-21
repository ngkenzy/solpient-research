import assert from "node:assert/strict";
import { normalizeCompanyFacts, extractFiscalPeriods, SEC_PROVIDER } from "../lib/sec-companyfacts.mjs";
import { buildCoverageReport } from "../lib/data-coverage-engine.mjs";

function fact({fy,fp,end,val,start=null,form=null,filed="2026-08-01",accn="x"}){
  return {fy,fp,end,val,start,form:form??(fp==="FY"?"10-K":"10-Q"),filed,accn};
}
function units(rows,unit="USD"){return{[unit]:rows};}

const companyFacts={
  cik:"0000789019",
  facts:{"us-gaap":{
    RevenueFromContractWithCustomerExcludingAssessedTax:{units:units([
      fact({fy:2025,fp:"Q1",start:"2024-07-01",end:"2024-09-30",val:100}),
      fact({fy:2025,fp:"Q2",start:"2024-07-01",end:"2024-12-31",val:220}),
      fact({fy:2025,fp:"Q3",start:"2024-07-01",end:"2025-03-31",val:360}),
      fact({fy:2025,fp:"FY",start:"2024-07-01",end:"2025-06-30",val:520}),
    ])},
    NetIncomeLoss:{units:units([
      fact({fy:2025,fp:"Q1",start:"2024-07-01",end:"2024-09-30",val:20}),
      fact({fy:2025,fp:"Q2",start:"2024-07-01",end:"2024-12-31",val:45}),
      fact({fy:2025,fp:"Q3",start:"2024-07-01",end:"2025-03-31",val:75}),
      fact({fy:2025,fp:"FY",start:"2024-07-01",end:"2025-06-30",val:110}),
    ])},
    NetCashProvidedByUsedInOperatingActivities:{units:units([
      fact({fy:2025,fp:"Q1",start:"2024-07-01",end:"2024-09-30",val:30}),
      fact({fy:2025,fp:"Q2",start:"2024-07-01",end:"2024-12-31",val:65}),
      fact({fy:2025,fp:"Q3",start:"2024-07-01",end:"2025-03-31",val:105}),
      fact({fy:2025,fp:"FY",start:"2024-07-01",end:"2025-06-30",val:150}),
    ])},
    PaymentsToAcquirePropertyPlantAndEquipment:{units:units([
      fact({fy:2025,fp:"Q1",start:"2024-07-01",end:"2024-09-30",val:5}),
      fact({fy:2025,fp:"Q2",start:"2024-07-01",end:"2024-12-31",val:11}),
      fact({fy:2025,fp:"Q3",start:"2024-07-01",end:"2025-03-31",val:18}),
      fact({fy:2025,fp:"FY",start:"2024-07-01",end:"2025-06-30",val:26}),
    ])},
    WeightedAverageNumberOfDilutedSharesOutstanding:{units:units([
      fact({fy:2025,fp:"Q1",start:"2024-07-01",end:"2024-09-30",val:10}),
      fact({fy:2025,fp:"Q2",start:"2024-10-01",end:"2024-12-31",val:9.9}),
      fact({fy:2025,fp:"Q3",start:"2025-01-01",end:"2025-03-31",val:9.8}),
      fact({fy:2025,fp:"FY",start:"2024-07-01",end:"2025-06-30",val:9.85}),
    ],"shares")},
    EarningsPerShareDiluted:{units:units([
      fact({fy:2025,fp:"Q1",start:"2024-07-01",end:"2024-09-30",val:2}),
      fact({fy:2025,fp:"Q2",start:"2024-10-01",end:"2024-12-31",val:2.5}),
      fact({fy:2025,fp:"Q3",start:"2025-01-01",end:"2025-03-31",val:3}),
      fact({fy:2025,fp:"FY",start:"2024-07-01",end:"2025-06-30",val:11}),
    ],"USD/shares")},
    GrossProfit:{units:units([
      fact({fy:2025,fp:"Q1",start:"2024-07-01",end:"2024-09-30",val:70}),
      fact({fy:2025,fp:"Q2",start:"2024-07-01",end:"2024-12-31",val:155}),
      fact({fy:2025,fp:"Q3",start:"2024-07-01",end:"2025-03-31",val:255}),
      fact({fy:2025,fp:"FY",start:"2024-07-01",end:"2025-06-30",val:370}),
    ])},
    OperatingIncomeLoss:{units:units([
      fact({fy:2025,fp:"Q1",start:"2024-07-01",end:"2024-09-30",val:40}),
      fact({fy:2025,fp:"Q2",start:"2024-07-01",end:"2024-12-31",val:88}),
      fact({fy:2025,fp:"Q3",start:"2024-07-01",end:"2025-03-31",val:140}),
      fact({fy:2025,fp:"FY",start:"2024-07-01",end:"2025-06-30",val:200}),
    ])},
    CashAndCashEquivalentsAtCarryingValue:{units:units([
      fact({fy:2025,fp:"Q1",end:"2024-09-30",val:50,start:null}),
      fact({fy:2025,fp:"Q2",end:"2024-12-31",val:55,start:null}),
      fact({fy:2025,fp:"Q3",end:"2025-03-31",val:60,start:null}),
      fact({fy:2025,fp:"FY",end:"2025-06-30",val:65,start:null}),
    ])},
    AssetsCurrent:{units:units([fact({fy:2025,fp:"FY",end:"2025-06-30",val:200,start:null})])},
    LiabilitiesCurrent:{units:units([fact({fy:2025,fp:"FY",end:"2025-06-30",val:100,start:null})])},
    StockholdersEquity:{units:units([fact({fy:2025,fp:"FY",end:"2025-06-30",val:300,start:null})])},
    RetainedEarningsAccumulatedDeficit:{units:units([fact({fy:2025,fp:"FY",end:"2025-06-30",val:180,start:null})])},
    LongTermDebt:{units:units([fact({fy:2025,fp:"FY",end:"2025-06-30",val:80,start:null})])},
    Assets:{units:units([fact({fy:2025,fp:"FY",end:"2025-06-30",val:500,start:null})])},
    Liabilities:{units:units([fact({fy:2025,fp:"FY",end:"2025-06-30",val:200,start:null})])},
  }}
};

const periods=extractFiscalPeriods(companyFacts);
assert.deepEqual(periods.map(p=>p.fp),["Q4","Q3","Q2","Q1"]);
const rows=normalizeCompanyFacts(companyFacts,{companyId:"c1",ticker:"MSFT",cik:"0000789019"});
assert.equal(rows.length,4);
const q2=rows.find(r=>r.fiscal_period==="Q2");
const q4=rows.find(r=>r.fiscal_period==="Q4");
assert.equal(q2.revenue,120);
assert.equal(q2.operating_cash_flow,35);
assert.equal(q2.free_cash_flow,29);
assert.equal(q4.revenue,160);
assert.equal(q4.net_income,35);
assert.equal(q4.provider,SEC_PROVIDER);
assert.equal(q4.raw_payload.balance_sheet.totalDebt,80);
assert.equal(q4.raw_payload.balance_sheet.cashAndCashEquivalents,65);

const company={id:"c1",ticker:"MSFT"};
const fundamentals=[];
for(let y=2021;y<=2025;y++)for(let q=1;q<=4;q++){
  fundamentals.push({
    provider:"sec_companyfacts",period_end:`${y}-${String(q*3).padStart(2,"0")}-28`,
    fiscal_year:y,fiscal_period:"Q"+q,revenue:100,net_income:20,operating_cash_flow:30,
    free_cash_flow:25,shares_outstanding:10,eps_diluted:2,
    raw_payload:{balance_sheet:{cashAndCashEquivalents:50,totalDebt:20,currentAssets:100,currentLiabilities:50,stockholdersEquity:120,retainedEarnings:80}}
  });
}
const report=buildCoverageReport({
  company,fundamentals,marketDays:1300,
  context:{summary:{configured_peers:4,peers_with_local_data:3}},
  draft:{draft_payload:{metric_observations:[
    {module:"software_platform",metric_key:"rd_to_revenue",status:"available"},
    {module:"software_platform",metric_key:"sbc_to_revenue",status:"available"},
    {module:"software_platform",metric_key:"capex_to_revenue",status:"available"},
    {module:"software_platform",metric_key:"cloud_or_subscription_growth",status:"available"},
    {module:"software_platform",metric_key:"rpo_or_backlog_growth",status:"available"},
    {module:"software_platform",metric_key:"recurring_revenue_mix",status:"not_applicable"},
  ]}},
  valuationObservations:60,
  valuationCoverageYears:5,
  capitalCompleteYears:5,
  peerMetricTickers:4,
  consensusSnapshots:5,
  publishedResearch:true,
  valuationFormulaPersisted:true,
  asOfDate:"2026-09-20"
});
assert.equal(report.fundamentals_pct,100);
assert.equal(report.history_pct,100);
assert.equal(report.market_history_pct,100);
assert.equal(report.status,"sufficient");
assert.equal(report.primary_source_quarters,20);
assert.equal(report.valuation_history_pct,100);
assert.equal(report.capital_allocation_pct,100);
assert.equal(report.peer_pct,100);
assert.equal(report.consensus_pct,100);
assert.equal(report.research_structure_pct,100);
assert.equal(report.decision_readiness_pct,100);
console.log("Data Coverage Engine v2 tests passed.");

const annualFundamentals=Array.from({length:4},(_,i)=>({
  provider:"yahoo_fundamentals",period_end:String(2022+i)+"-12-31",fiscal_year:2022+i,fiscal_period:"FY",
  revenue:100+i*10,net_income:20,operating_cash_flow:30,free_cash_flow:25,shares_outstanding:10,eps_diluted:2,
  raw_payload:{balance_sheet:{cashAndCashEquivalents:50,totalDebt:20,currentAssets:100,currentLiabilities:50,stockholdersEquity:120,retainedEarnings:80}}
}));
const recentQuarter=Array.from({length:4},(_,i)=>({
  provider:"yahoo_fundamentals",period_end:"2026-"+String((i+1)*3).padStart(2,"0")+"-28",fiscal_year:2026,fiscal_period:null,
  revenue:120,net_income:25,operating_cash_flow:35,free_cash_flow:28,shares_outstanding:10,eps_diluted:2.5,
  raw_payload:{balance_sheet:{cashAndCashEquivalents:55,totalDebt:18,currentAssets:110,currentLiabilities:45,stockholdersEquity:130,retainedEarnings:90}}
}));
const annualReport=buildCoverageReport({company,fundamentals:[...recentQuarter,...annualFundamentals],marketDays:1260,context:{summary:{configured_peers:2,peers_with_local_data:1}},draft:{draft_payload:{metric_observations:[]}},asOfDate:"2026-09-20"});
assert.equal(annualReport.history_pct,80,"annual history coverage");
console.log("Annual history coverage test passed.");
