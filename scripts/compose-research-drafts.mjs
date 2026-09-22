import process from "node:process";
import { createPostgresCompatClient } from "../lib/pg-supabase-compat.mjs";
import { composeResearchV1, RESEARCH_COMPOSER_VERSION } from "../lib/research-composer.mjs";
import { applyReviewPatch } from "../lib/review-workbench.mjs";
import { validateResearchStandard } from "../lib/research-standard.mjs";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createPostgresCompatClient();

const tickerArg=process.argv.find((v)=>v.startsWith("--ticker="))?.split("=")[1]?.toUpperCase()??null;
const {data:drafts,error:draftError}=await sb.from("baseline_drafts").select("*").in("status",["generated","ready_for_review"]).order("generated_at",{ascending:false});
if(draftError)throw draftError;

const latestByCompany=new Map();
for(const draft of drafts??[])if(!latestByCompany.has(draft.company_id))latestByCompany.set(draft.company_id,draft);
const summary=[];

for(const draft of latestByCompany.values()){
  const {data:company,error:companyError}=await sb.from("companies").select("*").eq("id",draft.company_id).single();
  if(companyError)throw companyError;
  if(tickerArg&&company.ticker!==tickerArg)continue;

  const cutoff=new Date(draft.source_cutoff_at);
  if(!Number.isFinite(cutoff.getTime()))throw new Error("Draft has invalid source_cutoff_at: "+draft.id);
  const cutoffIso=cutoff.toISOString();
  const cutoffDate=cutoffIso.slice(0,10);

  const [contextCandidatesR,valuationR]=await Promise.all([
    sb.from("research_context_packs").select("*").eq("company_id",company.id)
      .lte("as_of_date",cutoffDate)
      .order("as_of_date",{ascending:false})
      .order("generated_at",{ascending:false})
      .limit(25),
    sb.from("valuation_history").select("*").eq("company_id",company.id)
      .lte("trading_date",cutoffDate)
      .lte("observed_at",cutoffIso)
      .order("trading_date",{ascending:false}).limit(3200)
  ]);
  if(contextCandidatesR.error)throw contextCandidatesR.error;
  if(valuationR.error)throw valuationR.error;

  const preferredContextId=draft.evidence_summary?.context_pack_id??draft.draft_payload?.factory?.research_context?.context_pack_id??null;
  const safeContexts=(contextCandidatesR.data??[]).filter((row)=>{
    const known=row.knowledge_cutoff_at??row.generated_at;
    return known && new Date(known).getTime()<=cutoff.getTime();
  });
  const contextPack=safeContexts.find((row)=>row.id===preferredContextId)??safeContexts[0]??null;
  if(!contextPack)throw new Error("No research context pack was known by draft cutoff "+cutoffIso+" for "+company.ticker+".");

  const composition=composeResearchV1({
    company,
    baselinePayload:draft.draft_payload,
    contextPack,
    valuationHistory:valuationR.data??[],
    asOfDate:cutoffDate
  });
  const merged=applyReviewPatch(draft.draft_payload,composition.review_patch);
  const validation=validateResearchStandard(merged);
  const now=new Date().toISOString();

  const {data:stored,error:storeError}=await sb.from("research_compositions").upsert({
    draft_id:draft.id,company_id:company.id,engine_version:RESEARCH_COMPOSER_VERSION,
    context_pack_id:contextPack.id,status:"generated",composition_payload:composition,
    validation_result:validation,generated_at:now,updated_at:now
  },{onConflict:"draft_id,engine_version"}).select("id").single();
  if(storeError)throw storeError;
  summary.push({ticker:company.ticker,draft_id:draft.id,composition_id:stored.id,standard_status:validation.status,completeness_pct:validation.completenessPct});
}
console.log(JSON.stringify({engine_version:RESEARCH_COMPOSER_VERSION,composed:summary.length,summary},null,2));
