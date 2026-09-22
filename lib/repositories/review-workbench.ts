import "server-only";

import { databaseConfigured, dbQuery, withDbTransaction } from "@/lib/db";
import { getAdminSupabase } from "@/lib/admin-supabase";

const j=(value:unknown)=>JSON.stringify(value??null);

export function directReviewDbConfigured(){
  return databaseConfigured();
}

export async function loadReviewQueueData(){
  if(databaseConfigured()){
    const [companies,drafts,reviews,compositions,runs,coverage]=await Promise.all([
      dbQuery<any>(`select id,ticker,company_name from public.companies order by ticker`),
      dbQuery<any>(`select id,company_id,generation_version,generated_at,source_cutoff_at,industry_module,status,evidence_completeness_pct,standard_status,published_run_id from public.baseline_drafts order by generated_at desc`),
      dbQuery<any>(`select draft_id,status,promotion_readiness,reviewed_at,prepared_at,preparation_source,human_verified_at,human_verified_by,human_verified_payload_hash,attestation_version,published_run_id from public.baseline_reviews`),
      dbQuery<any>(`select id,draft_id,company_id,engine_version,status,validation_result,generated_at from public.research_compositions order by generated_at desc`),
      dbQuery<any>(`select id,company_id,version,researched_at,standard_version,standard_status,completeness_pct from public.research_runs where status='published' order by version desc`),
      dbQuery<any>(`select company_id,status,overall_pct,generated_at from public.data_coverage_reports order by generated_at desc`),
    ]);
    return {source:"postgres" as const,companies,drafts,reviews,compositions,runs,coverage};
  }

  const supabase=getAdminSupabase();
  if(!supabase)return null;
  const [companyResult,draftResult,reviewResult,compositionResult,runResult,coverageResult]=await Promise.all([
    supabase.from("companies").select("id,ticker,company_name").order("ticker"),
    supabase.from("baseline_drafts").select("id,company_id,generation_version,generated_at,source_cutoff_at,industry_module,status,evidence_completeness_pct,standard_status,published_run_id").order("generated_at",{ascending:false}),
    supabase.from("baseline_reviews").select("draft_id,status,promotion_readiness,reviewed_at,prepared_at,preparation_source,human_verified_at,human_verified_by,human_verified_payload_hash,attestation_version,published_run_id"),
    supabase.from("research_compositions").select("id,draft_id,company_id,engine_version,status,validation_result,generated_at").order("generated_at",{ascending:false}),
    supabase.from("research_runs").select("id,company_id,version,researched_at,standard_version,standard_status,completeness_pct").eq("status","published").order("version",{ascending:false}),
    supabase.from("data_coverage_reports").select("company_id,status,overall_pct,generated_at").order("generated_at",{ascending:false}),
  ]);
  for(const result of [companyResult,draftResult,reviewResult,compositionResult,runResult,coverageResult]){
    if(result.error)throw result.error;
  }
  return {
    source:"supabase" as const,
    companies:companyResult.data??[],
    drafts:draftResult.data??[],
    reviews:reviewResult.data??[],
    compositions:compositionResult.data??[],
    runs:runResult.data??[],
    coverage:coverageResult.data??[],
  };
}

export async function loadReviewDraftData(id:string){
  if(databaseConfigured()){
    const [draft,review,enrichmentRun,composition]=await Promise.all([
      dbQuery<any>(`select * from public.baseline_drafts where id=$1 limit 1`,[id]).then(r=>r[0]??null),
      dbQuery<any>(`select * from public.baseline_reviews where draft_id=$1 limit 1`,[id]).then(r=>r[0]??null),
      dbQuery<any>(`select * from public.baseline_enrichment_runs where draft_id=$1 order by generated_at desc limit 1`,[id]).then(r=>r[0]??null),
      dbQuery<any>(`select * from public.research_compositions where draft_id=$1 order by generated_at desc limit 1`,[id]).then(r=>r[0]??null),
    ]);
    if(!draft)return {source:"postgres" as const,draft:null,review:null,enrichmentRun:null,composition:null,company:null,enrichmentItems:[]};
    const [company,enrichmentItems]=await Promise.all([
      dbQuery<any>(`select ticker,company_name from public.companies where id=$1 limit 1`,[draft.company_id]).then(r=>r[0]??null),
      enrichmentRun
        ? dbQuery<any>(`select * from public.baseline_enrichment_items where run_id=$1 order by created_at`,[enrichmentRun.id])
        : Promise.resolve([]),
    ]);
    return {source:"postgres" as const,draft,review,enrichmentRun,composition,company,enrichmentItems};
  }

  const supabase=getAdminSupabase();
  if(!supabase)return null;
  const [draftResult,reviewResult,enrichmentRunResult,compositionResult]=await Promise.all([
    supabase.from("baseline_drafts").select("*").eq("id",id).single(),
    supabase.from("baseline_reviews").select("*").eq("draft_id",id).maybeSingle(),
    supabase.from("baseline_enrichment_runs").select("*").eq("draft_id",id).order("generated_at",{ascending:false}).limit(1).maybeSingle(),
    supabase.from("research_compositions").select("*").eq("draft_id",id).order("generated_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  if(draftResult.error||!draftResult.data)throw draftResult.error??new Error("Draft not found.");
  const draft=draftResult.data;
  const {data:company,error:companyError}=await supabase.from("companies").select("ticker,company_name").eq("id",draft.company_id).single();
  if(companyError)throw companyError;
  let enrichmentItems:any[]=[];
  if(enrichmentRunResult.data){
    const result=await supabase.from("baseline_enrichment_items").select("*").eq("run_id",enrichmentRunResult.data.id).order("created_at");
    if(result.error)throw result.error;
    enrichmentItems=result.data??[];
  }
  return {
    source:"supabase" as const,
    draft,
    review:reviewResult.data??null,
    enrichmentRun:enrichmentRunResult.data??null,
    composition:compositionResult.data??null,
    company,
    enrichmentItems,
  };
}

export async function getReviewDraftPair(draftId:string){
  if(databaseConfigured()){
    const [draft,review]=await Promise.all([
      dbQuery<any>(`select * from public.baseline_drafts where id=$1 limit 1`,[draftId]).then(r=>r[0]??null),
      dbQuery<any>(`select * from public.baseline_reviews where draft_id=$1 limit 1`,[draftId]).then(r=>r[0]??null),
    ]);
    return {draft,review};
  }
  const supabase=getAdminSupabase();
  if(!supabase)return {draft:null,review:null};
  const [draftResult,reviewResult]=await Promise.all([
    supabase.from("baseline_drafts").select("*").eq("id",draftId).maybeSingle(),
    supabase.from("baseline_reviews").select("*").eq("draft_id",draftId).maybeSingle(),
  ]);
  if(draftResult.error)throw draftResult.error;
  if(reviewResult.error)throw reviewResult.error;
  return {draft:draftResult.data??null,review:reviewResult.data??null};
}

export async function saveReviewState(args:{
  draftId:string;
  status:string;
  reviewPayload:any;
  validationResult:any;
  promotionReadiness:any;
  reviewNotes:string|null;
  reviewedAt:string|null;
  preparedAt?:string|null;
  preparationSource?:string|null;
  draftStatus:string;
  standardValid:boolean;
  standardStatus:string;
  now:string;
}){
  if(databaseConfigured()){
    return withDbTransaction(async(client)=>{
      await client.query(
        `insert into public.baseline_reviews(
          draft_id,status,review_payload,validation_result,promotion_readiness,review_notes,reviewed_at,
          prepared_at,preparation_source,human_verified_at,human_verified_by,human_verified_payload_hash,
          attestation_version,updated_at
        ) values($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9,null,null,null,null,$10)
        on conflict(draft_id) do update set
          status=excluded.status,
          review_payload=excluded.review_payload,
          validation_result=excluded.validation_result,
          promotion_readiness=excluded.promotion_readiness,
          review_notes=excluded.review_notes,
          reviewed_at=excluded.reviewed_at,
          prepared_at=coalesce(excluded.prepared_at,baseline_reviews.prepared_at),
          preparation_source=coalesce(excluded.preparation_source,baseline_reviews.preparation_source),
          human_verified_at=null,human_verified_by=null,human_verified_payload_hash=null,attestation_version=null,
          updated_at=excluded.updated_at`,
        [args.draftId,args.status,j(args.reviewPayload),j(args.validationResult),j(args.promotionReadiness),args.reviewNotes,args.reviewedAt,args.preparedAt??null,args.preparationSource??null,args.now],
      );
      await client.query(
        `update public.baseline_drafts
         set status=$2,standard_valid=$3,standard_status=$4,validation_result=$5::jsonb,updated_at=$6
         where id=$1`,
        [args.draftId,args.draftStatus,args.standardValid,args.standardStatus,j(args.validationResult),args.now],
      );
    });
  }

  const supabase=getAdminSupabase();
  if(!supabase)throw new Error("Admin data source is not configured.");
  const {error:reviewError}=await supabase.from("baseline_reviews").upsert({
    draft_id:args.draftId,status:args.status,review_payload:args.reviewPayload,
    validation_result:args.validationResult,promotion_readiness:args.promotionReadiness,
    review_notes:args.reviewNotes,reviewed_at:args.reviewedAt,
    ...(args.preparedAt!==undefined?{prepared_at:args.preparedAt}:{}),
    ...(args.preparationSource!==undefined?{preparation_source:args.preparationSource}:{}),
    human_verified_at:null,human_verified_by:null,human_verified_payload_hash:null,attestation_version:null,
    updated_at:args.now,
  },{onConflict:"draft_id"});
  if(reviewError)throw reviewError;
  const {error:draftError}=await supabase.from("baseline_drafts").update({
    status:args.draftStatus,standard_valid:args.standardValid,standard_status:args.standardStatus,
    validation_result:args.validationResult,updated_at:args.now,
  }).eq("id",args.draftId);
  if(draftError)throw draftError;
}

export async function updateReviewVerification(args:{
  reviewId:string;
  status:string;
  validationResult:any;
  promotionReadiness:any;
  now:string;
  humanVerifiedAt:string|null;
  humanVerifiedBy:string|null;
  humanVerifiedPayloadHash:string|null;
  attestationVersion:string|null;
}){
  if(databaseConfigured()){
    await dbQuery(
      `update public.baseline_reviews set
         status=$2,validation_result=$3::jsonb,promotion_readiness=$4::jsonb,
         reviewed_at=case when $5::timestamptz is null then reviewed_at else $5::timestamptz end,
         human_verified_at=$5::timestamptz,human_verified_by=$6,human_verified_payload_hash=$7,
         attestation_version=$8,updated_at=$9::timestamptz
       where id=$1`,
      [args.reviewId,args.status,j(args.validationResult),j(args.promotionReadiness),args.humanVerifiedAt,args.humanVerifiedBy,args.humanVerifiedPayloadHash,args.attestationVersion,args.now],
    );
    return;
  }
  const supabase=getAdminSupabase();
  if(!supabase)throw new Error("Admin data source is not configured.");
  const payload:any={
    status:args.status,validation_result:args.validationResult,promotion_readiness:args.promotionReadiness,
    human_verified_at:args.humanVerifiedAt,human_verified_by:args.humanVerifiedBy,
    human_verified_payload_hash:args.humanVerifiedPayloadHash,attestation_version:args.attestationVersion,
    updated_at:args.now,
  };
  if(args.humanVerifiedAt)payload.reviewed_at=args.humanVerifiedAt;
  const {error}=await supabase.from("baseline_reviews").update(payload).eq("id",args.reviewId);
  if(error)throw error;
}

export async function loadEnrichmentApplyData(draftId:string,runId:string){
  if(databaseConfigured()){
    const [draft,review,items]=await Promise.all([
      dbQuery<any>(`select * from public.baseline_drafts where id=$1 limit 1`,[draftId]).then(r=>r[0]??null),
      dbQuery<any>(`select * from public.baseline_reviews where draft_id=$1 limit 1`,[draftId]).then(r=>r[0]??null),
      dbQuery<any>(`select * from public.baseline_enrichment_items where run_id=$1 and draft_id=$2`,[runId,draftId]),
    ]);
    return {draft,review,items};
  }
  const supabase=getAdminSupabase();
  if(!supabase)return {draft:null,review:null,items:[]};
  const [draftResult,reviewResult,itemResult]=await Promise.all([
    supabase.from("baseline_drafts").select("*").eq("id",draftId).maybeSingle(),
    supabase.from("baseline_reviews").select("*").eq("draft_id",draftId).maybeSingle(),
    supabase.from("baseline_enrichment_items").select("*").eq("run_id",runId).eq("draft_id",draftId),
  ]);
  if(draftResult.error)throw draftResult.error;
  if(reviewResult.error)throw reviewResult.error;
  if(itemResult.error)throw itemResult.error;
  return {draft:draftResult.data??null,review:reviewResult.data??null,items:itemResult.data??[]};
}

export async function commitEnrichmentApply(args:{
  draftId:string;runId:string;acceptedIds:string[];status:string;reviewPayload:any;validationResult:any;
  promotionReadiness:any;reviewNotes:string|null;reviewedAt:string|null;now:string;standardValid:boolean;standardStatus:string;
}){
  if(databaseConfigured()){
    return withDbTransaction(async(client)=>{
      await client.query(
        `insert into public.baseline_reviews(
          draft_id,status,review_payload,validation_result,promotion_readiness,review_notes,reviewed_at,
          prepared_at,preparation_source,human_verified_at,human_verified_by,human_verified_payload_hash,
          attestation_version,updated_at
        ) values($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,'evidence_enrichment',null,null,null,null,$8)
        on conflict(draft_id) do update set
          status=excluded.status,review_payload=excluded.review_payload,validation_result=excluded.validation_result,
          promotion_readiness=excluded.promotion_readiness,review_notes=excluded.review_notes,reviewed_at=excluded.reviewed_at,
          prepared_at=excluded.prepared_at,preparation_source=excluded.preparation_source,
          human_verified_at=null,human_verified_by=null,human_verified_payload_hash=null,attestation_version=null,
          updated_at=excluded.updated_at`,
        [args.draftId,args.status,j(args.reviewPayload),j(args.validationResult),j(args.promotionReadiness),args.reviewNotes,args.reviewedAt,args.now],
      );
      if(args.acceptedIds.length){
        await client.query(
          `update public.baseline_enrichment_items set status='accepted',applied_at=$2::timestamptz where id=any($1::uuid[])`,
          [args.acceptedIds,args.now],
        );
      }
      await client.query(`update public.baseline_enrichment_runs set status='applied' where id=$1`,[args.runId]);
      await client.query(
        `update public.baseline_drafts set standard_valid=$2,standard_status=$3,validation_result=$4::jsonb,updated_at=$5::timestamptz where id=$1`,
        [args.draftId,args.standardValid,args.standardStatus,j(args.validationResult),args.now],
      );
    });
  }
  const supabase=getAdminSupabase();
  if(!supabase)throw new Error("Admin data source is not configured.");
  const {error:r}=await supabase.from("baseline_reviews").upsert({
    draft_id:args.draftId,status:args.status,review_payload:args.reviewPayload,validation_result:args.validationResult,
    promotion_readiness:args.promotionReadiness,review_notes:args.reviewNotes,reviewed_at:args.reviewedAt,
    prepared_at:args.now,preparation_source:"evidence_enrichment",
    human_verified_at:null,human_verified_by:null,human_verified_payload_hash:null,attestation_version:null,updated_at:args.now,
  },{onConflict:"draft_id"});
  if(r)throw r;
  if(args.acceptedIds.length){
    const {error}=await supabase.from("baseline_enrichment_items").update({status:"accepted",applied_at:args.now}).in("id",args.acceptedIds);
    if(error)throw error;
  }
  const {error:runError}=await supabase.from("baseline_enrichment_runs").update({status:"applied"}).eq("id",args.runId);
  if(runError)throw runError;
  const {error:draftError}=await supabase.from("baseline_drafts").update({
    standard_valid:args.standardValid,standard_status:args.standardStatus,validation_result:args.validationResult,updated_at:args.now,
  }).eq("id",args.draftId);
  if(draftError)throw draftError;
}

export async function loadComposerApplyData(draftId:string,compositionId:string){
  if(databaseConfigured()){
    const [draft,review,composition]=await Promise.all([
      dbQuery<any>(`select * from public.baseline_drafts where id=$1 limit 1`,[draftId]).then(r=>r[0]??null),
      dbQuery<any>(`select * from public.baseline_reviews where draft_id=$1 limit 1`,[draftId]).then(r=>r[0]??null),
      dbQuery<any>(`select * from public.research_compositions where id=$1 and draft_id=$2 limit 1`,[compositionId,draftId]).then(r=>r[0]??null),
    ]);
    return {draft,review,composition};
  }
  const supabase=getAdminSupabase();
  if(!supabase)return {draft:null,review:null,composition:null};
  const [draftResult,reviewResult,compositionResult]=await Promise.all([
    supabase.from("baseline_drafts").select("*").eq("id",draftId).maybeSingle(),
    supabase.from("baseline_reviews").select("*").eq("draft_id",draftId).maybeSingle(),
    supabase.from("research_compositions").select("*").eq("id",compositionId).eq("draft_id",draftId).maybeSingle(),
  ]);
  if(draftResult.error)throw draftResult.error;
  if(reviewResult.error)throw reviewResult.error;
  if(compositionResult.error)throw compositionResult.error;
  return {draft:draftResult.data??null,review:reviewResult.data??null,composition:compositionResult.data??null};
}

export async function commitComposerApply(args:{
  draftId:string;compositionId:string;status:string;reviewPayload:any;validationResult:any;promotionReadiness:any;
  reviewNotes:string|null;reviewedAt:string|null;now:string;draftStatus:string;standardValid:boolean;standardStatus:string;
}){
  if(databaseConfigured()){
    return withDbTransaction(async(client)=>{
      await client.query(
        `insert into public.baseline_reviews(
          draft_id,status,review_payload,validation_result,promotion_readiness,review_notes,reviewed_at,
          prepared_at,preparation_source,human_verified_at,human_verified_by,human_verified_payload_hash,
          attestation_version,updated_at
        ) values($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,'research_composer_v1',null,null,null,null,$8)
        on conflict(draft_id) do update set
          status=excluded.status,review_payload=excluded.review_payload,validation_result=excluded.validation_result,
          promotion_readiness=excluded.promotion_readiness,review_notes=excluded.review_notes,reviewed_at=excluded.reviewed_at,
          prepared_at=excluded.prepared_at,preparation_source=excluded.preparation_source,
          human_verified_at=null,human_verified_by=null,human_verified_payload_hash=null,attestation_version=null,
          updated_at=excluded.updated_at`,
        [args.draftId,args.status,j(args.reviewPayload),j(args.validationResult),j(args.promotionReadiness),args.reviewNotes,args.reviewedAt,args.now],
      );
      await client.query(
        `update public.research_compositions set status='applied',applied_at=$2::timestamptz,updated_at=$2::timestamptz where id=$1`,
        [args.compositionId,args.now],
      );
      await client.query(
        `update public.baseline_drafts set status=$2,standard_valid=$3,standard_status=$4,validation_result=$5::jsonb,updated_at=$6::timestamptz where id=$1`,
        [args.draftId,args.draftStatus,args.standardValid,args.standardStatus,j(args.validationResult),args.now],
      );
    });
  }
  const supabase=getAdminSupabase();
  if(!supabase)throw new Error("Admin data source is not configured.");
  const {error:r}=await supabase.from("baseline_reviews").upsert({
    draft_id:args.draftId,status:args.status,review_payload:args.reviewPayload,validation_result:args.validationResult,
    promotion_readiness:args.promotionReadiness,review_notes:args.reviewNotes,reviewed_at:args.reviewedAt,
    prepared_at:args.now,preparation_source:"research_composer_v1",
    human_verified_at:null,human_verified_by:null,human_verified_payload_hash:null,attestation_version:null,updated_at:args.now,
  },{onConflict:"draft_id"});
  if(r)throw r;
  const {error:c}=await supabase.from("research_compositions").update({status:"applied",applied_at:args.now,updated_at:args.now}).eq("id",args.compositionId);
  if(c)throw c;
  const {error:d}=await supabase.from("baseline_drafts").update({
    status:args.draftStatus,standard_valid:args.standardValid,standard_status:args.standardStatus,
    validation_result:args.validationResult,updated_at:args.now,
  }).eq("id",args.draftId);
  if(d)throw d;
}

export async function loadPrepareV2Data(){
  if(databaseConfigured()){
    const [drafts,reviews,compositions]=await Promise.all([
      dbQuery<any>(`select * from public.baseline_drafts where status<>'promoted'`),
      dbQuery<any>(`select draft_id,status from public.baseline_reviews`),
      dbQuery<any>(`select * from public.research_compositions where status='generated' order by generated_at asc`),
    ]);
    return {drafts,reviews,compositions};
  }
  const supabase=getAdminSupabase();
  if(!supabase)return null;
  const [draftResult,reviewResult,compositionResult]=await Promise.all([
    supabase.from("baseline_drafts").select("*").neq("status","promoted"),
    supabase.from("baseline_reviews").select("draft_id,status"),
    supabase.from("research_compositions").select("*").eq("status","generated").order("generated_at",{ascending:true}),
  ]);
  if(draftResult.error)throw draftResult.error;
  if(reviewResult.error)throw reviewResult.error;
  if(compositionResult.error)throw compositionResult.error;
  return {drafts:draftResult.data??[],reviews:reviewResult.data??[],compositions:compositionResult.data??[]};
}

export async function commitPreparedReview(args:{
  draftId:string;compositionId:string;status:string;reviewPayload:any;validationResult:any;promotionReadiness:any;now:string;
  draftStatus:string;standardValid:boolean;standardStatus:string;
}){
  if(databaseConfigured()){
    return withDbTransaction(async(client)=>{
      await client.query(
        `insert into public.baseline_reviews(
          draft_id,status,review_payload,validation_result,promotion_readiness,review_notes,reviewed_at,
          prepared_at,preparation_source,human_verified_at,human_verified_by,human_verified_payload_hash,
          attestation_version,updated_at
        ) values($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,
          'Automated Research Composer v1 prepared this V2 review package. Human verification is required before publication.',
          null,$6,'automated_research_composer_v1',null,null,null,null,$6)`,
        [args.draftId,args.status,j(args.reviewPayload),j(args.validationResult),j(args.promotionReadiness),args.now],
      );
      await client.query(
        `update public.research_compositions set status='applied',applied_at=$2::timestamptz,updated_at=$2::timestamptz where id=$1`,
        [args.compositionId,args.now],
      );
      await client.query(
        `update public.baseline_drafts set status=$2,standard_valid=$3,standard_status=$4,validation_result=$5::jsonb,updated_at=$6::timestamptz where id=$1`,
        [args.draftId,args.draftStatus,args.standardValid,args.standardStatus,j(args.validationResult),args.now],
      );
    });
  }
  const supabase=getAdminSupabase();
  if(!supabase)throw new Error("Admin data source is not configured.");
  const {error:r}=await supabase.from("baseline_reviews").insert({
    draft_id:args.draftId,status:args.status,review_payload:args.reviewPayload,validation_result:args.validationResult,
    promotion_readiness:args.promotionReadiness,
    review_notes:"Automated Research Composer v1 prepared this V2 review package. Human verification is required before publication.",
    reviewed_at:null,prepared_at:args.now,preparation_source:"automated_research_composer_v1",
    human_verified_at:null,human_verified_by:null,human_verified_payload_hash:null,attestation_version:null,updated_at:args.now,
  });
  if(r)throw r;
  const {error:c}=await supabase.from("research_compositions").update({status:"applied",applied_at:args.now,updated_at:args.now}).eq("id",args.compositionId);
  if(c)throw c;
  const {error:d}=await supabase.from("baseline_drafts").update({
    status:args.draftStatus,standard_valid:args.standardValid,standard_status:args.standardStatus,
    validation_result:args.validationResult,updated_at:args.now,
  }).eq("id",args.draftId);
  if(d)throw d;
}

export async function updateReviewReadiness(args:{
  reviewId:string;
  status:string;
  validationResult:any;
  promotionReadiness:any;
  now:string;
}){
  if(databaseConfigured()){
    await dbQuery(
      `update public.baseline_reviews
       set status=$2,validation_result=$3::jsonb,promotion_readiness=$4::jsonb,updated_at=$5::timestamptz
       where id=$1`,
      [args.reviewId,args.status,j(args.validationResult),j(args.promotionReadiness),args.now],
    );
    return;
  }
  const supabase=getAdminSupabase();
  if(!supabase)throw new Error("Admin data source is not configured.");
  const {error}=await supabase.from("baseline_reviews").update({
    status:args.status,
    validation_result:args.validationResult,
    promotion_readiness:args.promotionReadiness,
    updated_at:args.now,
  }).eq("id",args.reviewId);
  if(error)throw error;
}
