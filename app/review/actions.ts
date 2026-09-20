"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin-supabase";
import { clearReviewAccess, requireReviewAccess, unlockReviewAccess } from "@/lib/review-auth";
// @ts-expect-error Node ESM research helper
import { applyReviewPatch, validatePromotionReadiness } from "@/lib/review-workbench.mjs";
// @ts-expect-error Node ESM research helper
import { promoteReviewedBaseline } from "@/lib/promote-research.mjs";

export async function unlockReviewAction(formData:FormData) {
  const ok=await unlockReviewAccess(String(formData.get("key") ?? ""));
  redirect(ok?"/review":"/review/login?error=1");
}
export async function logoutReviewAction() {
  await clearReviewAccess();
  redirect("/review/login");
}
export async function saveReviewAction(formData:FormData) {
  await requireReviewAccess();
  const supabase=getAdminSupabase();
  if (!supabase) redirect("/review/login?setup=1");
  const draftId=String(formData.get("draft_id") ?? "");
  if (!draftId) redirect("/review?error=missing-draft");

  let patch:any={};
  try { patch=JSON.parse(String(formData.get("review_payload") ?? "{}")); }
  catch { redirect("/review/"+draftId+"?error=invalid-json"); }

  const notes=String(formData.get("review_notes") ?? "").trim() || null;
  const { data:draft,error:draftError }=await supabase.from("baseline_drafts").select("*").eq("id",draftId).single();
  if (draftError || !draft) redirect("/review?error=draft-not-found");

  const merged=applyReviewPatch(draft.draft_payload,patch);
  const readiness=validatePromotionReadiness(merged);
  const now=new Date().toISOString();

  const { error:reviewError }=await supabase.from("baseline_reviews").upsert({
    draft_id:draftId,status:readiness.ready?"ready":"editing",review_payload:patch,
    validation_result:readiness.standard,promotion_readiness:readiness,
    review_notes:notes,reviewed_at:now,updated_at:now,
  },{onConflict:"draft_id"});
  if (reviewError) throw reviewError;

  const { error:updateError }=await supabase.from("baseline_drafts").update({
    status:readiness.ready?"ready_for_review":"generated",
    standard_valid:readiness.standard.valid,standard_status:readiness.standard.status,
    validation_result:readiness.standard,updated_at:now,
  }).eq("id",draftId);
  if (updateError) throw updateError;

  revalidatePath("/review");
  revalidatePath("/review/"+draftId);
  redirect("/review/"+draftId+"?saved=1");
}
export async function promoteReviewAction(formData:FormData) {
  await requireReviewAccess();
  const supabase=getAdminSupabase();
  if (!supabase) redirect("/review/login?setup=1");
  const draftId=String(formData.get("draft_id") ?? "");
  const [draftResult,reviewResult]=await Promise.all([
    supabase.from("baseline_drafts").select("*").eq("id",draftId).single(),
    supabase.from("baseline_reviews").select("*").eq("draft_id",draftId).maybeSingle(),
  ]);
  const draft=draftResult.data, review=reviewResult.data;
  if (draftResult.error || !draft) redirect("/review?error=draft-not-found");
  if (reviewResult.error || !review) redirect("/review/"+draftId+"?error=save-review-first");

  const merged=applyReviewPatch(draft.draft_payload,review.review_payload);
  const readiness=validatePromotionReadiness(merged);
  if (!readiness.ready) {
    await supabase.from("baseline_reviews").update({
      status:"editing",validation_result:readiness.standard,
      promotion_readiness:readiness,updated_at:new Date().toISOString(),
    }).eq("id",review.id);
    redirect("/review/"+draftId+"?promotion=blocked");
  }

  const result=await promoteReviewedBaseline({supabase,draft,review,payload:merged});
  revalidatePath("/");
  revalidatePath("/research");
  revalidatePath("/research/"+merged.ticker);
  revalidatePath("/review");
  redirect("/research/"+merged.ticker+"?published="+result.version);
}
