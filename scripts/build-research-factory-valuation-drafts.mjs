import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  RESEARCH_FACTORY_VERSION,
  buildEvidenceValuationDraft,
} from "../lib/research-factory-v1.mjs";

function arg(name,fallback=null){
  const prefix="--"+name+"=";
  const hit=process.argv.find(x=>x.startsWith(prefix));
  return hit?hit.slice(prefix.length):fallback;
}

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const tickerArg=arg("ticker",process.env.RESEARCH_FACTORY_TICKER??null);
const requestedRunId=arg("factory-run-id",process.env.RESEARCH_FACTORY_RUN_ID??null);

let run=null;
if(requestedRunId){
  const {data,error}=await sb.from("research_factory_runs").select("*").eq("id",requestedRunId).maybeSingle();
  if(error)throw error;
  run=data;
}else{
  const {data,error}=await sb.from("research_factory_runs")
    .select("*")
    .eq("factory_version",RESEARCH_FACTORY_VERSION)
    .eq("status","active")
    .order("created_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(error)throw error;
  run=data;
}
if(!run)throw new Error("No active Research Factory V1 run is available.");

let itemQuery=sb.from("research_factory_items")
  .select("*")
  .eq("research_factory_run_id",run.id)
  .not("company_id","is",null)
  .order("ordinal",{ascending:true});
if(tickerArg)itemQuery=itemQuery.eq("ticker",String(tickerArg).toUpperCase());
const {data:items,error:itemError}=await itemQuery;
if(itemError)throw itemError;

const summary=[];

for(const item of items??[]){
  const [
    companyR,
    screenR,
    baselineR,
    contextR,
    historyR,
  ]=await Promise.all([
    sb.from("companies").select("*").eq("id",item.company_id).single(),
    sb.from("universe_screen_results").select("*").eq("id",item.source_screen_result_id).single(),
    sb.from("baseline_drafts").select("*").eq("company_id",item.company_id)
      .order("generated_at",{ascending:false}).limit(1).maybeSingle(),
    sb.from("research_context_packs").select("*").eq("company_id",item.company_id)
      .order("as_of_date",{ascending:false}).order("generated_at",{ascending:false})
      .limit(1).maybeSingle(),
    sb.from("valuation_history")
      .select("trading_date,pe,forward_pe,ev_to_ebitda,price_to_fcf,fcf_yield,provider,source_url,observed_at")
      .eq("company_id",item.company_id)
      .order("trading_date",{ascending:false})
      .limit(3200),
  ]);
  for(const r of [companyR,screenR,baselineR,contextR,historyR])if(r.error)throw r.error;

  const draft=buildEvidenceValuationDraft({
    screenResult:screenR.data,
    company:companyR.data,
    baselineDraft:baselineR.data??null,
    valuationHistory:historyR.data??[],
    contextPack:contextR.data??null,
  });

  const {data:existing,error:existingError}=await sb.from("research_factory_valuation_drafts")
    .select("id,input_hash,created_at")
    .eq("research_factory_item_id",item.id)
    .eq("input_hash",draft.input_hash)
    .maybeSingle();
  if(existingError)throw existingError;

  if(existing){
    summary.push({
      ticker:item.ticker,
      skipped:true,
      reason:"identical_evidence_draft",
      valuation_draft_id:existing.id,
      missing_fields:draft.missing_fields,
    });
    continue;
  }

  const {data:stored,error:storeError}=await sb.from("research_factory_valuation_drafts")
    .insert({
      research_factory_item_id:item.id,
      company_id:item.company_id,
      source_screen_result_id:item.source_screen_result_id,
      ticker:item.ticker,
      factory_version:RESEARCH_FACTORY_VERSION,
      industry_module:draft.industry_module,
      status:"draft",
      valuation_input:draft.valuation_input,
      preflight:draft.preflight,
      missing_fields:draft.missing_fields,
      evidence:draft.evidence,
      input_hash:draft.input_hash,
    })
    .select("id,input_hash,created_at")
    .single();
  if(storeError)throw storeError;

  summary.push({
    ticker:item.ticker,
    generated:true,
    valuation_draft_id:stored.id,
    input_hash:stored.input_hash,
    industry_module:draft.industry_module,
    preflight_complete:Boolean(draft.preflight?.complete),
    missing_fields:draft.missing_fields,
  });
}

console.log(JSON.stringify({
  factory_version:RESEARCH_FACTORY_VERSION,
  research_factory_run_id:run.id,
  ticker:tickerArg?String(tickerArg).toUpperCase():null,
  generated:summary.filter(x=>x.generated).length,
  skipped:summary.filter(x=>x.skipped).length,
  auto_review:false,
  auto_publish:false,
  summary,
},null,2));
