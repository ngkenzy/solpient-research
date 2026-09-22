import assert from "node:assert/strict";
import {
  AUTONOMOUS_RESEARCH_FACTORY_VERSION,
  AUTONOMOUS_INDUSTRY_POLICY_VERSION,
  AUTONOMOUS_VALUATION_POLICY_VERSION,
  AUTONOMOUS_SETTLED_QUEUE_VERSION,
  assignAutonomousIndustryModule,
  buildAutonomousValuationPolicy,
  buildAutonomousSettlementHash,
  selectAutonomousResearchFactoryCandidates,
} from "../lib/autonomous-research-factory-v2-1.mjs";

assert.equal(AUTONOMOUS_RESEARCH_FACTORY_VERSION,"autonomous-research-factory-v2.1");
assert.equal(AUTONOMOUS_INDUSTRY_POLICY_VERSION,"industry-assignment-v2.1");
assert.equal(AUTONOMOUS_VALUATION_POLICY_VERSION,"valuation-assumptions-v2.1.1");
assert.equal(AUTONOMOUS_SETTLED_QUEUE_VERSION,"autonomous-settled-queue-v2.1.2");

const settlementBase={
  item:{
    id:"item-q",
    ticker:"QQQ",
    source_screen_result_id:"screen-q",
    state_hash:"state-q",
    state_snapshot:{screen_result_hash:"screen-hash-q"},
  },
  coverage:{
    status:"partial",
    fundamentals_pct:80,
    history_pct:75,
    market_history_pct:90,
    valuation_history_pct:80,
    capital_allocation_pct:60,
    consensus_pct:20,
    industry_pct:70,
    peer_pct:70,
    overall_pct:70,
    decision_readiness_pct:68,
    normalized_quarters:12,
    complete_fiscal_years:4,
    market_days:800,
    primary_source_quarters:0,
    missing_fields:[{layer:"consensus",field:"point_in_time_snapshots"}],
    provider_summary:{yahoo_fundamentals:9,fmp:5},
  },
  contextPack:{
    industry_module:"software_platform",
    history_coverage:{full_year_count:4},
    peer_comparison:[
      {ticker:"AAA",data_status:"available",metrics:{price_to_fcf:20}},
      {ticker:"BBB",data_status:"available",metrics:{price_to_fcf:22}},
      {ticker:"CCC",data_status:"available",metrics:{price_to_fcf:24}},
    ],
    summary:{
      historical_metric_rows:40,
      valuation_history_rows:800,
      capital_allocation_rows:4,
      configured_peers:3,
      peers_with_local_data:3,
      full_fiscal_years:4,
    },
    limitations:["Consensus history is still accumulating."],
  },
  consensus:null,
  baselineDraft:{
    industry_module:"software_platform",
    evidence_completeness_pct:72,
    standard_status:"partial",
    draft_payload:{
      metric_observations:[
        {metric_key:"fcf_per_share",status:"available",value_numeric:8,period_end:"2026-06-30"},
        {metric_key:"net_debt_to_fcf",status:"available",value_numeric:.5,period_end:"2026-06-30"},
      ],
    },
  },
  industryAssignment:{
    policy_version:"industry-assignment-v2.1",
    status:"applied",
    module:"software_platform",
    proposed_module:"software_platform",
    decision_hash:"a".repeat(64),
  },
};
const settlementHash=buildAutonomousSettlementHash(settlementBase);
const settlementHashRepeat=buildAutonomousSettlementHash(settlementBase);
assert.equal(settlementHash,settlementHashRepeat);
assert.notEqual(
  settlementHash,
  buildAutonomousSettlementHash({
    ...settlementBase,
    consensus:{
      analyst_count:8,
      revenue_next_fy:100,
      eps_next_fy:5,
      revenue_growth_next_fy:9,
      eps_growth_next_fy:10,
    },
  })
);

const queueItems=[
  {id:"review-new",ticker:"AAA",ordinal:1,stage:"valuation_review",status:"needs_review"},
  {id:"review-settled",ticker:"AAB",ordinal:2,stage:"valuation_review",status:"needs_review"},
  {id:"queued",ticker:"AAC",ordinal:3,stage:"evidence_ingestion",status:"queued"},
  {id:"quarantine-same",ticker:"AAD",ordinal:4,stage:"valuation_review",status:"quarantined"},
  {id:"quarantine-changed",ticker:"AAE",ordinal:5,stage:"valuation_review",status:"quarantined"},
  {id:"blocked",ticker:"AAF",ordinal:6,stage:"evidence_ingestion",status:"blocked"},
  {id:"running",ticker:"AAG",ordinal:7,stage:"evidence_ingestion",status:"running"},
  {id:"pipeline",ticker:"AAH",ordinal:8,stage:"pipeline_refresh",status:"queued"},
  {id:"research-review",ticker:"AAI",ordinal:9,stage:"research_review",status:"needs_review"},
  {id:"complete",ticker:"AAJ",ordinal:10,stage:"complete",status:"complete"},
];
const queueDecisions=[{
  research_factory_item_id:"review-settled",
  decision_type:"valuation_assumptions",
  decision_status:"quarantined",
  policy_version:AUTONOMOUS_VALUATION_POLICY_VERSION,
}];
const currentSettlementHashes=new Map([
  ["quarantine-same","hash-same"],
  ["quarantine-changed","hash-new"],
]);
const priorSettlementHashes=new Map([
  ["quarantine-same","hash-same"],
  ["quarantine-changed","hash-old"],
]);

const routineSelection=selectAutonomousResearchFactoryCandidates({
  items:queueItems,
  decisions:queueDecisions,
  currentSettlementHashes,
  priorSettlementHashes,
  maxItems:10,
});
assert.deepEqual(
  routineSelection.map(x=>[x.ticker,x.selection_reason]),
  [
    ["AAA","unattempted_review_gate"],
    ["AAC","queued_unattempted"],
    ["AAE","quarantine_evidence_changed"],
  ]
);

const manualQuarantine=selectAutonomousResearchFactoryCandidates({
  items:queueItems,
  decisions:queueDecisions,
  currentSettlementHashes,
  priorSettlementHashes,
  ticker:"AAD",
  maxItems:1,
});
assert.equal(manualQuarantine.length,1);
assert.equal(manualQuarantine[0].selection_reason,"manual_ticker_override");

const manualBlocked=selectAutonomousResearchFactoryCandidates({
  items:queueItems,
  decisions:queueDecisions,
  ticker:"AAF",
  maxItems:1,
});
assert.equal(manualBlocked.length,1);
assert.equal(manualBlocked[0].selection_reason,"manual_ticker_override");

const manualRunning=selectAutonomousResearchFactoryCandidates({
  items:queueItems,
  decisions:queueDecisions,
  ticker:"AAG",
  maxItems:1,
});
assert.equal(manualRunning.length,0);

const software=assignAutonomousIndustryModule({
  ticker:"INTU",
  screenProfile:"software",
  sector:"Information Technology",
  industry:"Software & IT Services",
  sectorClassification:{confidence:"high",reviewRequired:false},
});
assert.equal(software.status,"applied");
assert.equal(software.module,"software_platform");
assert.ok(software.confidence>=0.8);

const education=assignAutonomousIndustryModule({
  ticker:"LOPE",
  screenProfile:"consumer_discretionary",
  sector:"Consumer Discretionary",
  industry:"Education Services",
  sectorClassification:{confidence:"reviewed",reviewRequired:false},
});
assert.equal(education.status,"applied");
assert.equal(education.module,"education_services");

const hardware=assignAutonomousIndustryModule({
  ticker:"NVDA",
  screenProfile:"technology",
  sector:"Information Technology",
  industry:"Technology Hardware & Semiconductors",
  sectorClassification:{confidence:"high",reviewRequired:false},
});
assert.equal(hardware.status,"applied");
assert.equal(hardware.module,"technology_hardware");

const forcedReview=assignAutonomousIndustryModule({
  ticker:"TEST",
  screenProfile:"software",
  sector:"Information Technology",
  industry:"Software & IT Services",
  sectorClassification:{confidence:"high",reviewRequired:true},
});
assert.equal(forcedReview.status,"quarantined");
assert.equal(forcedReview.module,null);

const metric=(key,value)=>({
  metric_key:key,
  status:"available",
  value_numeric:value,
  source_url:"https://www.sec.gov/example",
  source_title:"SEC 10-K",
});
const baselineDraft={
  industry_module:"software_platform",
  draft_payload:{
    metric_observations:[
      metric("fcf_per_share",6),
      metric("net_debt_to_fcf",0.5),
    ],
  },
};

const fundamentals=[];
for(let year=2023;year<=2026;year++){
  for(let q=1;q<=4;q++){
    const i=(year-2023)*4+q;
    fundamentals.push({
      fiscal_year:year,
      fiscal_period:"Q"+q,
      period_end:year+"-"+String(q*3).padStart(2,"0")+"-28",
      revenue:1000*Math.pow(1.09,i/4),
      free_cash_flow:220*Math.pow(1.10,i/4),
      shares_outstanding:100,
      eps_diluted:4*Math.pow(1.08,i/4)/4,
      provider:"sec_companyfacts",
      source_url:"https://www.sec.gov/example",
    });
  }
}

const valuationHistory=Array.from({length:72},(_,i)=>({
  trading_date:new Date(Date.UTC(2020+Math.floor(i/12),i%12,1)).toISOString().slice(0,10),
  price_to_fcf:18+(i%12)*.4,
  forward_pe:22+(i%10)*.5,
}));
const contextPack={
  peer_comparison:[
    {data_status:"available",metrics:{price_to_fcf:20,pe:24}},
    {data_status:"available",metrics:{price_to_fcf:22,pe:26}},
    {data_status:"available",metrics:{price_to_fcf:24,pe:28}},
    {data_status:"available",metrics:{price_to_fcf:26,pe:30}},
  ],
};
const screenResult={
  ticker:"TEST",
  screen_profile:"software",
  input_summary:{price:100},
};
const consensus={
  revenue_growth_next_fy:9,
  eps_growth_next_fy:10,
  eps_next_fy:5.5,
  analyst_count:12,
};

const policy=buildAutonomousValuationPolicy({
  screenResult,
  industryAssignment:{
    module:"software_platform",
    confidence:.95,
  },
  baselineDraft,
  fundamentals,
  market:{price:105,trading_date:"2026-09-22"},
  consensus,
  valuationHistory,
  contextPack,
  coverage:{overall_pct:85},
});
assert.equal(policy.status,"auto_approved");
assert.equal(policy.preflight.complete,true);
assert.equal(policy.valuation_input.currentPrice,105);
assert.equal(policy.evidence.market_price_source,"latest_market_snapshot");
assert.ok(policy.confidence_pct>=78);
assert.ok(policy.valuation_input.assumptions.base.initialGrowth!=null);
assert.ok(policy.valuation_input.assumptions.base.discountRate>=7.5);
assert.ok(policy.valuation_input.assumptions.base.terminalGrowth<
          policy.valuation_input.assumptions.base.discountRate);
assert.equal(
  policy.evidence.policy_rates.method,
  "Solpient policy discount rate; not represented as a market-observed WACC."
);
assert.ok(policy.valuation_input.multiples.historical.base>0);
assert.ok(policy.valuation_input.multiples.peer.base>0);
assert.ok(policy.valuation_input.returnScenarios.base.exitMultiple>0);

const structuredYahoo=fundamentals.map((row)=>({
  ...row,
  provider:"yahoo_fundamentals",
  source_url:"https://query1.finance.yahoo.com/example",
  form:"10-Q",
}));
const structuredFmp=fundamentals.map((row)=>({
  ...row,
  provider:"fmp",
  source_url:"https://financialmodelingprep.com/example",
  form:"10-Q",
  revenue:row.revenue*1.002,
  free_cash_flow:row.free_cash_flow*.998,
  shares_outstanding:row.shares_outstanding,
  eps_diluted:row.eps_diluted*1.001,
}));
const corroborated=buildAutonomousValuationPolicy({
  screenResult,
  industryAssignment:{module:"software_platform",confidence:.95},
  baselineDraft,
  fundamentals:[...structuredYahoo,...structuredFmp],
  market:{price:105,trading_date:"2026-09-22"},
  consensus:null,
  valuationHistory,
  contextPack,
  coverage:{overall_pct:80},
});
assert.equal(corroborated.status,"auto_approved");
assert.equal(corroborated.evidence.primary_source_pct,0);
assert.equal(corroborated.evidence.fundamental_evidence_mode,"structured_provider_corroboration");
assert.equal(corroborated.evidence.structured_provider_count,2);
assert.ok(corroborated.evidence.structured_corroboration_pct>=90);
assert.ok(corroborated.evidence.growth_signal_count>=3);
assert.ok(corroborated.confidence_pct>=78);
assert.ok(corroborated.valuation_input.assumptions.base.initialGrowth<20);

const oneProvider=buildAutonomousValuationPolicy({
  screenResult,
  industryAssignment:{module:"software_platform",confidence:.95},
  baselineDraft,
  fundamentals:structuredYahoo,
  market:{price:105,trading_date:"2026-09-22"},
  consensus:null,
  valuationHistory,
  contextPack,
  coverage:{overall_pct:80},
});
assert.equal(oneProvider.status,"quarantined");
assert.equal(oneProvider.evidence.fundamental_evidence_mode,"insufficient_source_corroboration");
assert.ok(oneProvider.critical_issues.includes("insufficient_fundamental_source_corroboration"));

const weak=buildAutonomousValuationPolicy({
  screenResult,
  industryAssignment:{module:"software_platform",confidence:.95},
  baselineDraft:{
    industry_module:"software_platform",
    draft_payload:{metric_observations:[metric("fcf_per_share",6)]},
  },
  fundamentals:fundamentals.slice(0,2),
  consensus:null,
  valuationHistory:valuationHistory.slice(0,4),
  contextPack:{peer_comparison:[]},
  coverage:{overall_pct:35},
});
assert.equal(weak.status,"quarantined");
assert.equal(weak.preflight.complete,false);
assert.ok(weak.critical_issues.includes("insufficient_historical_multiple_evidence"));
assert.ok(weak.critical_issues.includes("insufficient_peer_multiple_evidence"));
assert.ok(weak.critical_issues.includes("insufficient_fundamental_source_corroboration"));

console.log("Autonomous Research Factory V2.1 policy tests passed.");
