"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin-supabase";
import { clearReviewAccess, requireReviewAccess, unlockReviewAccess } from "@/lib/review-auth";
// @ts-expect-error Node ESM research helper
import { applyReviewPatch, mergeReviewPatches, validatePromotionReadiness } from "@/lib/review-workbench.mjs";
// @ts-expect-error Node ESM research helper
import { promoteReviewedBaseline } from "@/lib/promote-research.mjs";
// @ts-expect-error Node ESM research helper
import { buildEnrichmentReviewPatch, mergeReviewPatches as mergeEnrichmentReviewPatches } from "@/lib/evidence-enrichment.mjs";
// @ts-expect-error Node ESM research helper
import { buildBaselineDraft, BASELINE_FACTORY_VERSION } from "@/lib/baseline-factory.mjs";
// @ts-expect-error Node ESM research helper
import { composeResearchV1, RESEARCH_COMPOSER_VERSION } from "@/lib/research-composer.mjs";
// @ts-expect-error Node ESM research helper
import { validateResearchStandard } from "@/lib/research-standard.mjs";
// @ts-expect-error Node ESM research helper
import { buildCompanyHistory } from "@/lib/historical-peer-engine.mjs";
// @ts-expect-error Node ESM research helper
import { buildReferencePeerContext } from "@/lib/reference-peer-data.mjs";
// @ts-expect-error Node ESM research helper
import { REVIEW_ATTESTATION_VERSION, buildHumanReviewAttestation, validateHumanReviewAttestation } from "@/lib/review-attestation.mjs";

const clearedHumanVerification={
  human_verified_at:null,
  human_verified_by:null,
  human_verified_payload_hash:null,
  attestation_version:null,
};

function reviewerIdentity() {
  return process.env.REVIEW_WORKBENCH_REVIEWER?.trim() || "authorized-review-workbench";
}

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
    ...clearedHumanVerification,
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

export async function verifyReviewAction(formData:FormData) {
  await requireReviewAccess();
  const supabase=getAdminSupabase();
  if (!supabase) redirect("/review/login?setup=1");
  const draftId=String(formData.get("draft_id") ?? "");
  const confirmation=String(formData.get("human_verification") ?? "");
  if (!draftId) redirect("/review?error=missing-draft");
  if (confirmation!=="confirmed") redirect("/review/"+draftId+"?verification=confirm");

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
      status:"editing",
      validation_result:readiness.standard,
      promotion_readiness:readiness,
      ...clearedHumanVerification,
      updated_at:new Date().toISOString(),
    }).eq("id",review.id);
    redirect("/review/"+draftId+"?verification=blocked");
  }

  const attestation=buildHumanReviewAttestation({draft,payload:merged});
  const now=new Date().toISOString();
  const {error}=await supabase.from("baseline_reviews").update({
    status:"ready",
    validation_result:readiness.standard,
    promotion_readiness:readiness,
    reviewed_at:now,
    human_verified_at:now,
    human_verified_by:reviewerIdentity(),
    human_verified_payload_hash:attestation.payload_hash,
    attestation_version:REVIEW_ATTESTATION_VERSION,
    updated_at:now,
  }).eq("id",review.id);
  if (error) throw error;

  revalidatePath("/review");
  revalidatePath("/review/"+draftId);
  redirect("/review/"+draftId+"?verified=1");
}
export async function applyEnrichmentAction(formData:FormData) {
  await requireReviewAccess();
  const supabase=getAdminSupabase();
  if (!supabase) redirect("/review/login?setup=1");
  const draftId=String(formData.get("draft_id") ?? "");
  const runId=String(formData.get("run_id") ?? "");
  const [draftResult,reviewResult,itemResult]=await Promise.all([
    supabase.from("baseline_drafts").select("*").eq("id",draftId).single(),
    supabase.from("baseline_reviews").select("*").eq("draft_id",draftId).maybeSingle(),
    supabase.from("baseline_enrichment_items").select("*").eq("run_id",runId).eq("draft_id",draftId),
  ]);
  const draft=draftResult.data;
  if (draftResult.error || !draft) redirect("/review?error=draft-not-found");
  if (itemResult.error) throw itemResult.error;

  const enrichmentPatch=buildEnrichmentReviewPatch(itemResult.data ?? []);
  const combinedPatch=mergeEnrichmentReviewPatches(reviewResult.data?.review_payload ?? {},enrichmentPatch);
  const merged=applyReviewPatch(draft.draft_payload,combinedPatch);
  const readiness=validatePromotionReadiness(merged);
  const now=new Date().toISOString();

  const {error:reviewError}=await supabase.from("baseline_reviews").upsert({
    draft_id:draftId,status:readiness.ready?"ready":"editing",review_payload:combinedPatch,
    validation_result:readiness.standard,promotion_readiness:readiness,
    review_notes:reviewResult.data?.review_notes ?? "Primary-source enrichment applied.",
    reviewed_at:reviewResult.data?.reviewed_at ?? null,
    prepared_at:now,preparation_source:"evidence_enrichment",
    ...clearedHumanVerification,updated_at:now,
  },{onConflict:"draft_id"});
  if (reviewError) throw reviewError;

  const ids=(itemResult.data ?? []).filter((item:any)=>
    item.status==="proposed" &&
    ["high","medium"].includes(item.confidence) &&
    ["reported","derived"].includes(item.basis)
  ).map((item:any)=>item.id);
  if (ids.length) {
    const {error}=await supabase.from("baseline_enrichment_items").update({status:"accepted",applied_at:now}).in("id",ids);
    if (error) throw error;
  }
  const {error:runError}=await supabase.from("baseline_enrichment_runs").update({status:"applied"}).eq("id",runId);
  if (runError) throw runError;
  const {error:draftError}=await supabase.from("baseline_drafts").update({
    standard_valid:readiness.standard.valid,standard_status:readiness.standard.status,
    validation_result:readiness.standard,updated_at:now,
  }).eq("id",draftId);
  if (draftError) throw draftError;

  revalidatePath("/review");
  revalidatePath("/review/"+draftId);
  redirect("/review/"+draftId+"?enriched=1");
}

export async function applyComposerAction(formData:FormData) {
  await requireReviewAccess();
  const supabase=getAdminSupabase();
  if (!supabase) redirect("/review/login?setup=1");
  const draftId=String(formData.get("draft_id") ?? "");
  const compositionId=String(formData.get("composition_id") ?? "");
  const [draftResult,reviewResult,compositionResult]=await Promise.all([
    supabase.from("baseline_drafts").select("*").eq("id",draftId).single(),
    supabase.from("baseline_reviews").select("*").eq("draft_id",draftId).maybeSingle(),
    supabase.from("research_compositions").select("*").eq("id",compositionId).eq("draft_id",draftId).single(),
  ]);
  const draft=draftResult.data, composition=compositionResult.data;
  if (draftResult.error || !draft) redirect("/review?error=draft-not-found");
  if (compositionResult.error || !composition) redirect("/review/"+draftId+"?error=composer-not-found");

  const composerPatch=composition.composition_payload?.review_patch ?? {};
  const combinedPatch=mergeReviewPatches(reviewResult.data?.review_payload ?? {},composerPatch);
  const merged=applyReviewPatch(draft.draft_payload,combinedPatch);
  const readiness=validatePromotionReadiness(merged);
  const now=new Date().toISOString();

  const {error:reviewError}=await supabase.from("baseline_reviews").upsert({
    draft_id:draftId,status:readiness.ready?"ready":"editing",review_payload:combinedPatch,
    validation_result:readiness.standard,promotion_readiness:readiness,
    review_notes:reviewResult.data?.review_notes ?? "Automated Research Composer v1 applied; human review still required.",
    reviewed_at:reviewResult.data?.reviewed_at ?? null,
    prepared_at:now,preparation_source:"research_composer_v1",
    ...clearedHumanVerification,updated_at:now,
  },{onConflict:"draft_id"});
  if (reviewError) throw reviewError;

  const {error:compositionError}=await supabase.from("research_compositions").update({status:"applied",applied_at:now,updated_at:now}).eq("id",compositionId);
  if (compositionError) throw compositionError;
  const {error:draftUpdateError}=await supabase.from("baseline_drafts").update({
    status:readiness.ready?"ready_for_review":"generated",
    standard_valid:readiness.standard.valid,standard_status:readiness.standard.status,
    validation_result:readiness.standard,updated_at:now,
  }).eq("id",draftId);
  if (draftUpdateError) throw draftUpdateError;

  revalidatePath("/review");
  revalidatePath("/review/"+draftId);
  redirect("/review/"+draftId+"?composed=1");
}

export async function buildCompanyReviewAction(formData:FormData) {
  await requireReviewAccess();
  const supabase=getAdminSupabase();
  if (!supabase) redirect("/review/login?setup=1");

  const companyId=String(formData.get("company_id") ?? "");
  if (!companyId) redirect("/review?error=missing-company");

  const [companyResult,marketResult,marketHistoryResult,fundamentalResult,filingResult,contextResult]=await Promise.all([
    supabase.from("companies").select("*").eq("id",companyId).single(),
    supabase.from("market_snapshots").select("*").eq("company_id",companyId).order("trading_date",{ascending:false}).limit(1).maybeSingle(),
    supabase.from("market_snapshots").select("*").eq("company_id",companyId).order("trading_date",{ascending:false}).limit(3200),
    supabase.from("fundamental_snapshots").select("*").eq("company_id",companyId).order("period_end",{ascending:false}).limit(160),
    supabase.from("filing_events").select("id,provider,form_type,filed_at,accepted_at,accession_number,filing_url,period_end,title").eq("company_id",companyId).order("filed_at",{ascending:false}).limit(25),
    supabase.from("research_context_packs").select("*").eq("company_id",companyId).order("as_of_date",{ascending:false}).limit(1).maybeSingle(),
  ]);
  for (const result of [companyResult,marketResult,marketHistoryResult,fundamentalResult,filingResult,contextResult]) {
    if (result.error) throw result.error;
  }

  const company=companyResult.data;
  if (!company) redirect("/review?error=company-not-found");
  const now=new Date().toISOString();

  let contextForComposition:any=contextResult.data ?? {};
  try {
    const peerContext=await buildReferencePeerContext({ticker:company.ticker,asOfDate:now.slice(0,10)});
    const availablePeers=peerContext.peerComparison.filter((peer:any)=>peer.data_status==="available").length;
    if (peerContext.snapshotRows.length) {
      const rows=peerContext.snapshotRows.map((row:any)=>({...row,company_id:company.id}));
      for (let i=0;i<rows.length;i+=400) {
        const {error}=await supabase.from("peer_metric_snapshots").upsert(rows.slice(i,i+400),{
          onConflict:"company_id,peer_ticker,metric_key,as_of_date"
        });
        if (error) throw error;
      }
    }
    contextForComposition={
      ...contextForComposition,
      peer_set:peerContext.peerSet,
      peer_comparison:peerContext.peerComparison,
      summary:{
        ...(contextForComposition.summary ?? {}),
        configured_peers:peerContext.peerSet.length,
        peers_with_local_data:availablePeers,
      },
    };
    if (contextResult.data?.id) {
      const {error}=await supabase.from("research_context_packs").update({
        peer_set:peerContext.peerSet,
        peer_comparison:peerContext.peerComparison,
        summary:contextForComposition.summary,
        updated_at:now,
      }).eq("id",contextResult.data.id);
      if (error) throw error;
    }
  } catch {
    // Peer enrichment is best-effort. Decision-grade validation will keep publication blocked if coverage remains insufficient.
  }

  const history=buildCompanyHistory({
    company,
    fundamentals:fundamentalResult.data ?? [],
    markets:marketHistoryResult.data ?? [],
  });
  if (history.valuations.length) {
    for (let i=0;i<history.valuations.length;i+=400) {
      const {error}=await supabase.from("valuation_history").upsert(history.valuations.slice(i,i+400),{
        onConflict:"company_id,trading_date,provider"
      });
      if (error) throw error;
    }
  }

  const baseline=buildBaselineDraft({
    company,
    market:marketResult.data ?? null,
    fundamentals:fundamentalResult.data ?? [],
    filings:filingResult.data ?? [],
  });

  if (contextResult.data) {
    baseline.payload.factory.research_context={
      context_pack_id:contextResult.data.id,
      context_version:contextResult.data.context_version,
      as_of_date:contextResult.data.as_of_date,
      history_coverage:contextForComposition.history_coverage,
      trends:contextForComposition.trends,
      latest_metrics:contextForComposition.latest_metrics,
      peer_set:contextForComposition.peer_set,
      peer_comparison:contextForComposition.peer_comparison,
      capital_allocation:contextForComposition.capital_allocation,
      limitations:contextForComposition.limitations,
      summary:contextForComposition.summary,
    };
  }
  const {data:draft,error:draftError}=await supabase.from("baseline_drafts").upsert({
    company_id:company.id,
    generation_version:BASELINE_FACTORY_VERSION,
    generated_at:baseline.payload.factory.generated_at,
    source_cutoff_at:baseline.sourceCutoffAt,
    industry_module:baseline.industryModule,
    status:"generated",
    evidence_completeness_pct:baseline.evidenceCompletenessPct,
    standard_valid:baseline.validation.valid,
    standard_status:baseline.validation.status,
    validation_result:baseline.validation,
    evidence_summary:{...baseline.evidenceSummary,context_pack_id:contextResult.data?.id ?? null,context_version:contextResult.data?.context_version ?? null},
    draft_payload:baseline.payload,
    updated_at:now,
  },{onConflict:"company_id,generation_version,source_cutoff_at"}).select("*").single();
  if (draftError || !draft) throw draftError ?? new Error("Draft creation failed.");

  const composition=composeResearchV1({
    company,
    baselinePayload:draft.draft_payload,
    contextPack:contextForComposition,
    valuationHistory:history.valuations ?? [],
    asOfDate:now.slice(0,10),
  });
  const merged=applyReviewPatch(draft.draft_payload,composition.review_patch);
  const validation=validateResearchStandard(merged);
  const readiness=validatePromotionReadiness(merged);

  const {data:storedComposition,error:compositionError}=await supabase.from("research_compositions").upsert({
    draft_id:draft.id,
    company_id:company.id,
    engine_version:RESEARCH_COMPOSER_VERSION,
    context_pack_id:contextResult.data?.id ?? null,
    status:"applied",
    composition_payload:composition,
    validation_result:validation,
    generated_at:now,
    applied_at:now,
    updated_at:now,
  },{onConflict:"draft_id,engine_version"}).select("id").single();
  if (compositionError) throw compositionError;

  const {error:reviewError}=await supabase.from("baseline_reviews").upsert({
    draft_id:draft.id,
    status:readiness.ready?"ready":"editing",
    review_payload:composition.review_patch,
    validation_result:readiness.standard,
    promotion_readiness:readiness,
    review_notes:"Research package generated from the tracked evidence set. Human verification is required before publication.",
    reviewed_at:null,
    prepared_at:now,
    preparation_source:"factory_composer",
    ...clearedHumanVerification,
    updated_at:now,
  },{onConflict:"draft_id"});
  if (reviewError) throw reviewError;

  const {error:draftUpdateError}=await supabase.from("baseline_drafts").update({
    status:readiness.ready?"ready_for_review":"generated",
    standard_valid:readiness.standard.valid,
    standard_status:readiness.standard.status,
    validation_result:readiness.standard,
    updated_at:now,
  }).eq("id",draft.id);
  if (draftUpdateError) throw draftUpdateError;

  revalidatePath("/review");
  revalidatePath("/review/"+draft.id);
  redirect("/review/"+draft.id+"?built=1&composition="+storedComposition.id);
}

export async function prepareV2ReviewsAction() {
  await requireReviewAccess();
  const supabase=getAdminSupabase();
  if (!supabase) redirect("/review/login?setup=1");

  const [draftResult,reviewResult,compositionResult]=await Promise.all([
    supabase.from("baseline_drafts").select("*").neq("status","promoted"),
    supabase.from("baseline_reviews").select("draft_id,status"),
    supabase.from("research_compositions").select("*").eq("status","generated").order("generated_at",{ascending:true}),
  ]);
  if (draftResult.error) throw draftResult.error;
  if (reviewResult.error) throw reviewResult.error;
  if (compositionResult.error) throw compositionResult.error;

  const draftById=new Map((draftResult.data ?? []).map((row:any)=>[row.id,row]));
  const reviewedDrafts=new Set((reviewResult.data ?? []).map((row:any)=>row.draft_id));
  let prepared=0;

  for (const composition of compositionResult.data ?? []) {
    if (reviewedDrafts.has(composition.draft_id)) continue;
    const draft:any=draftById.get(composition.draft_id);
    if (!draft) continue;

    const composerPatch=composition.composition_payload?.review_patch ?? {};
    if (!Object.keys(composerPatch).length) continue;

    const merged=applyReviewPatch(draft.draft_payload,composerPatch);
    const readiness=validatePromotionReadiness(merged);
    const now=new Date().toISOString();

    const {error:insertReviewError}=await supabase.from("baseline_reviews").insert({
      draft_id:draft.id,
      status:readiness.ready?"ready":"editing",
      review_payload:composerPatch,
      validation_result:readiness.standard,
      promotion_readiness:readiness,
      review_notes:"Automated Research Composer v1 prepared this V2 review package. Human verification is required before publication.",
      reviewed_at:null,
      prepared_at:now,
      preparation_source:"automated_research_composer_v1",
      ...clearedHumanVerification,
      updated_at:now,
    });
    if (insertReviewError) throw insertReviewError;

    const {error:compositionError}=await supabase.from("research_compositions").update({
      status:"applied",applied_at:now,updated_at:now,
    }).eq("id",composition.id);
    if (compositionError) throw compositionError;

    const {error:draftError}=await supabase.from("baseline_drafts").update({
      status:readiness.ready?"ready_for_review":"generated",
      standard_valid:readiness.standard.valid,
      standard_status:readiness.standard.status,
      validation_result:readiness.standard,
      updated_at:now,
    }).eq("id",draft.id);
    if (draftError) throw draftError;

    prepared+=1;
  }

  revalidatePath("/review");
  redirect("/review?prepared="+prepared);
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

  const attestation=validateHumanReviewAttestation({draft,review,payload:merged});
  if (!attestation.valid) redirect("/review/"+draftId+"?promotion=verification-required");

  const result=await promoteReviewedBaseline({supabase,draft,review,payload:merged});
  revalidatePath("/");
  revalidatePath("/research");
  revalidatePath("/research/"+merged.ticker);
  revalidatePath("/review");
  redirect("/research/"+merged.ticker+"?published="+result.version);
}
