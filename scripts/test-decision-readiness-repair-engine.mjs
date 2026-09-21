import assert from "node:assert/strict";
import {
  READINESS_REPAIR_METHODOLOGY_VERSION,
  TARGETS,
  buildDecisionReadinessRepairPlan,
  planToState,
} from "../lib/decision-readiness-repair-engine.mjs";

const base={
  businessQualityScore:90,
  businessQualityCoverage:70,
  businessQualityMissing:["moat"],
  investmentOpportunityScore:92,
  opportunityCoverage:100,
  opportunityMissing:[],
  price:80,
  baseValue:145,
  base5yCagr:14,
  researchedAt:"2026-09-21T00:00:00Z",
  now:new Date("2026-09-21T12:00:00Z"),
  coverageDetails:{configured_peer_target:4},
};

const deckLike={
  ...base,
  currentState:"building",
  evidenceConfidence:52.5,
  decisionScore:93.9,
  coverage:{
    fundamentals_pct:100,
    balance_sheet_pct:100,
    history_pct:80,
    market_history_pct:100,
    valuation_history_pct:19,
    capital_allocation_pct:0,
    peer_pct:0,
    industry_pct:16.7,
    consensus_pct:0,
    research_structure_pct:100,
    primary_source_quarters:0,
    normalized_quarters:5,
  },
};

const deckPlan=buildDecisionReadinessRepairPlan(deckLike);
assert.equal(deckPlan.methodologyVersion,READINESS_REPAIR_METHODOLOGY_VERSION);
assert.equal(deckPlan.nextState,"research_ready");
assert.ok(deckPlan.companyPriority>=70);
assert.ok(deckPlan.researchReadyPlan.reachable);
assert.ok(deckPlan.researchReadyPlan.estimatedFinalEvidenceConfidence>=TARGETS.research_ready.evidence_confidence);
assert.ok(deckPlan.decisionReadyPlan.reachable);
assert.ok(deckPlan.decisionReadyPlan.estimatedFinalEvidenceConfidence>=TARGETS.decision_ready.evidence_confidence);

const decisionKeys=new Set(deckPlan.decisionReadyPlan.actions.map(a=>a.coverageKey??a.kind));
assert.ok(decisionKeys.has("valuation_history_pct"));
assert.ok(decisionKeys.has("capital_allocation_pct"));
assert.ok(decisionKeys.has("peer_pct"));

const capital=deckPlan.decisionReadyPlan.actions.find(a=>a.coverageKey==="capital_allocation_pct");
assert.match(capital.instruction,/at least 3 complete fiscal years/i);
assert.equal(capital.automationMode,"manual");

const peers=deckPlan.decisionReadyPlan.actions.find(a=>a.coverageKey==="peer_pct");
assert.match(peers.instruction,/at least 2 of 4 configured peers/i);
assert.equal(peers.automationMode,"auto");

const valuation=deckPlan.decisionReadyPlan.actions.find(a=>a.coverageKey==="valuation_history_pct");
assert.match(valuation.instruction,/60\\+ valuation observations/i);
assert.match(valuation.instruction,/1\.4 years/i);

const researchReady={
  ...base,
  currentState:"research_ready",
  evidenceConfidence:65,
  decisionScore:66,
  coverage:{
    fundamentals_pct:100,
    balance_sheet_pct:100,
    history_pct:80,
    market_history_pct:100,
    valuation_history_pct:58.5,
    capital_allocation_pct:0,
    peer_pct:75,
    industry_pct:50,
    consensus_pct:0,
    research_structure_pct:100,
    primary_source_quarters:0,
    normalized_quarters:5,
  },
};
const msftPlan=buildDecisionReadinessRepairPlan(researchReady);
assert.equal(msftPlan.nextState,"decision_ready");
assert.ok(msftPlan.decisionReadyPlan.actions.some(a=>a.coverageKey==="valuation_history_pct"));
assert.ok(msftPlan.decisionReadyPlan.actions.some(a=>a.coverageKey==="capital_allocation_pct"));
assert.ok(msftPlan.decisionReadyPlan.reachable);

const decisionReady={
  ...base,
  currentState:"decision_ready",
  evidenceConfidence:90,
  decisionScore:70,
  businessQualityCoverage:100,
  coverage:{
    fundamentals_pct:100,
    balance_sheet_pct:100,
    history_pct:100,
    market_history_pct:100,
    valuation_history_pct:83,
    capital_allocation_pct:100,
    peer_pct:100,
    industry_pct:100,
    consensus_pct:20,
    research_structure_pct:100,
    primary_source_quarters:5,
    normalized_quarters:5,
  },
};
const readyPlan=buildDecisionReadinessRepairPlan(decisionReady);
assert.equal(readyPlan.companyPriority,0);
assert.equal(readyPlan.decisionReadyPlan.repairCount,0);
assert.ok(readyPlan.decisionReadyPlan.reachable);

const missingCore={
  ...base,
  currentState:"building",
  evidenceConfidence:30,
  decisionScore:50,
  businessQualityCoverage:40,
  opportunityCoverage:55,
  price:null,
  baseValue:null,
  base5yCagr:null,
  coverage:{
    fundamentals_pct:50,
    balance_sheet_pct:50,
    history_pct:40,
    market_history_pct:50,
    valuation_history_pct:0,
    capital_allocation_pct:0,
    peer_pct:0,
    industry_pct:0,
    consensus_pct:0,
    research_structure_pct:60,
    primary_source_quarters:0,
    normalized_quarters:5,
  },
};
const corePlan=planToState(missingCore,"research_ready");
assert.ok(corePlan.actions.some(a=>a.kind==="business_quality_coverage"));
assert.ok(corePlan.actions.some(a=>a.kind==="opportunity_coverage"));
assert.ok(corePlan.actions.some(a=>a.kind==="price"));
assert.ok(corePlan.actions.some(a=>a.kind==="base_value"));
assert.ok(corePlan.actions.some(a=>a.coverageKey==="fundamentals_pct"));
assert.ok(corePlan.actions.some(a=>a.coverageKey==="history_pct"));
assert.ok(corePlan.actions.some(a=>a.coverageKey==="research_structure_pct"));

const phase2Items=deckPlan.items.filter(a=>a.phase2Sensitive);
for(const item of phase2Items){
  assert.equal(item.automationMode,"monitor");
  assert.ok(item.priority<100);
}

console.log("Decision readiness repair engine tests passed.");
