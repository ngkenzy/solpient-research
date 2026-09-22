import assert from "node:assert/strict";
import {
  RESEARCH_FACTORY_AUTOMATION_VERSION,
  isResearchFactoryReviewGate,
  isSafeResearchFactoryAutomationItem,
  summarizeResearchFactoryQueue,
} from "../lib/research-factory-v1.mjs";

assert.equal(RESEARCH_FACTORY_AUTOMATION_VERSION,"research-factory-v1.1");

const evidenceQueued={
  ticker:"SAFE1",
  stage:"evidence_ingestion",
  status:"queued",
  manual_review_count:0,
  next_actions:[{type:"evidence_ingestion",action:"collect evidence"}],
};
assert.equal(isSafeResearchFactoryAutomationItem(evidenceQueued),true);
assert.equal(isResearchFactoryReviewGate(evidenceQueued),false);

const baselineQueued={
  ticker:"SAFE2",
  stage:"baseline_draft",
  status:"queued",
  manual_review_count:0,
  next_actions:[],
};
assert.equal(isSafeResearchFactoryAutomationItem(baselineQueued),true);

const researchQueued={
  ticker:"SAFE3",
  stage:"research_draft",
  status:"running",
  manual_review_count:0,
  next_actions:[],
};
assert.equal(isSafeResearchFactoryAutomationItem(researchQueued),true);

const industryReview={
  ticker:"GATE1",
  stage:"research_draft",
  status:"needs_review",
  manual_review_count:0,
  next_actions:[{
    type:"industry_module_review",
    action:"Assign reviewed industry module",
  }],
};
assert.equal(isSafeResearchFactoryAutomationItem(industryReview),false);
assert.equal(isResearchFactoryReviewGate(industryReview),true);

const repairReview={
  ticker:"GATE2",
  stage:"baseline_draft",
  status:"needs_review",
  manual_review_count:1,
  next_actions:[{type:"repair_review",action:"Review missing source"}],
};
assert.equal(isResearchFactoryReviewGate(repairReview),true);

const valuationReview={
  ticker:"GATE3",
  stage:"valuation_review",
  status:"needs_review",
  manual_review_count:0,
  next_actions:[{type:"valuation_review",action:"Review assumptions"}],
};
assert.equal(isResearchFactoryReviewGate(valuationReview),true);
assert.equal(isSafeResearchFactoryAutomationItem(valuationReview),false);

const researchReview={
  ticker:"GATE4",
  stage:"research_review",
  status:"needs_review",
  next_actions:[],
};
assert.equal(isResearchFactoryReviewGate(researchReview),true);

const pipelineRefresh={
  ticker:"POST1",
  stage:"pipeline_refresh",
  status:"queued",
  next_actions:[],
};
assert.equal(isResearchFactoryReviewGate(pipelineRefresh),true);

const complete={
  ticker:"DONE1",
  stage:"complete",
  status:"complete",
  next_actions:[],
};
assert.equal(isResearchFactoryReviewGate(complete),true);

const blocked={
  ticker:"BLOCK1",
  stage:"evidence_ingestion",
  status:"blocked",
  next_actions:[],
};
assert.equal(isResearchFactoryReviewGate(blocked),false);
assert.equal(isSafeResearchFactoryAutomationItem(blocked),false);

const defensiveManualAction={
  ticker:"DEFENSE",
  stage:"baseline_draft",
  status:"queued",
  manual_review_count:0,
  next_actions:[{type:"repair_review",action:"Human judgment"}],
};
assert.equal(
  isSafeResearchFactoryAutomationItem(defensiveManualAction),
  false,
  "a stale queued status must not bypass an explicit human-review action"
);

const summary=summarizeResearchFactoryQueue([
  evidenceQueued,
  baselineQueued,
  industryReview,
  repairReview,
  valuationReview,
  researchReview,
  pipelineRefresh,
  complete,
  blocked,
]);
assert.equal(summary.candidate_count,9);
assert.equal(summary.safe_queue_count,2);
assert.equal(summary.review_gate_count,6);
assert.equal(summary.blocked_count,1);
assert.equal(summary.all_at_review_gate,false);

const completeSummary=summarizeResearchFactoryQueue([
  industryReview,
  repairReview,
  valuationReview,
  researchReview,
  pipelineRefresh,
  complete,
]);
assert.equal(completeSummary.safe_queue_count,0);
assert.equal(completeSummary.review_gate_count,6);
assert.equal(completeSummary.blocked_count,0);
assert.equal(completeSummary.all_at_review_gate,true);

console.log("Research Factory V1.1 queue expansion tests passed.");
