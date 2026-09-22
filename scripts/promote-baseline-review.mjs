import fs from "node:fs/promises";
import process from "node:process";
import { applyReviewPatch, validatePromotionReadiness } from "../lib/review-workbench.mjs";
import { promoteReviewedBaseline } from "../lib/promote-research.mjs";
import { REVIEW_ATTESTATION_VERSION, buildHumanReviewAttestation } from "../lib/review-attestation.mjs";
import { pgMaybeOne, insertObject, postgresConfigured } from "../lib/postgres-node.mjs";

const draftId=process.argv[2],reviewFile=process.argv[3];
if(!draftId||!reviewFile){
  console.error("Usage: node scripts/promote-baseline-review.mjs <draft-id> <review-patch.json>");
  process.exit(1);
}
if(!postgresConfigured())throw new Error("Missing SOLPIENT_DATABASE_URL.");

const patch=JSON.parse(await fs.readFile(reviewFile,"utf8"));
const draft=await pgMaybeOne(`select * from public.baseline_drafts where id=$1 limit 1`,[draftId]);
if(!draft)throw new Error("Draft not found.");

const payload=applyReviewPatch(draft.draft_payload,patch);
const readiness=validatePromotionReadiness(payload);
const now=new Date().toISOString();
const attestation=buildHumanReviewAttestation({draft,payload});

const review=await insertObject("baseline_reviews",{
  draft_id:draftId,
  status:readiness.ready?"ready":"editing",
  review_payload:patch,
  validation_result:readiness.standard,
  promotion_readiness:readiness,
  review_notes:"Saved and explicitly verified from authorized promotion workflow.",
  reviewed_at:now,
  prepared_at:now,
  preparation_source:"postgres_review_workflow",
  human_verified_at:readiness.ready?now:null,
  human_verified_by:readiness.ready?(process.env.GITHUB_ACTOR||process.env.REVIEW_WORKBENCH_REVIEWER||"authorized-reviewer"):null,
  human_verified_payload_hash:readiness.ready?attestation.payload_hash:null,
  attestation_version:readiness.ready?REVIEW_ATTESTATION_VERSION:null,
  updated_at:now,
},{conflict:["draft_id"],update:true,returning:"*"});

if(!readiness.ready){
  console.error(JSON.stringify({ready:false,blockers:readiness.blockers},null,2));
  process.exit(2);
}
const result=await promoteReviewedBaseline({supabase:null,draft,review,payload,promotedAt:now});
console.log(JSON.stringify({
  ready:true,
  ticker:payload.ticker,
  research_run_id:result.id,
  version:result.version,
  already_published:result.alreadyPublished,
  database:"postgres",
},null,2));
