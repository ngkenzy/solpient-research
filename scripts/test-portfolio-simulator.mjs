import assert from "node:assert/strict";
import {
  PORTFOLIO_SIMULATOR_VERSION,
  DEFAULT_GUARDRAILS,
  analyzePortfolio,
  simulateTrades,
  buildTradeScenario,
  compareScenarioImpacts,
} from "../lib/portfolio-simulator.mjs";

const portfolio={
  name:"Fixture Portfolio",
  cash:10_000,
  positions:[
    {
      ticker:"AAA",company_name:"Alpha",group:"Software",market_value:40_000,
      readiness_state:"decision_ready",decision_score:88,business_quality_score:92,
      investment_opportunity_score:85,evidence_confidence_score:95,base_5y_cagr:13,
      current_price:100,bear_value:80,base_value:130,bull_value:170
    },
    {
      ticker:"BBB",company_name:"Beta",group:"Software",market_value:30_000,
      readiness_state:"research_ready",decision_score:72,business_quality_score:80,
      investment_opportunity_score:67,evidence_confidence_score:78,base_5y_cagr:9,
      current_price:50,bear_value:40,base_value:55,bull_value:70
    },
    {
      ticker:"CCC",company_name:"Gamma",group:"Healthcare",market_value:20_000,
      readiness_state:"building",decision_score:58,business_quality_score:70,
      investment_opportunity_score:50,evidence_confidence_score:55,
      current_price:40,bear_value:25,base_value:45,bull_value:65
    }
  ]
};

const analysis=analyzePortfolio(portfolio);
assert.equal(analysis.version,PORTFOLIO_SIMULATOR_VERSION);
assert.equal(analysis.total_value,100_000);
assert.equal(analysis.invested_value,90_000);
assert.equal(analysis.cash_weight_pct,10);
assert.equal(analysis.position_count,3);
assert.equal(analysis.positions[0].ticker,"AAA");
assert.equal(analysis.positions[0].weight_pct,40);
assert.equal(analysis.groups[0].group,"Software");
assert.equal(analysis.groups[0].weight_pct,70);
assert.equal(analysis.readiness.decision_ready.weight_pct,40);
assert.equal(analysis.readiness.building.weight_pct,20);
assert.equal(analysis.weighted_metrics.base_5y_cagr.coverage_pct,77.8);
assert.ok(analysis.portfolio_base_5y_cagr>8);
assert.equal(analysis.fair_value_marks.base.coverage_pct,100);
assert.ok(analysis.fair_value_marks.base.change_pct>10);
assert.ok(analysis.guardrails.failed>=4);
assert.equal(analysis.guardrails.constraints.max_position_pct,DEFAULT_GUARDRAILS.max_position_pct);

const duplicate=analyzePortfolio({
  cash:0,
  positions:[
    {...portfolio.positions[0],market_value:10_000},
    {...portfolio.positions[0],market_value:5_000},
  ]
});
assert.equal(duplicate.position_count,1);
assert.equal(duplicate.positions[0].market_value,15_000);

const candidate={
  ticker:"DDD",company_name:"Delta",group:"Industrial",
  readiness_state:"decision_ready",decision_score:90,business_quality_score:90,
  investment_opportunity_score:90,evidence_confidence_score:92,base_5y_cagr:14,
  current_price:75,bear_value:60,base_value:100,bull_value:130
};

const buy=buildTradeScenario({portfolio,candidate,amount:10_000});
assert.equal(buy.trades.length,1);
assert.equal(buy.trades[0].action,"buy");
assert.equal(buy.after.cash_value,0);
assert.equal(buy.after.total_value,100_000);
assert.equal(buy.after.position_count,4);
assert.ok(buy.impact.decision_ready_pct>0);
assert.ok(buy.impact.weighted_evidence_score>0);
assert.ok(buy.impact.cash_weight_pct<0);
assert.ok(buy.after.guardrails.checks.some(c=>c.key==="min_cash_pct"&&!c.pass));

const rebalance=simulateTrades({
  portfolio,
  candidates:[candidate],
  trades:[
    {ticker:"AAA",amount:-15_000},
    {ticker:"DDD",amount:15_000},
  ]
});
assert.equal(rebalance.after.cash_value,10_000);
assert.equal(rebalance.after.positions.find(p=>p.ticker==="AAA").market_value,25_000);
assert.equal(rebalance.after.positions.find(p=>p.ticker==="DDD").market_value,15_000);
assert.ok(rebalance.after.concentration.largest_position_pct<analysis.concentration.largest_position_pct);

assert.throws(
  ()=>simulateTrades({portfolio,trades:[{ticker:"CCC",amount:-25_000}]}),
  /sell more than/
);
assert.throws(
  ()=>simulateTrades({portfolio,candidates:[candidate],trades:[{ticker:"DDD",amount:15_000}]}),
  /exceed available cash/
);
assert.throws(
  ()=>simulateTrades({portfolio,trades:[{ticker:"ZZZ",amount:1_000}]}),
  /requires candidate research metadata/
);

const partial=analyzePortfolio({
  cash:1_000,
  positions:[
    {
      ticker:"MISS",group:"Unknown",market_value:9_000,readiness_state:"research_ready",
      decision_score:70,evidence_confidence_score:70,current_price:10,base_value:12
    }
  ]
});
assert.equal(partial.fair_value_marks.base.coverage_pct,100);
assert.equal(partial.fair_value_marks.bear.coverage_pct,0);
assert.equal(partial.fair_value_marks.bear.change_pct,0);
assert.equal(partial.weighted_metrics.base_5y_cagr.value,null);
assert.equal(partial.portfolio_base_5y_cagr,null);

const custom=analyzePortfolio(portfolio,{
  max_position_pct:50,
  max_group_pct:80,
  max_building_pct:25,
  min_decision_ready_pct:35,
  min_cash_pct:5,
  min_weighted_evidence_score:70,
});
assert.equal(custom.guardrails.failed,0);

const compared=compareScenarioImpacts([buy,rebalance]);
assert.equal(compared.length,2);
assert.equal(compared[0].trades[0].ticker,"DDD");
assert.ok(compared[0].guardrail_failures>=0);

console.log("Portfolio capital allocation simulator tests passed.");
