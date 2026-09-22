import assert from "node:assert/strict";
import {
  AUTONOMOUS_RESEARCH_FACTORY_VERSION,
  AUTONOMOUS_INDUSTRY_POLICY_VERSION,
  AUTONOMOUS_VALUATION_POLICY_VERSION,
  assignAutonomousIndustryModule,
  buildAutonomousValuationPolicy,
} from "../lib/autonomous-research-factory-v2-1.mjs";

assert.equal(AUTONOMOUS_RESEARCH_FACTORY_VERSION,"autonomous-research-factory-v2.1");
assert.equal(AUTONOMOUS_INDUSTRY_POLICY_VERSION,"industry-assignment-v2.1");
assert.equal(AUTONOMOUS_VALUATION_POLICY_VERSION,"valuation-assumptions-v2.1");

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

console.log("Autonomous Research Factory V2.1 policy tests passed.");
