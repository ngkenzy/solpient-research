import process from "node:process";
import { spawn } from "node:child_process";
import { createPostgresCompatClient } from "../lib/pg-supabase-compat.mjs";
import {
  RESEARCH_FACTORY_VERSION,
  buildFactoryStateHash,
} from "../lib/research-factory-v1.mjs";

function arg(name,fallback=null){
  const prefix="--"+name+"=";
  const hit=process.argv.find(x=>x.startsWith(prefix));
  return hit?hit.slice(prefix.length):fallback;
}

const maxCompanies=Math.max(1,Math.min(20,Number(arg("max",process.env.RESEARCH_FACTORY_MAX_COMPANIES??5))||5));
const tickerArg=arg("ticker",process.env.RESEARCH_FACTORY_TICKER??null);
const requestedRunId=arg("factory-run-id",process.env.RESEARCH_FACTORY_RUN_ID??null);

if(!process.env.SOLPIENT_DATABASE_URL && typeof process.loadEnvFile==="function"){
  try{process.loadEnvFile(".env.local");}catch{}
}
if(!process.env.SOLPIENT_DATABASE_URL)throw new Error("Missing SOLPIENT_DATABASE_URL.");
const sb=createPostgresCompatClient();

function runNode(script,args=[],extraEnv={}){
  return new Promise((resolve)=>{
    const child=spawn(process.execPath,[script,...args],{
      stdio:["ignore","pipe","pipe"],
      env:{...process.env,...extraEnv},
    });
    let stdout="",stderr="";
    child.stdout.on("data",chunk=>{stdout+=chunk;process.stdout.write(chunk);});
    child.stderr.on("data",chunk=>{stderr+=chunk;process.stderr.write(chunk);});
    child.on("error",error=>resolve({
      ok:false,script,error:error instanceof Error?error.message:String(error),
    }));
    child.on("close",code=>resolve({
      ok:code===0,
      script,
      code,
      summary:(stdout+"\n"+stderr).trim().split("\n").slice(-12).join("\n"),
    }));
  });
}

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

await runNode("scripts/refresh-research-factory-v1.mjs",[
  "--factory-run-id="+run.id,
]);

let query=sb.from("research_factory_items")
  .select("*")
  .eq("research_factory_run_id",run.id)
  .in("stage",["evidence_ingestion","baseline_draft","research_draft"])
  .in("status",["queued","running"])
  .order("ordinal",{ascending:true})
  .limit(maxCompanies);
if(tickerArg){
  query=sb.from("research_factory_items")
    .select("*")
    .eq("research_factory_run_id",run.id)
    .eq("ticker",String(tickerArg).toUpperCase())
    .in("stage",["evidence_ingestion","baseline_draft","research_draft"])
    .order("ordinal",{ascending:true})
    .limit(1);
}
const {data:items,error:itemError}=await query;
if(itemError)throw itemError;

if(!(items??[]).length){
  console.log(JSON.stringify({
    research_factory_run_id:run.id,
    processed:0,
    message:"No automatic Research Factory items are currently queued.",
  },null,2));
  process.exit(0);
}

const results=[];
const tickerFailures=new Map();

async function attempt(ticker,label,script,args=[],extraEnv={}){
  console.log("\n=== Research Factory · "+ticker+" · "+label+" ===");
  const result=await runNode(script,args,extraEnv);
  results.push({ticker,label,...result});
  if(!result.ok){
    const list=tickerFailures.get(ticker)??[];
    list.push(label+": "+(result.summary||result.error||("exit "+result.code)));
    tickerFailures.set(ticker,list);
  }
  return result;
}

for(const item of items){
  const ticker=String(item.ticker).toUpperCase();
  if(item.stage==="evidence_ingestion"){
    await attempt(ticker,"SEC fundamentals","scripts/sync-sec-companyfacts-backfill.mjs",[],{
      COVERAGE_TICKER:ticker,
    });
    await attempt(ticker,"Yahoo fundamentals fallback","scripts/sync-yahoo-fundamentals-fallback.mjs",[],{
      COVERAGE_TICKER:ticker,
    });
    await attempt(ticker,"Market history","scripts/sync-market-history.mjs",[],{
      COVERAGE_TICKER:ticker,
    });
  }
}

// Build context once so peer comparisons can see all locally available companies.
console.log("\n=== Research Factory · shared historical + peer context ===");
const contextResult=await runNode("scripts/build-historical-peer-context.mjs");
results.push({ticker:null,label:"shared historical + peer context",...contextResult});
if(!contextResult.ok){
  for(const item of items){
    const ticker=String(item.ticker).toUpperCase();
    const list=tickerFailures.get(ticker)??[];
    list.push("shared historical + peer context: "+(contextResult.summary||contextResult.error||("exit "+contextResult.code)));
    tickerFailures.set(ticker,list);
  }
}

for(const item of items){
  const ticker=String(item.ticker).toUpperCase();

  await attempt(ticker,"Coverage V2","scripts/build-data-coverage.mjs",[],{
    COVERAGE_TICKER:ticker,
  });

  await attempt(ticker,"Private baseline draft","scripts/build-baseline-draft.mjs",[ticker]);

  await attempt(ticker,"Private research composition","scripts/compose-research-drafts.mjs",[
    "--ticker="+ticker,
  ]);

  await attempt(ticker,"Evidence-prefilled valuation draft","scripts/build-research-factory-valuation-drafts.mjs",[
    "--factory-run-id="+run.id,
    "--ticker="+ticker,
  ]);
}

await runNode("scripts/build-research-repair-queue.mjs");
await runNode("scripts/refresh-research-factory-v1.mjs",[
  "--factory-run-id="+run.id,
]);

for(const item of items){
  const ticker=String(item.ticker).toUpperCase();
  const failures=tickerFailures.get(ticker)??[];
  if(!failures.length)continue;

  const {data:fresh,error:freshError}=await sb.from("research_factory_items")
    .select("*").eq("id",item.id).single();
  if(freshError)throw freshError;

  const snapshot={
    ...(fresh.state_snapshot??{}),
    worker_failure:{
      observed_at:new Date().toISOString(),
      errors:failures,
    },
  };
  const hash=buildFactoryStateHash(snapshot);
  const {error}=await sb.rpc("transition_research_factory_item_v1",{
    p_item_id:fresh.id,
    p_stage:fresh.stage,
    p_status:fresh.status==="needs_review"?"needs_review":"blocked",
    p_company_id:fresh.company_id,
    p_coverage_report_id:fresh.coverage_report_id,
    p_baseline_draft_id:fresh.baseline_draft_id,
    p_composition_id:fresh.composition_id,
    p_coverage_pct:fresh.coverage_pct,
    p_repair_job_count:fresh.repair_job_count,
    p_manual_review_count:fresh.manual_review_count,
    p_next_actions:fresh.next_actions,
    p_state_snapshot:snapshot,
    p_state_hash:hash,
    p_last_error:failures.join("\n").slice(0,8000),
    p_event_type:"factory_worker_partial_failure",
  });
  if(error)throw error;
}

const {data:finalItems,error:finalError}=await sb.from("research_factory_items")
  .select("ticker,stage,status,coverage_pct,repair_job_count,manual_review_count,last_error")
  .eq("research_factory_run_id",run.id)
  .in("ticker",(items??[]).map(x=>x.ticker))
  .order("ordinal",{ascending:true});
if(finalError)throw finalError;

console.log(JSON.stringify({
  research_factory_run_id:run.id,
  processed:(items??[]).length,
  failed_tickers:tickerFailures.size,
  results:results.map(x=>({
    ticker:x.ticker,
    label:x.label,
    ok:x.ok,
    code:x.code??null,
  })),
  items:finalItems??[],
  auto_publish:false,
},null,2));
