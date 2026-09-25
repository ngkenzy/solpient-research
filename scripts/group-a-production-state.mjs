import fs from "node:fs/promises";
import crypto from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const phase=(process.env.GROUP_A_PHASE??"pre").trim().toLowerCase();
if(!["pre","post"].includes(phase)) throw new Error("GROUP_A_PHASE must be pre or post.");

const url=process.env.SUPABASE_URL?.trim();
const secret=(process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
if(!url||!secret) throw new Error("Missing SUPABASE_URL and server secret.");

const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const groupATables=[
  "research_coverage_states",
  "research_coverage_history",
  "research_freshness_policies",
  "research_component_freshness",
  "research_dependency_rules",
  "research_component_invalidations",
  "research_maintenance_queue",
  "research_maintenance_attempts",
];

const missingRelationCodes=new Set(["42P01","PGRST205"]);
const missingFunctionCodes=new Set(["PGRST202","42883"]);

function stable(value){
  if(Array.isArray(value)) return value.map(stable);
  if(value&&typeof value==="object"){
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  }
  return value;
}
function digest(value){
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
async function tableProbe(table){
  const {count,error}=await sb.from(table).select("*",{head:true,count:"exact"}).limit(0);
  if(error){
    if(missingRelationCodes.has(error.code)) return {exists:false,count:null,error:null};
    return {exists:null,count:null,error:{code:error.code,message:error.message}};
  }
  return {exists:true,count:count??0,error:null};
}
async function countTable(table,filter){
  let q=sb.from(table).select("*",{head:true,count:"exact"});
  if(filter) q=filter(q);
  const {count,error}=await q;
  if(error) throw new Error(`${table} count failed: ${error.code??""} ${error.message}`);
  return count??0;
}
async function rpcExists(name,args){
  const {error}=await sb.rpc(name,args);
  if(!error) return true;
  if(missingFunctionCodes.has(error.code)) return false;
  if(/Could not find the function|does not exist/i.test(error.message??"")) return false;
  return true;
}

const tableState={};
for(const table of groupATables) tableState[table]=await tableProbe(table);

const rpcState={
  get_research_foundation_operational_status_v1:await rpcExists(
    "get_research_foundation_operational_status_v1",
    {p_as_of:new Date().toISOString()}
  ),
  get_company_research_contract_v1:await rpcExists(
    "get_company_research_contract_v1",
    {p_company_id:"00000000-0000-0000-0000-000000000000",p_as_of:new Date().toISOString()}
  ),
};

if(phase==="pre"){
  const existingTables=Object.entries(tableState).filter(([,v])=>v.exists===true).map(([k])=>k);
  const probeErrors=Object.entries(tableState).filter(([,v])=>v.exists===null);
  const existingRpcs=Object.entries(rpcState).filter(([,v])=>v).map(([k])=>k);
  if(probeErrors.length){
    throw new Error("Unable to prove Group A table absence: "+JSON.stringify(probeErrors));
  }
  if(existingTables.length||existingRpcs.length){
    throw new Error(
      "Production already contains Group A objects outside the intended pending-migration state. "+
      JSON.stringify({existingTables,existingRpcs})
    );
  }
}

if(phase==="post"){
  const missingTables=Object.entries(tableState).filter(([,v])=>v.exists!==true).map(([k,v])=>({table:k,state:v}));
  const missingRpcs=Object.entries(rpcState).filter(([,v])=>!v).map(([k])=>k);
  if(missingTables.length||missingRpcs.length){
    throw new Error("Group A production objects missing after migration: "+JSON.stringify({missingTables,missingRpcs}));
  }
  const policyCount=await countTable("research_freshness_policies",q=>q.eq("methodology_version","research-freshness-v1"));
  const dependencyCount=await countTable("research_dependency_rules",q=>q.eq("methodology_version","research-dependency-v1"));
  if(policyCount!==9) throw new Error(`Expected 9 research-freshness-v1 policies, found ${policyCount}.`);
  if(dependencyCount!==14) throw new Error(`Expected 14 research-dependency-v1 rules, found ${dependencyCount}.`);
}

const publishedCount=await countTable("research_runs",q=>q.eq("status","published"));
const normalizedFactCount=await countTable("normalized_facts");
const evidenceObservationCount=await countTable("evidence_observations");
const lockedPredictionCount=await countTable("prediction_snapshots",q=>q.not("locked_at","is",null));
const realizedOutcomeCount=await countTable("realized_outcomes");
const predictionScoreCount=await countTable("prediction_scores");
const rankingHistoryCount=await countTable("ranking_history");

const {data:adbe,error:adbeError}=await sb.from("companies").select("id,ticker,company_name").eq("ticker","ADBE").maybeSingle();
if(adbeError) throw adbeError;

let adbeSnapshot=null;
if(adbe){
  const {data:runs,error:runError}=await sb
    .from("research_runs")
    .select("id,company_id,version,status,published_at,researched_at,data_cutoff_at,integrity_version,methodology_version,evidence_hash,normalized_inputs_hash,valuation_inputs_hash,composition_hash,published_output_hash,summary")
    .eq("company_id",adbe.id)
    .eq("status","published")
    .order("version",{ascending:false})
    .limit(1);
  if(runError) throw runError;
  const run=runs?.[0]??null;
  if(run){
    const childSpecs=[
      ["business_assessments","*"],
      ["valuations","*"],
      ["thesis_variables","*"],
      ["risk_register","*"],
      ["sources","*"],
      ["research_v2_sections","*"],
    ];
    const children={};
    for(const [table,columns] of childSpecs){
      const {data,error}=await sb.from(table).select(columns).eq("research_run_id",run.id).order("id",{ascending:true});
      if(error) throw new Error(`${table} snapshot failed: ${error.message}`);
      children[table]=data??[];
    }
    adbeSnapshot={
      company:adbe,
      latestPublishedRun:run,
      latestPublishedRunHash:digest(run),
      childPackageHash:digest(children),
      childCounts:Object.fromEntries(Object.entries(children).map(([k,v])=>[k,v.length])),
    };
  }
}

const output={
  phase,
  captured_at:new Date().toISOString(),
  table_state:tableState,
  rpc_state:rpcState,
  ledger_counts:{
    published_research_runs:publishedCount,
    normalized_facts:normalizedFactCount,
    evidence_observations:evidenceObservationCount,
    locked_predictions:lockedPredictionCount,
    realized_outcomes:realizedOutcomeCount,
    prediction_scores:predictionScoreCount,
    ranking_history:rankingHistoryCount,
  },
  representative:adbeSnapshot,
};

const outPath=process.env.GROUP_A_STATE_OUTPUT?.trim()||`group-a-production-${phase}.json`;
await fs.writeFile(outPath,JSON.stringify(output,null,2)+"\n","utf8");
console.log(JSON.stringify(output,null,2));
