import assert from "node:assert/strict";
import {
  VALUATION_ENGINE_VERSION,
  dcfPerShareV3,
  expectedReturnScenariosV3,
  valueCompanyV3,
} from "../lib/valuation-engine-v3.mjs";

const dcf=dcfPerShareV3({
  startingCashFlowPerShare:6,
  initialGrowth:10,
  matureGrowth:5,
  projectionYears:5,
  discountRate:10,
  terminalGrowth:2.5,
});
assert.ok(dcf);
assert.ok(dcf.value>60);
assert.equal(dcf.projected.length,5);
assert.equal(dcf.discount_rate,10);

// No silent discount/growth defaults.
assert.equal(dcfPerShareV3({
  startingCashFlowPerShare:6,
  initialGrowth:10,
  matureGrowth:5,
  projectionYears:5,
  terminalGrowth:2.5,
}),null);

const deck=valueCompanyV3({
  industryModule:"consumer_brand",
  currentPrice:80,
  fcfPerShare:5.8,
  assumptions:{
    bear:{initialGrowth:4,matureGrowth:2,discountRate:11.5,terminalGrowth:2},
    base:{initialGrowth:9,matureGrowth:4,discountRate:10,terminalGrowth:2.5},
    bull:{initialGrowth:13,matureGrowth:6,discountRate:9,terminalGrowth:3},
  },
  multiples:{
    historical:{bear:18,base:23,bull:27},
    peer:{bear:19,base:24,bull:28},
  },
  evidence:{valuationHistoryYears:4.8,peerCount:4,primarySourcePct:90},
  returnScenarios:{
    bear:{startingMetricPerShare:5.8,metricGrowthRate:3,exitMultiple:17},
    base:{startingMetricPerShare:5.8,metricGrowthRate:8,exitMultiple:22},
    bull:{startingMetricPerShare:5.8,metricGrowthRate:11,exitMultiple:26},
  },
});
assert.equal(deck.engine_version,VALUATION_ENGINE_VERSION);
assert.ok(deck.base_fair_value>100);
assert.equal(deck.scenarios.base.summary.independent_anchor_count,3);
assert.equal(deck.confidence.band,"high");
assert.ok(deck.fair_value_range.high>deck.fair_value_range.low);
assert.equal(deck.sensitivities.fcf_dcf.length,9);
assert.ok(deck.margin_of_safety.mos_35_price<deck.base_fair_value);

const adbeWeak=valueCompanyV3({
  industryModule:"software_platform",
  currentPrice:250,
  fcfPerShare:18,
  assumptions:{
    bear:{initialGrowth:2,matureGrowth:1,discountRate:12,terminalGrowth:2},
    base:{initialGrowth:7,matureGrowth:3,discountRate:10.5,terminalGrowth:2.5},
    bull:{initialGrowth:10,matureGrowth:5,discountRate:9.5,terminalGrowth:3},
  },
  multiples:{
    historical:{base:22},
    // peer intentionally missing
  },
  evidence:{valuationHistoryYears:1.1,peerCount:0,primarySourcePct:20},
});
assert.ok(adbeWeak.base_fair_value>0);
assert.ok(["developing","low"].includes(adbeWeak.confidence.band));
const weakWidth=(adbeWeak.fair_value_range.high-adbeWeak.fair_value_range.low)/adbeWeak.base_fair_value;
assert.ok(weakWidth>=0.35);

// Explicit owner earnings is not counted as a second intrinsic anchor unless independence is demonstrated.
const duplicateOwner=valueCompanyV3({
  industryModule:"software_platform",
  currentPrice:200,
  fcfPerShare:12,
  ownerEarningsPerShare:12,
  ownerEarningsIndependent:false,
  assumptions:{
    bear:{initialGrowth:2,matureGrowth:1,discountRate:12,terminalGrowth:2},
    base:{initialGrowth:6,matureGrowth:3,discountRate:10,terminalGrowth:2.5},
    bull:{initialGrowth:9,matureGrowth:4,discountRate:9,terminalGrowth:3},
  },
  multiples:{historical:{base:20},peer:{base:21}},
  evidence:{valuationHistoryYears:5,peerCount:4,primarySourcePct:100},
});
const oe=duplicateOwner.scenarios.base.methods.find(m=>m.key==="owner_earnings_dcf");
assert.equal(oe.status,"excluded_duplicate");
assert.equal(duplicateOwner.scenarios.base.summary.independent_anchor_count,3);

const pfe=valueCompanyV3({
  industryModule:"biopharma",
  currentPrice:28,
  fcfPerShare:2.7,
  normalizedEpsPerShare:3.1,
  assumptions:{
    bear:{initialGrowth:-2,matureGrowth:1,discountRate:12,terminalGrowth:1.5},
    base:{initialGrowth:2,matureGrowth:2,discountRate:10.5,terminalGrowth:2},
    bull:{initialGrowth:5,matureGrowth:3,discountRate:9.5,terminalGrowth:2.5},
  },
  multiples:{
    normalizedEps:{bear:8,base:11,bull:14},
    historical:{bear:8.5,base:11.5,bull:14},
    peer:{bear:9,base:12,bull:15},
  },
  evidence:{valuationHistoryYears:3.5,peerCount:4,primarySourcePct:90},
  returnScenarios:{
    bear:{startingMetricPerShare:3.1,metricGrowthRate:-1,exitMultiple:8,annualDividendPerShare:1.72,dividendGrowthRate:0},
    base:{startingMetricPerShare:3.1,metricGrowthRate:2,exitMultiple:11,annualDividendPerShare:1.72,dividendGrowthRate:1},
    bull:{startingMetricPerShare:3.1,metricGrowthRate:5,exitMultiple:14,annualDividendPerShare:1.72,dividendGrowthRate:2},
  },
});
assert.equal(pfe.scenarios.base.summary.independent_anchor_count,4);
assert.ok(pfe.base_fair_value>0);
assert.ok(pfe.expected_return_scenarios.some(r=>r.scenario==="base"&&r.horizon_years===10&&r.status==="applied"));

const gmed=valueCompanyV3({
  industryModule:"healthcare_medtech",
  currentPrice:74,
  fcfPerShare:3.5,
  assumptions:{
    bear:{initialGrowth:4,matureGrowth:2,discountRate:12,terminalGrowth:2},
    base:{initialGrowth:9,matureGrowth:4,discountRate:10,terminalGrowth:2.5},
    bull:{initialGrowth:13,matureGrowth:6,discountRate:9,terminalGrowth:3},
  },
  multiples:{historical:{base:25},peer:{base:27}},
  evidence:{valuationHistoryYears:.5,peerCount:1,primarySourcePct:70},
});
assert.ok(gmed.base_fair_value>0);
assert.ok(gmed.confidence.score<85);

// Banks do not run generic FCF DCF.
const bank=valueCompanyV3({
  industryModule:"financial_bank",
  currentPrice:210,
  normalizedEpsPerShare:16,
  tangibleBookValuePerShare:105,
  multiples:{
    normalizedEps:{bear:10,base:13,bull:15},
    book:{bear:1.5,base:2,bull:2.3},
    historical:{bear:1.6,base:1.9,bull:2.2},
    peer:{bear:1.5,base:2,bull:2.1},
  },
  evidence:{valuationHistoryYears:5,peerCount:4,primarySourcePct:100},
});
assert.equal(bank.scenarios.base.methods.some(m=>m.key==="fcf_dcf"),false);
assert.equal(bank.scenarios.base.summary.independent_anchor_count,4);
assert.ok(bank.base_fair_value>0);

// Expected return math: every horizon must project its own metric/terminal value.
const returns=expectedReturnScenariosV3({
  currentPrice:100,
  scenarios:{
    bear:{startingMetricPerShare:5,metricGrowthRate:2,exitMultiple:15},
    base:{startingMetricPerShare:5,metricGrowthRate:8,exitMultiple:20,annualDividendPerShare:1,dividendGrowthRate:3},
    bull:{startingMetricPerShare:5,metricGrowthRate:12,exitMultiple:25},
  },
});
const base3=returns.find(r=>r.scenario==="base"&&r.horizon_years===3);
const base5=returns.find(r=>r.scenario==="base"&&r.horizon_years===5);
const base10=returns.find(r=>r.scenario==="base"&&r.horizon_years===10);
assert.ok(base3.terminal_value<base5.terminal_value);
assert.ok(base5.terminal_value<base10.terminal_value);
assert.ok(base3.terminal_metric_per_share<base5.terminal_metric_per_share);
assert.ok(base5.terminal_metric_per_share<base10.terminal_metric_per_share);
assert.notEqual(base3.expected_cagr,base10.expected_cagr);

// If return assumptions are missing, do not manufacture an expected CAGR.
const missingReturns=expectedReturnScenariosV3({
  currentPrice:100,
  scenarios:{base:{startingMetricPerShare:5}},
});
assert.equal(missingReturns.find(r=>r.scenario==="base"&&r.horizon_years===5).status,"unavailable");
assert.equal(missingReturns.find(r=>r.scenario==="base"&&r.horizon_years===5).expected_cagr,null);

console.log("Valuation Engine V3 tests passed.");
