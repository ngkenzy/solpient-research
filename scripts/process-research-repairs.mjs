import process from "node:process";
import { spawn } from "node:child_process";
import {
  createAutomationRunPg,
  loadPendingRepairJobsPg,
  loadCompanyTickersPg,
  updateRepairJobsPg,
  updateAutomationRunPg,
} from "../lib/factory-worker-pg.mjs";
import { postgresConfigured } from "../lib/postgres-node.mjs";

if(!postgresConfigured())throw new Error("Missing SOLPIENT_DATABASE_URL.");
const maxJobs=Math.max(1,Math.min(12,Number(process.env.REPAIR_MAX_JOBS??6)));
const startedAt=new Date().toISOString();
const automationRun=await createAutomationRunPg({
  pipeline:"research_repair_center",
  started_at:startedAt,
  status:"running",
  records_written:0,
  message:"Processing automatic research repair jobs.",
  details:{max_jobs:maxJobs},
});

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
  await updateRepairJobsPg(ids,{...patch,updated_at:new Date().toISOString()});
}

const jobs=await loadPendingRepairJobsPg(maxJobs);
if(!jobs.length){
  await updateAutomationRunPg(automationRun.id,{
    status:"success",
    completed_at:new Date().toISOString(),
    records_written:0,
    message:"No automatic research repair jobs were pending.",
    details:{max_jobs:maxJobs,processed:0},
  });
  console.log(JSON.stringify({processed:0,message:"No automatic repair jobs are pending.",database:"postgres"},null,2));
  process.exit(0);
}

const companyIds=[...new Set(jobs.map(j=>j.company_id))];
const companies=await loadCompanyTickersPg(companyIds);
const tickerById=new Map(companies.map(c=>[c.id,c.ticker]));
const now=new Date().toISOString();

for(const job of jobs){
  await updateJobs([job.id],{
    status:"running",
    attempt_count:Number(job.attempt_count??0)+1,
    last_attempt_at:now,
    last_error:null,
  });
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
  await attempt("sec_fundamentals:"+ticker,()=>runNode("scripts/sync-sec-companyfacts-backfill.mjs",{COVERAGE_TICKER:ticker}),[job.id]);
  await attempt("yahoo_fundamentals:"+ticker,()=>runNode("scripts/sync-yahoo-fundamentals-fallback.mjs",{COVERAGE_TICKER:ticker}),[job.id]);
  contextNeeded=true;
}
for(const job of grouped.get("market_context")??[]){
  const ticker=tickerById.get(job.company_id);
  if(!ticker){failures.set(job.id,"Company ticker unavailable.");continue;}
  await attempt("market_history:"+ticker,()=>runNode("scripts/sync-market-history.mjs",{COVERAGE_TICKER:ticker}),[job.id]);
  contextNeeded=true;
}
if((grouped.get("peer_context")??[]).length)contextNeeded=true;
if((grouped.get("capital_history")??[]).length)contextNeeded=true;

if(contextNeeded){
  const contextJobs=jobs.filter(j=>["fundamentals","market_context","peer_context","capital_history"].includes(j.runner));
  await attempt("historical_peer_context",()=>runNode("scripts/build-historical-peer-context.mjs"),contextJobs.map(j=>j.id));
}

for(const job of grouped.get("autonomous_industry")??[]){
  const ticker=tickerById.get(job.company_id);
  if(!ticker){failures.set(job.id,"Company ticker unavailable.");continue;}
  await attempt("autonomous_industry:"+ticker,()=>runNode("scripts/assign-research-factory-industry-v2-1.mjs",{RESEARCH_FACTORY_TICKER:ticker}),[job.id]);
}
if((grouped.get("autonomous_industry")??[]).length){
  const industryJobs=grouped.get("autonomous_industry")??[];
  await attempt("historical_peer_context_after_industry",()=>runNode("scripts/build-historical-peer-context.mjs"),industryJobs.map(j=>j.id));
  for(const job of industryJobs){
    const ticker=tickerById.get(job.company_id);
    if(!ticker)continue;
    await attempt("coverage_after_industry:"+ticker,()=>runNode("scripts/build-data-coverage.mjs",{COVERAGE_TICKER:ticker}),[job.id]);
  }
}
for(const job of grouped.get("autonomous_valuation")??[]){
  const ticker=tickerById.get(job.company_id);
  if(!ticker){failures.set(job.id,"Company ticker unavailable.");continue;}
  await attempt("autonomous_valuation:"+ticker,()=>runNode("scripts/build-autonomous-valuation-pack-v2-1.mjs",{RESEARCH_FACTORY_TICKER:ticker}),[job.id]);
}

for(const job of jobs){
  const attempts=Number(job.attempt_count??0)+1;
  const message=failures.get(job.id);
  if(message){
    await updateJobs([job.id],{status:attempts>=3?"blocked":"pending",last_error:message});
  }else{
    await updateJobs([job.id],{
      status:"verifying",
      last_error:null,
      details:{...(job.details??{}),last_worker_result:"Data refresh completed; awaiting coverage verification."},
    });
  }
}

const completedAt=new Date().toISOString();
const runStatus=failures.size===jobs.length?"failed":failures.size?"partial":"success";
await updateAutomationRunPg(automationRun.id,{
  status:runStatus,
  completed_at:completedAt,
  records_written:jobs.filter(j=>!failures.has(j.id)).length,
  message:failures.size
    ?"Research repair worker completed with "+failures.size+" failed job(s)."
    :"Research repair worker completed successfully.",
  details:{
    max_jobs:maxJobs,processed:jobs.length,
    verifying:jobs.filter(j=>!failures.has(j.id)).length,
    failed:failures.size,
    results:results.map(r=>({name:r.name,status:r.status,error:r.error??null})),
  },
});

console.log(JSON.stringify({
  processed:jobs.length,
  verifying:jobs.filter(j=>!failures.has(j.id)).length,
  failed:failures.size,
  results:results.map(r=>({name:r.name,status:r.status,error:r.error??null})),
  database:"postgres",
},null,2));
