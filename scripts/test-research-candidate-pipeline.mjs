import assert from "node:assert/strict";
import { selectSolpient100Candidates, SCREEN_STATE } from "../lib/universe-screening-engine.mjs";
import {
  RESEARCH_CANDIDATE_PIPELINE_VERSION,
  valuationPreflight,
  buildResearchCandidatePipeline,
  valuationProfileForScreen,
} from "../lib/research-candidate-pipeline.mjs";

const screened=selectSolpient100Candidates([{
  ticker:"TEST",
  company_name:"Test Compounder",
  sector:"Information Technology",
  industry:"Software",
  market_cap:50_000_000_000,
  avg_dollar_volume_30d:200_000_000,
  price:100,
  roic:25,
  roe:30,
  fcf_margin:28,
  cash_conversion_pct:105,
  operating_margin:32,
  positive_fcf_years:5,
  positive_eps_years:5,
  positive_revenue_growth_years:5,
  operating_margin_volatility_pct:2,
  share_dilution_3y_pct:0,
  net_debt_to_ebitda:0,
  debt_to_equity:.1,
  interest_coverage:25,
  current_ratio:2,
  revenue_growth_3y_cagr:15,
  eps_growth_3y_cagr:18,
  fcf_growth_3y_cagr:17,
  price_to_fcf:20,
  forward_pe:22,
  ev_to_ebitda:16,
  peg_ratio:1.3,
}],{limit:100})[0];

assert.equal(screened.state,SCREEN_STATE.SOLPIENT_100_CANDIDATE);
assert.equal(screened.proposedForDeepResearch,true);
assert.equal(valuationProfileForScreen(screened),"software_platform");

const emptyPreflight=valuationPreflight(screened,{});
assert.equal(emptyPreflight.complete,false);
assert.ok(emptyPreflight.missing.includes("currentPrice"));
assert.ok(emptyPreflight.missing.includes("fcfPerShare"));
assert.ok(emptyPreflight.missing.includes("assumptions.base.discountRate"));
assert.ok(emptyPreflight.missing.includes("multiples.peer.base"));

const onboarding=buildResearchCandidatePipeline({
  screenResult:screened,
  companyExists:false,
});
assert.equal(onboarding.pipelineVersion,RESEARCH_CANDIDATE_PIPELINE_VERSION);
assert.equal(onboarding.stage,"onboarding");
assert.equal(onboarding.readiness.state,"building");
assert.ok(onboarding.nextActions.some(a=>a.type==="onboarding"));
assert.ok(onboarding.nextActions.some(a=>a.type==="valuation_inputs"));

const valuationInput={
  currentPrice:100,
  fcfPerShare:6,
  assumptions:{
    bear:{initialGrowth:3,matureGrowth:1,discountRate:12,terminalGrowth:2},
    base:{initialGrowth:8,matureGrowth:4,discountRate:10,terminalGrowth:2.5},
    bull:{initialGrowth:12,matureGrowth:6,discountRate:9,terminalGrowth:3},
  },
  multiples:{
    historical:{bear:16,base:20,bull:24},
    peer:{bear:17,base:21,bull:25},
  },
  evidence:{
    valuationHistoryYears:5,
    peerCount:4,
    primarySourcePct:100,
  },
  returnScenarios:{
    bear:{startingMetricPerShare:6,metricGrowthRate:2,exitMultiple:16},
    base:{startingMetricPerShare:6,metricGrowthRate:8,exitMultiple:20},
    bull:{startingMetricPerShare:6,metricGrowthRate:12,exitMultiple:24},
  },
};

const preflight=valuationPreflight(screened,valuationInput);
assert.equal(preflight.complete,true);

const valuedButUnresearched=buildResearchCandidatePipeline({
  screenResult:screened,
  companyExists:true,
  valuationInput,
  researchInput:{
    scores:{},
    coverage:{
      fundamentals_pct:100,
      balance_sheet_pct:100,
      history_pct:100,
      market_history_pct:100,
      valuation_history_pct:100,
      capital_allocation_pct:100,
      peer_pct:100,
      industry_pct:100,
      consensus_pct:100,
      research_structure_pct:100,
      primary_source_quarters:5,
      normalized_quarters:5,
    },
    researchedAt:"2026-09-21T00:00:00Z",
  },
  now:new Date("2026-09-21T12:00:00Z"),
});
assert.equal(valuedButUnresearched.stage,"research_building");
assert.ok(valuedButUnresearched.valuation.result.base_fair_value>0);
assert.equal(valuedButUnresearched.readiness.state,"building");
assert.equal(valuedButUnresearched.readiness.decision.businessQuality.score,null);
assert.ok(valuedButUnresearched.nextActions.some(a=>a.type==="research_scores"));
assert.ok(!valuedButUnresearched.nextActions.some(a=>a.type==="complete"));

const fullyReady=buildResearchCandidatePipeline({
  screenResult:screened,
  companyExists:true,
  valuationInput,
  researchInput:{
    scores:{
      quality_score:92,
      moat_score:88,
      financial_strength_score:90,
    },
    coverage:{
      engine_version:"coverage-v2",
      as_of_date:"2026-09-21",
      fundamentals_pct:100,
      balance_sheet_pct:100,
      history_pct:100,
      market_history_pct:100,
      valuation_history_pct:100,
      capital_allocation_pct:100,
      peer_pct:100,
      industry_pct:100,
      consensus_pct:100,
      research_structure_pct:100,
      primary_source_quarters:5,
      normalized_quarters:5,
    },
    researchedAt:"2026-09-21T00:00:00Z",
  },
  now:new Date("2026-09-21T12:00:00Z"),
});
assert.equal(fullyReady.stage,"decision_ready");
assert.equal(fullyReady.readiness.state,"decision_ready");
assert.ok(fullyReady.readiness.decision.businessQuality.score>85);
assert.ok(fullyReady.readiness.decision.investmentOpportunity.coveragePct>=80);
assert.ok(fullyReady.readiness.decision.evidenceConfidence.score>=85);
assert.ok(fullyReady.nextActions.some(a=>a.type==="complete"));

const notSelected=buildResearchCandidatePipeline({
  screenResult:{
    ticker:"NOPE",
    state:"watch",
    proposedForDeepResearch:false,
    profile:"software",
  },
  companyExists:true,
  valuationInput,
});
assert.equal(notSelected.stage,"not_selected");
assert.equal(notSelected.screening.eligible,false);
assert.equal(notSelected.valuation.result,null);
assert.equal(notSelected.readiness.decision,null);
assert.equal(notSelected.nextActions.length,1);
assert.equal(notSelected.nextActions[0].type,"screening");

// Screening quality is never substituted into readiness research scores.
assert.notEqual(screened.qualityCoreScore,fullyReady.readiness.decision.businessQuality.score);

console.log("Research candidate pipeline tests passed.");
