import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  RESEARCH_FACTORY_VERSION,
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

const {data:items,error:itemError}=await sb.from("research_factory_items")
  .select("*")
  .eq("research_factory_run_id",run.id)
  .order("ordinal",{ascending:true});
if(itemError)throw itemError;

const pipelineIds=(items??[]).map(x=>x.source_pipeline_item_id);
const {data:pipelineItems,error:pipelineError}=pipelineIds.length
  ?await sb.from("research_candidate_pipeline_items").select("*").in("id",pipelineIds)
  :{data:[],error:null};
if(pipelineError)throw pipelineError;
const pipelineById=new Map((pipelineItems??[]).map(x=>[x.id,x]));

const screenIds=(items??[]).map(x=>x.source_screen_result_id);
const {data:screens,error:screenError}=screenIds.length
  ?await sb.from("universe_screen_results")
    .select("id,ticker,company_name,sector,industry,screen_profile,input_summary,result_hash")
    .in("id",screenIds)
  :{data:[],error:null};
if(screenError)throw screenError;
const screenById=new Map((screens??[]).map(x=>[x.id,x]));

const tickers=(items??[]).map(x=>String(x.ticker).toUpperCase());
const {data:companies,error:companyError}=tickers.length
  ?await sb.from("companies").select("*").in("ticker",tickers)
  :{data:[],error:null};
if(companyError)throw companyError;
const companyByTicker=new Map((companies??[]).map(x=>[String(x.ticker).toUpperCase(),x]));
const companyIds=(companies??[]).map(x=>x.id);

const [
  coverageR,
  baselineR,
  compositionR,
  valuationDraftR,
  valuationPackR,
  researchRunR,
  repairR,
]=await Promise.all([
  companyIds.length
    ?sb.from("data_coverage_reports").select("*").in("company_id",companyIds)
      .eq("engine_version","coverage-v2")
      .order("as_of_date",{ascending:false})
      .order("generated_at",{ascending:false})
    :Promise.resolve({data:[],error:null}),
  companyIds.length
    ?sb.from("baseline_drafts").select("*").in("company_id",companyIds)
      .order("generated_at",{ascending:false})
    :Promise.resolve({data:[],error:null}),
  companyIds.length
    ?sb.from("research_compositions").select("*").in("company_id",companyIds)
      .eq("status","generated")
      .order("generated_at",{ascending:false})
    :Promise.resolve({data:[],error:null}),
  sb.from("research_factory_valuation_drafts").select("*")
    .in("research_factory_item_id",(items??[]).map(x=>x.id))
    .order("created_at",{ascending:false}),
  tickers.length
    ?sb.from("candidate_valuation_input_packs").select("*").in("ticker",tickers)
      .eq("status","reviewed").order("reviewed_at",{ascending:false})
    :Promise.resolve({data:[],error:null}),
  companyIds.length
    ?sb.from("research_runs").select("id,company_id,version,status,standard_status,researched_at")
      .in("company_id",companyIds).eq("status","published")
      .order("researched_at",{ascending:false})
    :Promise.resolve({data:[],error:null}),
  companyIds.length
    ?sb.from("research_repair_jobs").select("*").in("company_id",companyIds)
      .order("priority",{ascending:false})
    :Promise.resolve({data:[],error:null}),
]);
for(const r of [coverageR,baselineR,compositionR,valuationDraftR,valuationPackR,researchRunR,repairR]){
  if(r.error)throw r.error;
}

function latestBy(rows,key){
  const map=new Map();
  for(const row of rows??[]){
    const value=row[key];
    if(value!=null&&!map.has(value))map.set(value,row);
  }
  return map;
}
const coverageByCompany=latestBy(coverageR.data,"company_id");
const baselineByCompany=latestBy(baselineR.data,"company_id");
const compositionByCompany=latestBy(compositionR.data,"company_id");
const valuationDraftByItem=latestBy(valuationDraftR.data,"research_factory_item_id");
const researchByCompany=latestBy(researchRunR.data,"company_id");
const valuationPackByTicker=latestBy(
  (valuationPackR.data??[]).map(x=>({...x,ticker:String(x.ticker).toUpperCase()})),
  "ticker"
);
const repairsByCompany=new Map();
for(const row of repairR.data??[]){
  const list=repairsByCompany.get(row.company_id)??[];
  list.push(row);
  repairsByCompany.set(row.company_id,list);
}

const changes=[];
const counts={};

for(const item of items??[]){
  const ticker=String(item.ticker).toUpperCase();
  const company=companyByTicker.get(ticker)??null;
  const coverage=company?coverageByCompany.get(company.id)??null:null;
  const baselineDraft=company?baselineByCompany.get(company.id)??null:null;
  const composition=company?compositionByCompany.get(company.id)??null:null;
  const valuationDraft=valuationDraftByItem.get(item.id)??null;
  const pack=valuationPackByTicker.get(ticker)??null;
  const reviewedValuationPack=pack&&(
    !pack.universe_screen_result_id||
    pack.universe_screen_result_id===item.source_screen_result_id
  )?pack:null;
  const publishedResearch=company?researchByCompany.get(company.id)??null:null;
  const pipelineItem=pipelineById.get(item.source_pipeline_item_id)??null;
  const repairJobs=company?repairsByCompany.get(company.id)??[]:[];

  const derived=deriveResearchFactoryState({
    company,
    coverage,
    baselineDraft,
    composition,
    valuationDraft,
    reviewedValuationPack,
    publishedResearch,
    sourcePipelineItem:pipelineItem,
    repairJobs,
    industryModuleKnown:baselineDraft?Boolean(baselineDraft.industry_module):null,
  });

  const screen=screenById.get(item.source_screen_result_id)??null;
  const stateSnapshot={
    factory_version:RESEARCH_FACTORY_VERSION,
    source_pipeline_run_id:run.source_pipeline_run_id,
    source_pipeline_item_id:item.source_pipeline_item_id,
    source_pipeline_item_hash:pipelineItem?.item_hash??null,
    source_pipeline_stage:pipelineItem?.stage??null,
    source_screen_result_id:item.source_screen_result_id,
    screen_result_hash:screen?.result_hash??null,
    ticker,
    company_id:company?.id??null,
    artifacts:{
      coverage_report_id:coverage?.id??null,
      baseline_draft_id:baselineDraft?.id??null,
      composition_id:composition?.id??null,
      valuation_draft_id:valuationDraft?.id??null,
      reviewed_valuation_pack_id:reviewedValuationPack?.id??null,
      published_research_run_id:publishedResearch?.id??null,
    },
    coverage:coverage?{
      status:coverage.status,
      overall_pct:coverage.overall_pct,
      decision_readiness_pct:coverage.decision_readiness_pct,
      missing_fields:coverage.missing_fields,
      limitations:coverage.limitations,
    }:null,
    valuation_draft:valuationDraft?{
      id:valuationDraft.id,
      input_hash:valuationDraft.input_hash,
      missing_fields:valuationDraft.missing_fields,
      preflight:valuationDraft.preflight,
    }:null,
    repair_jobs:repairJobs.filter(x=>x.status!=="completed").map(x=>({
      id:x.id,layer:x.layer,field:x.field,status:x.status,priority:x.priority,
      automation_mode:x.automation_mode,reason:x.reason,
    })),
    derived,
  };
  const stateHash=buildFactoryStateHash(stateSnapshot);

  counts[derived.stage]=(counts[derived.stage]??0)+1;

  const materiallyChanged=
    item.state_hash!==stateHash||
    item.stage!==derived.stage||
    item.status!==derived.status||
    item.company_id!==(company?.id??null)||
    item.coverage_report_id!==(coverage?.id??null)||
    item.baseline_draft_id!==(baselineDraft?.id??null)||
    item.composition_id!==(composition?.id??null)||
    Number(item.repair_job_count??0)!==derived.repair_job_count||
    Number(item.manual_review_count??0)!==derived.manual_review_count;

  if(!materiallyChanged)continue;

  const {data,error}=await sb.rpc("transition_research_factory_item_v1",{
    p_item_id:item.id,
    p_stage:derived.stage,
    p_status:derived.status,
    p_company_id:company?.id??null,
    p_coverage_report_id:coverage?.id??null,
    p_baseline_draft_id:baselineDraft?.id??null,
    p_composition_id:composition?.id??null,
    p_coverage_pct:derived.coverage_pct,
    p_repair_job_count:derived.repair_job_count,
    p_manual_review_count:derived.manual_review_count,
    p_next_actions:derived.next_actions,
    p_state_snapshot:stateSnapshot,
    p_state_hash:stateHash,
    p_last_error:null,
    p_event_type:"factory_state_refreshed",
  });
  if(error)throw error;
  changes.push(data);
}

console.log(JSON.stringify({
  research_factory_run_id:run.id,
  refreshed:true,
  candidate_count:(items??[]).length,
  changed_items:changes.length,
  stage_counts:counts,
},null,2));
