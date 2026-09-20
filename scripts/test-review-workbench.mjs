import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { applyReviewPatch, defaultReviewTemplate, validatePromotionReadiness } from "../lib/review-workbench.mjs";

const adobe=JSON.parse(await fs.readFile("data/research/ADBE/2026-09-20-standard-v1.json","utf8"));
assert.equal(validatePromotionReadiness(adobe).ready,true);

const draft={
  ...structuredClone(adobe),
  research:{...adobe.research,status:"draft",summary:"Factory-generated evidence draft. Not published research."},
  business_assessment:{...adobe.business_assessment,moat_rating:null},
  risk_register:[],thesis_variables:[],expected_return_scenarios:[],scores:{},valuations:{},
};
assert.equal(defaultReviewTemplate(draft).scores.overall_score,null);

const merged=applyReviewPatch(draft,{
  research:{summary:adobe.research.summary,full_report:adobe.research.full_report},
  business_assessment:adobe.business_assessment,
  scores:adobe.scores,
  valuations:adobe.valuations,
  risk_register:adobe.risk_register,
  thesis_variables:adobe.thesis_variables,
  expected_return_scenarios:adobe.expected_return_scenarios,
  sources:adobe.sources,
});
assert.equal(merged.business_assessment.moat_rating,"wide");
assert.equal(merged.risk_register.length,5);
assert.equal(validatePromotionReadiness(merged).ready,true);
assert.equal(validatePromotionReadiness(applyReviewPatch(draft,{research:{summary:"Reviewed summary."}})).ready,false);
console.log("Review Workbench tests passed.");
