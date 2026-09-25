import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const url=process.env.SUPABASE_URL?.trim();
const secret=process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");

const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const requestedTicker=(process.env.SOLPIENT_FOUNDATION_CANARY_TICKER??"").trim().toUpperCase()||null;
const asOf=new Date().toISOString();

function assert(condition,message){
  if(!condition)throw new Error(message);
}
function containsForbiddenRawPayload(value){
  if(Array.isArray(value))return value.some(containsForbiddenRawPayload);
  if(value&&typeof value==="object"){
    if(Object.prototype.hasOwnProperty.call(value,"raw_payload"))return true;
    return Object.values(value).some(containsForbiddenRawPayload);
  }
  return false;
}

const {data:ops,error:opsError}=await sb.rpc("get_research_foundation_operational_status_v1",{
  p_as_of:asOf,
});
if(opsError)throw new Error("Operational-status RPC failed: "+opsError.message);
assert(ops&&typeof ops==="object","Operational status returned no object.");
assert(ops.coverage_counts&&typeof ops.coverage_counts==="object","Operational status lacks coverage_counts.");
assert(ops.freshness_counts&&typeof ops.freshness_counts==="object","Operational status lacks freshness_counts.");
assert(ops.queue_counts&&typeof ops.queue_counts==="object","Operational status lacks queue_counts.");

let companyQuery=sb.from("companies").select("id,ticker,company_name").order("ticker").limit(1);
if(requestedTicker)companyQuery=sb.from("companies").select("id,ticker,company_name").eq("ticker",requestedTicker).limit(1);
const {data:companies,error:companyError}=await companyQuery;
if(companyError)throw companyError;
let company=companies?.[0]??null;

if(!company&&!requestedTicker){
  throw new Error("No canonical company exists for the Group A canary.");
}
if(!company&&requestedTicker){
  throw new Error("Canary ticker "+requestedTicker+" is not present in companies.");
}

const {data:contract,error:contractError}=await sb.rpc("get_company_research_contract_v1",{
  p_company_id:company.id,
  p_as_of:asOf,
});
if(contractError)throw new Error("Group B contract RPC failed for "+company.ticker+": "+contractError.message);

assert(contract?.contract_version==="group-b-research-contract-v1","Unexpected Group B contract version.");
assert(contract?.company?.id===company.id,"Contract company identity does not match canonical company.");
assert(contract?.company?.ticker===company.ticker,"Contract ticker does not match canonical company.");
assert(contract?.coverage&&typeof contract.coverage==="object","Contract lacks coverage object.");
assert(Array.isArray(contract?.research_history),"Contract research_history must be an array.");
assert(Array.isArray(contract?.canonical_thesis_variables),"Contract canonical_thesis_variables must be an array.");
assert(contract?.freshness&&typeof contract.freshness==="object","Contract lacks freshness object.");
assert(Array.isArray(contract?.new_evidence),"Contract new_evidence must be an array.");
assert(Array.isArray(contract?.invalidated_components),"Contract invalidated_components must be an array.");
assert(!containsForbiddenRawPayload(contract),"Group B contract leaked raw_payload.");

const allowedCoverage=new Set(["MONITORED","RESEARCHED","DEEP_COVERAGE"]);
const level=contract?.coverage?.coverage_level??null;
if(level!=null)assert(allowedCoverage.has(level),"Unexpected coverage level: "+level);

const failedQueueItems=Array.isArray(ops.failed_queue_items)?ops.failed_queue_items:[];
const result={
  checked_at:asOf,
  ticker:company.ticker,
  contract_version:contract.contract_version,
  coverage_level:level,
  current_research_version:contract?.current_research?.version??null,
  research_history_versions:contract.research_history.length,
  thesis_variable_count:contract.canonical_thesis_variables.length,
  freshness_components:Object.keys(contract.freshness),
  new_evidence_count:contract.new_evidence.length,
  open_invalidations:contract.invalidated_components.length,
  operational_status:{
    coverage_counts:ops.coverage_counts,
    freshness_counts:ops.freshness_counts,
    open_invalidations:ops.open_invalidations,
    queue_counts:ops.queue_counts,
    failed_queue_items:failedQueueItems.length,
  },
  raw_payload_exposed:false,
};

console.log(JSON.stringify(result,null,2));

if(failedQueueItems.length){
  console.warn("Group A canary passed contract checks but maintenance queue has failed items.");
}
