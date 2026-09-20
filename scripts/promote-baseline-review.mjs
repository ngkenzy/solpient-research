import fs from "node:fs/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { applyReviewPatch, validatePromotionReadiness } from "../lib/review-workbench.mjs";
import { promoteReviewedBaseline } from "../lib/promote-research.mjs";

const draftId=process.argv[2], reviewFile=process.argv[3];
if (!draftId || !reviewFile) {
  console.error("Usage: node scripts/promote-baseline-review.mjs <draft-id> <review-patch.json>");
  process.exit(1);
}
const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) throw new Error("Missing SUPABASE_URL and server secret.");
const supabase=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const patch=JSON.parse(await fs.readFile(reviewFile,"utf8"));
const {data:draft,error:draftError}=await supabase.from("baseline_drafts").select("*").eq("id",draftId).single();
if (draftError || !draft) throw draftError ?? new Error("Draft not found.");
const payload=applyReviewPatch(draft.draft_payload,patch);
const readiness=validatePromotionReadiness(payload);
const now=new Date().toISOString();
const {data:review,error:reviewError}=await supabase.from("baseline_reviews").upsert({
  draft_id:draftId,status:readiness.ready?"ready":"editing",review_payload:patch,
  validation_result:readiness.standard,promotion_readiness:readiness,
  review_notes:"Saved from authorized GitHub promotion workflow.",reviewed_at:now,updated_at:now,
},{onConflict:"draft_id"}).select("*").single();
if (reviewError) throw reviewError;
if (!readiness.ready) {
  console.error(JSON.stringify({ready:false,blockers:readiness.blockers},null,2));
  process.exit(2);
}
const result=await promoteReviewedBaseline({supabase,draft,review,payload,promotedAt:now});
console.log(JSON.stringify({ready:true,ticker:payload.ticker,research_run_id:result.id,version:result.version,already_published:result.alreadyPublished},null,2));
