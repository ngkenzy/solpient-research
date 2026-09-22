import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  RESEARCH_FACTORY_VERSION,
  buildResearchFactoryRunHash,
  deriveResearchFactoryState,
  buildFactoryStateHash,
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

const requestedRunId=arg("pipeline-run-id",process.env.RESEARCH_FACTORY_PIPELINE_RUN_ID??null);
let pipelineRun=null;

if(requestedRunId){
  const {data,error}=await sb.from("research_candidate_pipeline_runs")
    .select("*")
    .eq("id",requestedRunId)
    .maybeSingle();
  if(error)throw error;
  pipelineRun=data;
}else{
  const {data,error}=await sb.from("research_candidate_pipeline_runs")
    .select("*")
    .eq("pipeline_version","research-candidate-pipeline-v2.4")
    .order("created_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(error)throw error;
  pipelineRun=data;
}

if(!pipelineRun)throw new Error("No Research Candidate Pipeline V2.4 run is available.");
if(pipelineRun.pipeline_version!=="research-candidate-pipeline-v2.4"){
  throw new Error("Research Factory V1 requires a Research Candidate Pipeline V2.4 source run.");
}

const {data:pipelineItems,error:itemError}=await sb
  .from("research_candidate_pipeline_items")
  .select("*")
  .eq("research_candidate_pipeline_run_id",pipelineRun.id);
if(itemError)throw itemError;
if((pipelineItems??[]).length!==pipelineRun.candidate_count){
  throw new Error(
    "Source pipeline run is incomplete: expected "+pipelineRun.candidate_count+
    " items, found "+(pipelineItems??[]).length+"."
  );
}

const sorted=[...(pipelineItems??[])].sort((a,b)=>{
  const ar=Number(a?.source_snapshot?.screen?.shortlist_rank??999999);
  const br=Number(b?.source_snapshot?.screen?.shortlist_rank??999999);
  return ar-br||String(a.ticker).localeCompare(String(b.ticker));
});

const tickers=sorted.map(x=>String(x.ticker).toUpperCase());
const {data:companies,error:companyError}=tickers.length
  ?await sb.from("companies").select("id,ticker,company_name,cik,exchange,sector,industry").in("ticker",tickers)
  :{data:[],error:null};
if(companyError)throw companyError;
const companyByTicker=new Map((companies??[]).map(c=>[String(c.ticker).toUpperCase(),c]));

const inputHash=buildResearchFactoryRunHash({pipelineRun,items:sorted});
const items=sorted.map((source,idx)=>{
  const ticker=String(source.ticker).toUpperCase();
  const company=companyByTicker.get(ticker)??null;
  const derived=deriveResearchFactoryState({
    company,
    sourcePipelineItem:source,
  });
  const stateSnapshot={
    factory_version:RESEARCH_FACTORY_VERSION,
    source_pipeline_run_id:pipelineRun.id,
    source_pipeline_item_id:source.id,
    source_pipeline_item_hash:source.item_hash,
    source_screen_result_id:source.universe_screen_result_id,
    source_stage:source.stage,
    ticker,
    company_id:company?.id??null,
    derived,
  };
  return{
    source_pipeline_item_id:source.id,
    source_screen_result_id:source.universe_screen_result_id,
    ticker,
    company_id:company?.id??null,
    ordinal:idx+1,
    stage:derived.stage,
    status:derived.status,
    coverage_pct:derived.coverage_pct,
    repair_job_count:derived.repair_job_count,
    manual_review_count:derived.manual_review_count,
    next_actions:derived.next_actions,
    state_snapshot:stateSnapshot,
    state_hash:buildFactoryStateHash(stateSnapshot),
    last_error:null,
  };
});

const runPayload={
  source_pipeline_run_id:pipelineRun.id,
  factory_version:RESEARCH_FACTORY_VERSION,
  input_hash:inputHash,
  candidate_count:items.length,
  metadata:{
    source_pipeline_version:pipelineRun.pipeline_version,
    source_pipeline_input_hash:pipelineRun.input_hash,
    source_evaluation_as_of:pipelineRun.evaluation_as_of,
    factory_behavior:"operational orchestration only; no automatic research publication",
  },
};

const {data:runId,error:rpcError}=await sb.rpc(
  "create_research_factory_run_v1",
  {p_run:runPayload,p_items:items}
);
if(rpcError)throw rpcError;

const {count,error:countError}=await sb.from("research_factory_items")
  .select("id",{count:"exact",head:true})
  .eq("research_factory_run_id",runId);
if(countError)throw countError;
if(count!==items.length){
  throw new Error("Research Factory V1 verification failed: expected "+items.length+" items, found "+count+".");
}

const counts={};
for(const item of items)counts[item.stage]=(counts[item.stage]??0)+1;

console.log(JSON.stringify({
  materialized:true,
  research_factory_run_id:runId,
  factory_version:RESEARCH_FACTORY_VERSION,
  source_pipeline_run_id:pipelineRun.id,
  input_hash:inputHash,
  candidate_count:items.length,
  stage_counts:counts,
  existing_companies:(companies??[]).length,
  auto_publish:false,
},null,2));
