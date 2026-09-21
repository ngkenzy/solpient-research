import process from "node:process";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const maxJobs=Math.max(1,Math.min(12,Number(process.env.REPAIR_MAX_JOBS??6)));
const startedAt=new Date().toISOString();
const {data:automationRun,error:automationRunError}=await sb.from("automation_runs").insert({
  pipeline:"research_repair_center",
  started_at:startedAt,
  status:"running",
  records_written:0,
  message:"Processing automatic research repair jobs.",
  details:{max_jobs:maxJobs}
}).select("id").single();
if(automationRunError)throw automationRunError;

function runNode(script,extraEnv={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[script],{
      stdio:["ignore","pipe","pipe"],
      env:{...process.env,...extraEnv},
    });
    let out="",err="";
    child.stdout.on("data",chunk=>{out+=chunk;process.stdout.write(chunk);});
    child.stderr.on("data",chunk=>{err+=chunk;process.stderr.write(chunk);});
    child.on("error",reject);
    child.on("close",code=>{
      const summary=(out+"\n"+err).trim().split("\n").slice(-12).join("\n");
      if(code===0)resolve({script,code,summary});
      else reject(new Error(script+" exited "+code+"\n"+summary));
    });
  });
}
async function updateJobs(ids,patch){
  if(!ids.length)return;
  const {error}=await sb.from("research_repair_jobs").update({...patch,updated_at:new Date().toISOString()}).in("id",ids);
  if(error)throw error;
}

const {data:jobs,error}=await sb
  .from("research_repair_jobs")
  .select("id,company_id,layer,field,repair_type,runner,status,priority,attempt_count,details")
  .eq("automation_mode","auto")
  .eq("status","pending")
  .lt("attempt_count",3)
  .order("priority",{ascending:false})
  .limit(maxJobs);
if(error)throw error;

if(!(jobs??[]).length){
  await sb.from("automation_runs").update({
    status:"success",
    completed_at:new Date().toISOString(),
    records_written:0,
    message:"No automatic research repair jobs were pending.",
    details:{max_jobs:maxJobs,processed:0}
  }).eq("id",automationRun.id);
  console.log(JSON.stringify({processed:0,message:"No automatic repair jobs are pending."},null,2));
  process.exit(0);
}

const companyIds=[...new Set(jobs.map(j=>j.company_id))];
const {data:companies,error:companyError}=await sb.from("companies").select("id,ticker").in("id",companyIds);
if(companyError)throw companyError;
const tickerById=new Map((companies??[]).map(c=>[c.id,c.ticker]));
const ids=jobs.map(j=>j.id);
const now=new Date().toISOString();

for(const job of jobs){
  const {error:e}=await sb.from("research_repair_jobs").update({
    status:"running",
    attempt_count:Number(job.attempt_count??0)+1,
    last_attempt_at:now,
    last_error:null,
    updated_at:now,
  }).eq("id",job.id);
  if(e)throw e;
}

const grouped=new Map();
for(const job of jobs){
  if(!grouped.has(job.runner))grouped.set(job.runner,[]);
  grouped.get(job.runner).push(job);
}

const results=[];
let contextNeeded=false;
const failures=new Map();

async function attempt(name,fn,jobIds){
  try{
    const value=await fn();
    results.push({name,status:"success",value});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    results.push({name,status:"failed",error:message});
    for(const id of jobIds)failures.set(id,message);
  }
}

for(const job of grouped.get("fundamentals")??[]){
  const ticker=tickerById.get(job.company_id);
  if(!ticker){failures.set(job.id,"Company ticker unavailable.");continue;}
  await attempt("sec_fundamentals:"+ticker,
    ()=>runNode("scripts/sync-sec-companyfacts-backfill.mjs",{COVERAGE_TICKER:ticker}),[job.id]);
  await attempt("yahoo_fundamentals:"+ticker,
    ()=>runNode("scripts/sync-yahoo-fundamentals-fallback.mjs",{COVERAGE_TICKER:ticker}),[job.id]);
  contextNeeded=true;
}

for(const job of grouped.get("market_context")??[]){
  const ticker=tickerById.get(job.company_id);
  if(!ticker){failures.set(job.id,"Company ticker unavailable.");continue;}
  await attempt("market_history:"+ticker,
    ()=>runNode("scripts/sync-market-history.mjs",{COVERAGE_TICKER:ticker}),[job.id]);
  contextNeeded=true;
}

if((grouped.get("peer_context")??[]).length)contextNeeded=true;

if(contextNeeded){
  const contextJobs=jobs.filter(j=>["fundamentals","market_context","peer_context"].includes(j.runner));
  await attempt("historical_peer_context",
    ()=>runNode("scripts/build-historical-peer-context.mjs"),
    contextJobs.map(j=>j.id));
}

for(const job of jobs){
  const attempts=Number(job.attempt_count??0)+1;
  const message=failures.get(job.id);
  if(message){
    await updateJobs([job.id],{
      status:attempts>=3?"blocked":"pending",
      last_error:message,
    });
  }else{
    await updateJobs([job.id],{
      status:"verifying",
      last_error:null,
      details:{...(job.details??{}),last_worker_result:"Data refresh completed; awaiting coverage verification."}
    });
  }
}

const completedAt=new Date().toISOString();
const runStatus=failures.size===jobs.length?"failed":failures.size?"partial":"success";
await sb.from("automation_runs").update({
  status:runStatus,
  completed_at:completedAt,
  records_written:jobs.filter(j=>!failures.has(j.id)).length,
  message:failures.size
    ? "Research repair worker completed with "+failures.size+" failed job(s)."
    : "Research repair worker completed successfully.",
  details:{
    max_jobs:maxJobs,
    processed:jobs.length,
    verifying:jobs.filter(j=>!failures.has(j.id)).length,
    failed:failures.size,
    results:results.map(r=>({name:r.name,status:r.status,error:r.error??null}))
  }
}).eq("id",automationRun.id);

console.log(JSON.stringify({
  processed:jobs.length,
  verifying:jobs.filter(j=>!failures.has(j.id)).length,
  failed:failures.size,
  results:results.map(r=>({name:r.name,status:r.status,error:r.error??null}))
},null,2));
