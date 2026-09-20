import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { composeResearchV1, RESEARCH_COMPOSER_VERSION } from "../lib/research-composer.mjs";
import { applyReviewPatch } from "../lib/review-workbench.mjs";
import { validateResearchStandard } from "../lib/research-standard.mjs";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

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

  const [contextR,valuationR]=await Promise.all([
    sb.from("research_context_packs").select("*").eq("company_id",company.id).order("as_of_date",{ascending:false}).limit(1).maybeSingle(),
    sb.from("valuation_history").select("*").eq("company_id",company.id).order("trading_date",{ascending:false}).limit(3200)
  ]);
  if(contextR.error)throw contextR.error;
  if(valuationR.error)throw valuationR.error;

  const composition=composeResearchV1({
    company,
    baselinePayload:draft.draft_payload,
    contextPack:contextR.data??{},
    valuationHistory:valuationR.data??[],
    asOfDate:new Date().toISOString().slice(0,10)
  });
  const merged=applyReviewPatch(draft.draft_payload,composition.review_patch);
  const validation=validateResearchStandard(merged);
  const now=new Date().toISOString();

  const {data:stored,error:storeError}=await sb.from("research_compositions").upsert({
    draft_id:draft.id,company_id:company.id,engine_version:RESEARCH_COMPOSER_VERSION,
    context_pack_id:contextR.data?.id??null,status:"generated",composition_payload:composition,
    validation_result:validation,generated_at:now,updated_at:now
  },{onConflict:"draft_id,engine_version"}).select("id").single();
  if(storeError)throw storeError;
  summary.push({ticker:company.ticker,draft_id:draft.id,composition_id:stored.id,standard_status:validation.status,completeness_pct:validation.completenessPct});
}
console.log(JSON.stringify({engine_version:RESEARCH_COMPOSER_VERSION,composed:summary.length,summary},null,2));
