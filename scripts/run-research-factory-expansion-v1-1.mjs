import process from "node:process";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  RESEARCH_FACTORY_VERSION,
  RESEARCH_FACTORY_AUTOMATION_VERSION,
  isSafeResearchFactoryAutomationItem,
  summarizeResearchFactoryQueue,
  buildFactoryStateHash,
} from "../lib/research-factory-v1.mjs";

function arg(name,fallback=null){
  const prefix="--"+name+"=";
  const hit=process.argv.find(x=>x.startsWith(prefix));
  return hit?hit.slice(prefix.length):fallback;
}

const maxCompanies=Math.max(
  1,
  Math.min(
    10,
    Number(arg("max",process.env.RESEARCH_FACTORY_MAX_COMPANIES??10))||10
  )
);
const tickerArg=arg("ticker",process.env.RESEARCH_FACTORY_TICKER??null);
const requestedRunId=arg("factory-run-id",process.env.RESEARCH_FACTORY_RUN_ID??null);

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

function runNode(script,args=[],extraEnv={}){
  return new Promise((resolve)=>{
    const child=spawn(process.execPath,[script,...args],{
      stdio:["ignore","pipe","pipe"],
      env:{...process.env,...extraEnv},
    });
    let stdout="",stderr="";
    child.stdout.on("data",chunk=>{
      stdout+=chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data",chunk=>{
      stderr+=chunk;
      process.stderr.write(chunk);
    });
    child.on("error",error=>resolve({
      ok:false,
      script,
      error:error instanceof Error?error.message:String(error),
      stdout,
      stderr,
    }));
    child.on("close",code=>resolve({
      ok:code===0,
      script,
      code,
      stdout,
      stderr,
      summary:(stdout+"\n"+stderr).trim().split("\n").slice(-20).join("\n"),
    }));
  });
}

async function requiredStep(label,script,args=[],extraEnv={}){
  console.log("\n=== Research Factory V1.1 · "+label+" ===");
  const result=await runNode(script,args,extraEnv);
  if(!result.ok){
    throw new Error(label+" failed: "+(result.summary||result.error||("exit "+result.code)));
  }
  return result;
}

async function findFactoryRun(){
  if(requestedRunId){
    const {data,error}=await sb.from("research_factory_runs")
      .select("*")
      .eq("id",requestedRunId)
      .maybeSingle();
    if(error)throw error;
    return data;
  }
  const {data,error}=await sb.from("research_factory_runs")
    .select("*")
    .eq("factory_version",RESEARCH_FACTORY_VERSION)
    .order("created_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(error)throw error;
  return data;
}

async function fetchItem(runId,ticker){
  const {data,error}=await sb.from("research_factory_items")
    .select("*")
    .eq("research_factory_run_id",runId)
    .eq("ticker",ticker)
    .single();
  if(error)throw error;
  return data;
}

async function refresh(runId,ticker=null){
  const args=["--factory-run-id="+runId];
  if(ticker)args.push("--ticker="+ticker);
  const result=await requiredStep(
    "Refresh "+(ticker??"factory queue"),
    "scripts/refresh-research-factory-v1.mjs",
    args
  );
  return result;
}

async function attempt(ticker,label,script,args=[],extraEnv={},critical=true){
  console.log("\n=== Research Factory V1.1 · "+ticker+" · "+label+" ===");
  const result=await runNode(script,args,extraEnv);
  return{
    ticker,
    label,
    critical,
    ok:result.ok,
    code:result.code??null,
    summary:result.summary??result.error??null,
  };
}

async function markOperationalFailure(item,failures){
  const fresh=await fetchItem(item.research_factory_run_id??item.run_id??factoryRun.id,item.ticker);
  if(fresh.status==="needs_review"||fresh.status==="complete")return;

  const snapshot={
    ...(fresh.state_snapshot??{}),
    automation_failure:{
      automation_version:RESEARCH_FACTORY_AUTOMATION_VERSION,
      worker_batch_id:fresh.worker_batch_id,
      observed_at:new Date().toISOString(),
      errors:failures.map(x=>x.label+": "+x.summary),
    },
  };
  const stateHash=buildFactoryStateHash(snapshot);
  const {error}=await sb.rpc("transition_research_factory_item_v1",{
    p_item_id:fresh.id,
    p_stage:fresh.stage,
    p_status:"blocked",
    p_company_id:fresh.company_id,
    p_coverage_report_id:fresh.coverage_report_id,
    p_baseline_draft_id:fresh.baseline_draft_id,
    p_composition_id:fresh.composition_id,
    p_coverage_pct:fresh.coverage_pct,
    p_repair_job_count:fresh.repair_job_count,
    p_manual_review_count:fresh.manual_review_count,
    p_next_actions:fresh.next_actions,
    p_state_snapshot:snapshot,
    p_state_hash:stateHash,
    p_last_error:failures.map(x=>x.label+": "+x.summary).join("\n").slice(0,8000),
    p_event_type:"automation_v1_1_operational_failure",
  });
  if(error)throw error;
}

await requiredStep(
  "Ensure Factory V1 is materialized",
  "scripts/materialize-research-factory-v1.mjs",
  requestedRunId?[]:[]
);

let factoryRun=await findFactoryRun();
if(!factoryRun)throw new Error("Research Factory V1 run is unavailable after materialization.");

if(factoryRun.status==="completed"){
  console.log(JSON.stringify({
    automation_version:RESEARCH_FACTORY_AUTOMATION_VERSION,
    research_factory_run_id:factoryRun.id,
    status:"factory_complete",
    processed:0,
    message:"All Research Factory candidates are already at genuine review/post-review gates.",
  },null,2));
  process.exit(0);
}

await requiredStep(
  "Resolve remaining canonical identities",
  "scripts/onboard-research-factory-v1.mjs",
  ["--factory-run-id="+factoryRun.id]
);
await refresh(factoryRun.id);

const {data:claim,error:claimError}=await sb.rpc(
  "claim_research_factory_batch_v1_1",
  {
    p_research_factory_run_id:factoryRun.id,
    p_max_companies:tickerArg?1:maxCompanies,
    p_ticker:tickerArg?String(tickerArg).toUpperCase():null,
    p_automation_version:RESEARCH_FACTORY_AUTOMATION_VERSION,
  }
);
if(claimError)throw claimError;

if(claim?.status==="factory_complete"){
  console.log(JSON.stringify({
    automation_version:RESEARCH_FACTORY_AUTOMATION_VERSION,
    research_factory_run_id:factoryRun.id,
    status:"factory_complete",
    processed:0,
  },null,2));
  process.exit(0);
}

const batchId=claim?.batch_id??null;
const claimedItems=Array.isArray(claim?.items)?claim.items:[];
if(!batchId)throw new Error("V1.1 claim did not return a worker batch id.");

if(!claimedItems.length){
  const {data:completion,error:completionError}=await sb.rpc(
    "complete_research_factory_batch_v1_1",
    {
      p_worker_batch_id:batchId,
      p_summary:{
        failed_tickers:0,
        selected_tickers:[],
        message:"No safe automatic items were available.",
      },
    }
  );
  if(completionError)throw completionError;
  console.log(JSON.stringify({
    automation_version:RESEARCH_FACTORY_AUTOMATION_VERSION,
    research_factory_run_id:factoryRun.id,
    worker_batch_id:batchId,
    selected_count:0,
    completion,
  },null,2));
  process.exit(0);
}

console.log(JSON.stringify({
  automation_version:RESEARCH_FACTORY_AUTOMATION_VERSION,
  research_factory_run_id:factoryRun.id,
  worker_batch_id:batchId,
  selected_count:claimedItems.length,
  selected:claimedItems.map(x=>({
    ordinal:x.ordinal,
    ticker:x.ticker,
    stage:x.stage,
    attempt:x.worker_attempt_count,
  })),
},null,2));

const attempts=[];
const criticalFailures=new Map();
const softFailures=new Map();

function recordAttempt(result){
  attempts.push(result);
  if(result.ok)return;
  const map=result.critical?criticalFailures:softFailures;
  const list=map.get(result.ticker)??[];
  list.push(result);
  map.set(result.ticker,list);
}

for(const item of claimedItems){
  const ticker=String(item.ticker).toUpperCase();
  if(item.stage!=="evidence_ingestion")continue;

  recordAttempt(await attempt(
    ticker,
    "SEC fundamentals",
    "scripts/sync-sec-companyfacts-backfill.mjs",
    [],
    {COVERAGE_TICKER:ticker},
    false
  ));
  recordAttempt(await attempt(
    ticker,
    "Yahoo fundamentals fallback",
    "scripts/sync-yahoo-fundamentals-fallback.mjs",
    [],
    {COVERAGE_TICKER:ticker},
    false
  ));
  recordAttempt(await attempt(
    ticker,
    "Market history",
    "scripts/sync-market-history.mjs",
    [],
    {COVERAGE_TICKER:ticker},
    false
  ));
}

// Shared context is useful for every claimed name, but failure here is evidence,
// not an operational reason to force a company through or block the entire batch.
const sharedContext=await runNode("scripts/build-historical-peer-context.mjs");
attempts.push({
  ticker:null,
  label:"Shared historical + peer context",
  critical:false,
  ok:sharedContext.ok,
  code:sharedContext.code??null,
  summary:sharedContext.summary??sharedContext.error??null,
});

for(const item of claimedItems){
  const ticker=String(item.ticker).toUpperCase();
  if(item.stage!=="evidence_ingestion")continue;

  const coverage=await attempt(
    ticker,
    "Coverage V2",
    "scripts/build-data-coverage.mjs",
    [],
    {COVERAGE_TICKER:ticker},
    true
  );
  recordAttempt(coverage);
}

await runNode("scripts/build-research-repair-queue.mjs");
await refresh(factoryRun.id);

for(const claimed of claimedItems){
  const ticker=String(claimed.ticker).toUpperCase();
  if(criticalFailures.has(ticker))continue;

  let fresh=await fetchItem(factoryRun.id,ticker);
  if(!isSafeResearchFactoryAutomationItem(fresh))continue;

  if(fresh.stage==="baseline_draft"){
    const baseline=await attempt(
      ticker,
      "Private baseline draft",
      "scripts/build-baseline-draft.mjs",
      [ticker],
      {},
      true
    );
    recordAttempt(baseline);
    if(!baseline.ok)continue;

    await refresh(factoryRun.id,ticker);
    fresh=await fetchItem(factoryRun.id,ticker);
    if(!isSafeResearchFactoryAutomationItem(fresh))continue;
  }

  if(fresh.stage==="research_draft"){
    const composition=await attempt(
      ticker,
      "Private research composition",
      "scripts/compose-research-drafts.mjs",
      ["--ticker="+ticker],
      {},
      true
    );
    recordAttempt(composition);
    if(!composition.ok)continue;

    const valuation=await attempt(
      ticker,
      "Evidence-prefilled valuation draft",
      "scripts/build-research-factory-valuation-drafts.mjs",
      ["--factory-run-id="+factoryRun.id,"--ticker="+ticker],
      {},
      true
    );
    recordAttempt(valuation);
    if(!valuation.ok)continue;

    await refresh(factoryRun.id,ticker);
  }
}

await runNode("scripts/build-research-repair-queue.mjs");
await refresh(factoryRun.id);

for(const claimed of claimedItems){
  const ticker=String(claimed.ticker).toUpperCase();
  const failures=criticalFailures.get(ticker)??[];
  if(failures.length)await markOperationalFailure(claimed,failures);
}

await refresh(factoryRun.id);

const {data:allItems,error:allItemsError}=await sb.from("research_factory_items")
  .select("stage,status,manual_review_count,next_actions")
  .eq("research_factory_run_id",factoryRun.id)
  .order("ordinal",{ascending:true});
if(allItemsError)throw allItemsError;
const queueSummary=summarizeResearchFactoryQueue(allItems??[]);

const {data:completion,error:completionError}=await sb.rpc(
  "complete_research_factory_batch_v1_1",
  {
    p_worker_batch_id:batchId,
    p_summary:{
      failed_tickers:criticalFailures.size,
      soft_provider_failure_tickers:softFailures.size,
      selected_tickers:claimedItems.map(x=>x.ticker),
      attempts:attempts.map(x=>({
        ticker:x.ticker,
        label:x.label,
        ok:x.ok,
        critical:x.critical,
        code:x.code,
      })),
      queue_summary_before_completion:queueSummary,
    },
  }
);
if(completionError)throw completionError;

console.log(JSON.stringify({
  automation_version:RESEARCH_FACTORY_AUTOMATION_VERSION,
  research_factory_run_id:factoryRun.id,
  worker_batch_id:batchId,
  selected_count:claimedItems.length,
  failed_tickers:criticalFailures.size,
  soft_provider_failure_tickers:softFailures.size,
  selected:claimedItems.map(x=>x.ticker),
  completion,
  auto_review:false,
  auto_publish:false,
},null,2));
