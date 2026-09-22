"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin-supabase";
import {
  commitComposerApply,
  commitEnrichmentApply,
  commitPreparedReview,
  getReviewDraftPair,
  loadComposerApplyData,
  loadEnrichmentApplyData,
  loadPrepareV2Data,
  saveReviewState,
  updateReviewVerification,
} from "@/lib/repositories/review-workbench";
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
  const draftId=String(formData.get("draft_id") ?? "");
  if (!draftId) redirect("/review?error=missing-draft");

  let patch:any={};
  try { patch=JSON.parse(String(formData.get("review_payload") ?? "{}")); }
  catch { redirect("/review/"+draftId+"?error=invalid-json"); }

  const notes=String(formData.get("review_notes") ?? "").trim() || null;
  const {draft}=await getReviewDraftPair(draftId);
  if (!draft) redirect("/review?error=draft-not-found");

  const merged=applyReviewPatch(draft.draft_payload,patch);
  const readiness=validatePromotionReadiness(merged);
  const now=new Date().toISOString();

  await saveReviewState({
    draftId,
    status:readiness.ready?"ready":"editing",
    reviewPayload:patch,
    validationResult:readiness.standard,
    promotionReadiness:readiness,
    reviewNotes:notes,
    reviewedAt:now,
    draftStatus:readiness.ready?"ready_for_review":"generated",
    standardValid:readiness.standard.valid,
    standardStatus:readiness.standard.status,
    now,
  });

  revalidatePath("/review");
  revalidatePath("/review/"+draftId);
  redirect("/review/"+draftId+"?saved=1");
}

export async function verifyReviewAction(formData:FormData) {
  await requireReviewAccess();
  const draftId=String(formData.get("draft_id") ?? "");
  const confirmation=String(formData.get("human_verification") ?? "");
  if (!draftId) redirect("/review?error=missing-draft");
  if (confirmation!=="confirmed") redirect("/review/"+draftId+"?verification=confirm");

  const {draft,review}=await getReviewDraftPair(draftId);
  if (!draft) redirect("/review?error=draft-not-found");
  if (!review) redirect("/review/"+draftId+"?error=save-review-first");

  const merged=applyReviewPatch(draft.draft_payload,review.review_payload);
  const readiness=validatePromotionReadiness(merged);
  const now=new Date().toISOString();

  if (!readiness.ready) {
    await updateReviewVerification({
      reviewId:review.id,
      status:"editing",
      validationResult:readiness.standard,
      promotionReadiness:readiness,
      humanVerifiedAt:null,
      humanVerifiedBy:null,
      humanVerifiedPayloadHash:null,
      attestationVersion:null,
      now,
    });
    redirect("/review/"+draftId+"?verification=blocked");
  }

  const attestation=buildHumanReviewAttestation({draft,payload:merged});
  await updateReviewVerification({
    reviewId:review.id,
    status:"ready",
    validationResult:readiness.standard,
    promotionReadiness:readiness,
    humanVerifiedAt:now,
    humanVerifiedBy:reviewerIdentity(),
    humanVerifiedPayloadHash:attestation.payload_hash,
    attestationVersion:REVIEW_ATTESTATION_VERSION,
    now,
  });

  revalidatePath("/review");
  revalidatePath("/review/"+draftId);
  redirect("/review/"+draftId+"?verified=1");
}

export async function applyEnrichmentAction(formData:FormData) {
  await requireReviewAccess();
  const draftId=String(formData.get("draft_id") ?? "");
  const runId=String(formData.get("run_id") ?? "");

  const {draft,review,items}=await loadEnrichmentApplyData(draftId,runId);
  if (!draft) redirect("/review?error=draft-not-found");

  const enrichmentPatch=buildEnrichmentReviewPatch(items);
  const combinedPatch=mergeEnrichmentReviewPatches(review?.review_payload ?? {},enrichmentPatch);
  const merged=applyReviewPatch(draft.draft_payload,combinedPatch);
  const readiness=validatePromotionReadiness(merged);
  const now=new Date().toISOString();

  const ids=items.filter((item:any)=>
    item.status==="proposed" &&
    ["high","medium"].includes(item.confidence) &&
    ["reported","derived"].includes(item.basis)
  ).map((item:any)=>item.id);

  await commitEnrichmentApply({
    draftId,
    runId,
    acceptedIds:ids,
    status:readiness.ready?"ready":"editing",
    reviewPayload:combinedPatch,
    validationResult:readiness.standard,
    promotionReadiness:readiness,
    reviewNotes:review?.review_notes ?? "Primary-source enrichment applied.",
    reviewedAt:review?.reviewed_at ?? null,
    now,
    standardValid:readiness.standard.valid,
    standardStatus:readiness.standard.status,
  });

  revalidatePath("/review");
  revalidatePath("/review/"+draftId);
  redirect("/review/"+draftId+"?enriched=1");
}

export async function applyComposerAction(formData:FormData) {
  await requireReviewAccess();
  const draftId=String(formData.get("draft_id") ?? "");
  const compositionId=String(formData.get("composition_id") ?? "");

  const {draft,review,composition}=await loadComposerApplyData(draftId,compositionId);
  if (!draft) redirect("/review?error=draft-not-found");
  if (!composition) redirect("/review/"+draftId+"?error=composer-not-found");

  const composerPatch=composition.composition_payload?.review_patch ?? {};
  const combinedPatch=mergeReviewPatches(review?.review_payload ?? {},composerPatch);
  const merged=applyReviewPatch(draft.draft_payload,combinedPatch);
  const readiness=validatePromotionReadiness(merged);
  const now=new Date().toISOString();

  await commitComposerApply({
    draftId,
    compositionId,
    status:readiness.ready?"ready":"editing",
    reviewPayload:combinedPatch,
    validationResult:readiness.standard,
    promotionReadiness:readiness,
    reviewNotes:review?.review_notes ?? "Automated Research Composer v1 applied; human review still required.",
    reviewedAt:review?.reviewed_at ?? null,
    now,
    draftStatus:readiness.ready?"ready_for_review":"generated",
    standardValid:readiness.standard.valid,
    standardStatus:readiness.standard.status,
  });

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
  const data=await loadPrepareV2Data();
  if (!data) redirect("/review/login?setup=1");

  const draftById=new Map(data.drafts.map((row:any)=>[row.id,row]));
  const reviewedDrafts=new Set(data.reviews.map((row:any)=>row.draft_id));
  let prepared=0;

  for (const composition of data.compositions) {
    if (reviewedDrafts.has(composition.draft_id)) continue;
    const draft:any=draftById.get(composition.draft_id);
    if (!draft) continue;

    const composerPatch=composition.composition_payload?.review_patch ?? {};
    if (!Object.keys(composerPatch).length) continue;

    const merged=applyReviewPatch(draft.draft_payload,composerPatch);
    const readiness=validatePromotionReadiness(merged);
    const now=new Date().toISOString();

    await commitPreparedReview({
      draftId:draft.id,
      compositionId:composition.id,
      status:readiness.ready?"ready":"editing",
      reviewPayload:composerPatch,
      validationResult:readiness.standard,
      promotionReadiness:readiness,
      now,
      draftStatus:readiness.ready?"ready_for_review":"generated",
      standardValid:readiness.standard.valid,
      standardStatus:readiness.standard.status,
    });
    reviewedDrafts.add(draft.id);
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
