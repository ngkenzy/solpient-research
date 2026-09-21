import assert from "node:assert/strict";
import {
  READINESS,
  weightedScore,
  businessQualityScore,
  investmentOpportunityScore,
  evidenceConfidenceScore,
  readinessState,
  buildDecisionRanking,
  sortDecisionRankings,
  valuationGapScore,
  marginOfSafetyScore,
  downsideProtectionScore,
  returnScore,
} from "../lib/decision-ranking-engine.mjs";

const missing=weightedScore({
  a:{value:null,weight:50},
  b:{value:80,weight:50},
});
assert.equal(missing.score,80);
assert.equal(missing.coveragePct,50);
assert.deepEqual(missing.missing,["a"]);

const quality=businessQualityScore({
  quality_score:90,
  moat_score:80,
  financial_strength_score:100,
});
assert.equal(quality.coveragePct,100);
assert.ok(quality.score>87&&quality.score<90);

assert.equal(returnScore(null),null);
assert.equal(returnScore(-5),0);
assert.equal(returnScore(15),100);
assert.equal(valuationGapScore(50,100),100);
assert.equal(valuationGapScore(150,100),0);

assert.equal(marginOfSafetyScore(60,{
  base_value:100,mos_25_price:75,mos_35_price:65,bull_value:130
}),100);
assert.equal(marginOfSafetyScore(70,{
  base_value:100,mos_25_price:75,mos_35_price:65,bull_value:130
}),85);
assert.equal(marginOfSafetyScore(90,{
  base_value:100,mos_25_price:75,mos_35_price:65,bull_value:130
}),65);
assert.equal(marginOfSafetyScore(115,{
  base_value:100,mos_25_price:75,mos_35_price:65,bull_value:130
}),35);

assert.equal(downsideProtectionScore(100,100),50);
assert.equal(downsideProtectionScore(100,150),100);
assert.equal(downsideProtectionScore(100,40),0);

const opportunity=investmentOpportunityScore({
  price:70,
  valuation:{
    base_value:100,
    bear_value:80,
    bull_value:130,
    mos_25_price:75,
    mos_35_price:65,
  },
  base5yCagr:12,
});
assert.equal(opportunity.coveragePct,100);
assert.ok(opportunity.score>75);

const evidence=evidenceConfidenceScore({
  coverage:{
    fundamentals_pct:100,
    balance_sheet_pct:100,
    history_pct:100,
    market_history_pct:100,
    valuation_history_pct:80,
    capital_allocation_pct:100,
    peer_pct:100,
    industry_pct:100,
    consensus_pct:50,
    research_structure_pct:100,
    primary_source_quarters:8,
    normalized_quarters:8,
  },
  researchedAt:"2026-09-20T00:00:00Z",
  now:new Date("2026-09-21T00:00:00Z"),
});
assert.ok(evidence.score>=90);
assert.equal(evidence.coveragePct,100);

const decisionReady=buildDecisionRanking({
  scores:{
    quality_score:85,moat_score:85,financial_strength_score:90,overall_score:88,
  },
  valuation:{
    base_value:100,bear_value:75,bull_value:135,mos_25_price:75,mos_35_price:65,
  },
  price:68,
  base5yCagr:12,
  coverage:{
    engine_version:"coverage-v2",as_of_date:"2026-09-21",
    fundamentals_pct:100,balance_sheet_pct:100,history_pct:100,market_history_pct:100,
    valuation_history_pct:80,capital_allocation_pct:100,peer_pct:100,industry_pct:100,
    consensus_pct:50,research_structure_pct:100,primary_source_quarters:8,normalized_quarters:8,
  },
  researchedAt:"2026-09-20T00:00:00Z",
  now:new Date("2026-09-21T00:00:00Z"),
});
assert.equal(decisionReady.readiness.state,READINESS.DECISION_READY);
assert.equal(decisionReady.readiness.tier,2);
assert.ok(decisionReady.decisionScore>70);

const missingMoat=buildDecisionRanking({
  scores:{
    quality_score:85,moat_score:null,financial_strength_score:85,overall_score:85,
  },
  valuation:{
    base_value:100,bear_value:75,bull_value:135,mos_25_price:75,mos_35_price:65,
  },
  price:70,
  base5yCagr:12,
  coverage:{
    engine_version:"coverage-v2",
    fundamentals_pct:100,balance_sheet_pct:100,history_pct:100,market_history_pct:100,
    valuation_history_pct:80,capital_allocation_pct:100,peer_pct:100,industry_pct:100,
    consensus_pct:50,research_structure_pct:100,primary_source_quarters:8,normalized_quarters:8,
  },
  researchedAt:"2026-09-20T00:00:00Z",
  now:new Date("2026-09-21T00:00:00Z"),
});
assert.equal(missingMoat.businessQuality.score,85);
assert.equal(missingMoat.businessQuality.coveragePct,70);
assert.equal(missingMoat.readiness.state,READINESS.DECISION_READY);

const lowEvidence=buildDecisionRanking({
  scores:{quality_score:95,moat_score:95,financial_strength_score:95},
  valuation:{base_value:150,bear_value:100,bull_value:200,mos_25_price:112.5,mos_35_price:97.5},
  price:80,
  base5yCagr:15,
  coverage:{
    fundamentals_pct:100,balance_sheet_pct:100,history_pct:80,market_history_pct:100,
    valuation_history_pct:20,capital_allocation_pct:0,peer_pct:0,industry_pct:20,
    consensus_pct:0,research_structure_pct:100,primary_source_quarters:4,normalized_quarters:8,
  },
  researchedAt:"2026-09-20T00:00:00Z",
  now:new Date("2026-09-21T00:00:00Z"),
});
assert.equal(lowEvidence.readiness.state,READINESS.BUILDING);
assert.ok(lowEvidence.investmentOpportunity.score>80);
assert.ok(lowEvidence.evidenceConfidence.score<55);

const researchReady=buildDecisionRanking({
  scores:{quality_score:80,moat_score:75,financial_strength_score:85},
  valuation:{base_value:100,bear_value:70,bull_value:130,mos_25_price:75,mos_35_price:65},
  price:85,
  base5yCagr:8,
  coverage:{
    fundamentals_pct:90,balance_sheet_pct:90,history_pct:80,market_history_pct:100,
    valuation_history_pct:45,capital_allocation_pct:20,peer_pct:50,industry_pct:70,
    consensus_pct:20,research_structure_pct:100,primary_source_quarters:6,normalized_quarters:8,
  },
  researchedAt:"2026-09-20T00:00:00Z",
  now:new Date("2026-09-21T00:00:00Z"),
});
assert.equal(researchReady.readiness.state,READINESS.RESEARCH_READY);
assert.ok(researchReady.readiness.decisionReadyBlockers.length>0);

const sorted=[
  {ticker:"BUILD",decision:lowEvidence},
  {ticker:"DEC",decision:decisionReady},
  {ticker:"RES",decision:researchReady},
].sort(sortDecisionRankings);
assert.deepEqual(sorted.map((x)=>x.ticker),["DEC","RES","BUILD"]);

// Direct readiness test: unknown required metrics must not be treated as neutral evidence.
const unknown=readinessState({
  quality:{score:null,coveragePct:0},
  opportunity:{score:null,coveragePct:0},
  evidence:{score:null},
  coverage:{},
  price:null,
  valuation:{},
  base5yCagr:null,
});
assert.equal(unknown.state,READINESS.BUILDING);
assert.ok(unknown.blockers.length>=5);

console.log("Decision ranking engine tests passed.");
