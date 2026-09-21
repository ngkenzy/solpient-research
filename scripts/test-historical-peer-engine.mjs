import assert from "node:assert/strict";
import { buildCompanyHistory, buildPeerContext, latestMetricMap, buildContextPack } from "../lib/historical-peer-engine.mjs";
import { PEER_SETS, TRACKED_TICKERS } from "../lib/peer-sets.mjs";

assert.equal(TRACKED_TICKERS.length,23);
assert.ok(TRACKED_TICKERS.includes("PFE"));
for(const ticker of TRACKED_TICKERS){
  assert.ok(Array.isArray(PEER_SETS[ticker])&&PEER_SETS[ticker].length>=2,ticker+" needs at least two peers");
  assert.equal(PEER_SETS[ticker].some(p=>p.ticker===ticker),false,ticker+" cannot peer with itself");
}

const company={id:"00000000-0000-0000-0000-000000000001",ticker:"MSFT"};
const fundamentals=[];
for(let i=0;i<8;i++){
  const year=i<4?2025:2026;
  const q=i%4+1;
  const month=String(q*3).padStart(2,"0");
  const revenue=100+i*10;
  const netIncome=20+i*2;
  const fcf=15+i;
  fundamentals.push({
    company_id:company.id,period_end:`${year}-${month}-28`,fiscal_year:year,fiscal_period:"Q"+q,form:"10-Q",provider:"fixture",
    revenue,net_income:netIncome,operating_cash_flow:fcf+5,capital_expenditure:-5,free_cash_flow:fcf,shares_outstanding:10-i*.1,eps_diluted:2+i*.2,
    source_url:"https://example.com/filing?apikey=secret",observed_at:`${year}-${month}-29T00:00:00Z`,
    raw_payload:{
      income:{grossProfit:revenue*.7,operatingIncome:revenue*.4},
      cash_flow:{stockBasedCompensation:2,commonDividendsPaid:-1,commonStockRepurchased:-3,acquisitionsNet:-.5,netDebtIssuance:i%2?2:-1}
    }
  });
}
const markets=[
  {company_id:company.id,trading_date:"2026-06-30",market_cap:1000,provider:"fixture",source_url:"https://example.com/market",observed_at:"2026-06-30T21:00:00Z"}
];
const result=buildCompanyHistory({company,fundamentals,markets});
assert.equal(result.coverage.full_year_count,2);
assert.ok(result.history.some(r=>r.period_type==="fiscal_year"&&r.metric_key==="revenue"));
assert.ok(result.history.some(r=>r.metric_key==="revenue_growth_yoy"));
assert.equal(result.capital.length,8);
assert.equal(result.valuations.length,1);
assert.ok(result.valuations[0].pe>0);
assert.ok(result.valuations[0].price_to_fcf>0);
assert.equal(result.history.some(r=>String(r.source_url??"").includes("apikey")),false);

const tracked=new Set(["MSFT","CRM","ADBE","GOOGL"]);
const latestByTicker=new Map([
  ["CRM",{revenue_growth_yoy:11,gross_margin:75,operating_margin:20,pe:28}],
  ["ADBE",{revenue_growth_yoy:9,gross_margin:88,operating_margin:35,pe:22}],
  ["GOOGL",{revenue_growth_yoy:14,gross_margin:58,operating_margin:32,pe:25}],
]);
const peerContext=buildPeerContext({company,trackedCompanies:tracked,latestByTicker,asOfDate:"2026-09-20"});
assert.ok(peerContext.peerSet.length>=3);
assert.ok(peerContext.peerComparison.some(p=>p.data_status==="available"));
assert.ok(peerContext.snapshotRows.length>0);
const pack=buildContextPack({company,result,peerContext,asOfDate:"2026-09-20"});
assert.equal(pack.context_version,"context-v1");
assert.equal(pack.summary.full_fiscal_years,2);
assert.equal(latestMetricMap(result).revenue>0,true);
console.log("Historical + peer context engine tests passed.");

const withAnnual=[...fundamentals,{...fundamentals[0],period_end:"2025-06-28",fiscal_year:2025,fiscal_period:"FY",form:"10-K",provider:"yahoo_fundamentals"}];
const annualSafe=buildCompanyHistory({company,fundamentals:withAnnual,markets});
assert.equal(new Set(annualSafe.capital.map(r=>r.period_end)).size,annualSafe.capital.length,"annual duplicate safety");
console.log("Annual/quarter de-duplication test passed.");
