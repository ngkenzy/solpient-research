import assert from "node:assert/strict";
import { composeResearchV1 } from "../lib/research-composer.mjs";
import { applyReviewPatch } from "../lib/review-workbench.mjs";

const baseline={
 ticker:"TEST",company_name:"Test Co",description:"Test business",
 research:{price_at_research:100,market_cap:1000000000,benchmark_ticker:"SPY",data_cutoff_at:"2026-09-20T00:00:00Z",standard_version:"solpient-v1"},
 metric_observations:[
  ["revenue_growth_1y",12,"percent"],["gross_margin",60,"percent"],["operating_margin",25,"percent"],["net_margin",20,"percent"],
  ["fcf_margin",22,"percent"],["fcf_per_share",5,"USD/share"],["fcf_yield",5,"percent"],["cash",300000000,"USD"],
  ["total_debt",100000000,"USD"],["shares_outstanding",100000000,"shares"]
 ].map(([metric_key,value_numeric,unit])=>({module:"universal",metric_key,label:metric_key,status:"available",basis:"reported",value_numeric,unit}))
};
const context={
 history_coverage:{full_year_count:5},trends:{revenue_cagr:10,fcf_per_share_cagr:9,share_count_cagr:-1},
 peer_set:[{ticker:"AAA"},{ticker:"BBB"}],peer_comparison:[
  {ticker:"AAA",metrics:{price_to_fcf:22}},{ticker:"BBB",metrics:{price_to_fcf:18}}
 ],summary:{peers_with_local_data:2}
};
const valuations=Array.from({length:800},(_,i)=>({trading_date:new Date(Date.UTC(2026,8,20-i)).toISOString().slice(0,10),price_to_fcf:20+(i%5)}));
const result=composeResearchV1({company:{ticker:"TEST",description:"Test business"},baselinePayload:baseline,contextPack:context,valuationHistory:valuations,asOfDate:"2026-09-20"});
assert.equal(result.composer.status,"private_draft");
assert.equal(result.composer.publication_allowed,false);
assert.ok(result.review_patch.valuation_analysis.methods.length>=5);
assert.equal(result.review_patch.valuation_analysis.valuation_bridge.formula,"median_of_applicable_anchors");
assert.ok(result.review_patch.valuation_analysis.valuation_bridge.components.base.result>0);
assert.equal(result.review_patch.expected_return_scenarios.length,9);
assert.ok(result.review_patch.risk_register.length>=3);
const merged=applyReviewPatch(baseline,result.review_patch);
assert.ok(merged.decision_dashboard);
assert.equal(merged.fundamental_scorecard.length,10);
console.log("research composer tests passed");
