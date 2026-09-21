import assert from "node:assert/strict";
import {buildDecisionTriggers,summarizeDecisionTriggers} from "../lib/decision-trigger-engine.mjs";

const triggers=buildDecisionTriggers({
  currentPrice:90,
  valuation:{
    mos_25_price:95,mos_35_price:80,mos_50_price:60,
    base_value:120,bull_value:150,discount_rate:10
  },
  expectedReturns:[{id:"r",scenario:"base",horizon_years:5,expected_cagr:9}],
  financialMetrics:{operating_margin:18},
  metricObservations:[{metric_key:"leading_brand_growth",value_numeric:4,unit:"percent",period_end:"2026-06-30",status:"available"}],
  thesisVariables:[
    {id:"t1",variable_name:"Brand growth",metric_key:"leading_brand_growth",comparator:">=",threshold_value:5,threshold_unit:"percent",status:"unchanged",breaker_condition:"Growth remains below 5% for four quarters.",review_frequency:"quarterly"},
    {id:"t2",variable_name:"Margin resilience",metric_key:"operating_margin",comparator:">=",threshold_value:20,threshold_unit:"percent",status:"weakened",breaker_condition:"Margin remains below 20% for two years.",review_frequency:"annual"},
  ],
  coverage:{decision_readiness_pct:92},
});

assert.equal(triggers.find(t=>t.trigger_key==="price:mos25")?.evaluation_status,"triggered");
assert.equal(triggers.find(t=>t.trigger_key==="price:mos35")?.evaluation_status,"armed");
assert.equal(triggers.find(t=>t.trigger_key==="return:base-below-required-return")?.evaluation_status,"triggered");
assert.equal(triggers.find(t=>t.metric_key==="leading_brand_growth"&&t.comparator===">=")?.evaluation_status,"triggered");
assert.equal(triggers.find(t=>t.metric_key==="operating_margin"&&t.comparator===">=")?.severity,"high");
assert.ok(triggers.some(t=>t.decision_effect==="thesis_breaker"&&t.evaluation_status==="needs_review"));
assert.equal(triggers.find(t=>t.trigger_group==="data_quality")?.evaluation_status,"armed");

const summary=summarizeDecisionTriggers(triggers);
assert.equal(summary.status,"re_evaluate");
assert.ok(summary.triggered>=3);
console.log("Decision Trigger Engine tests passed:",triggers.length,"triggers.");
