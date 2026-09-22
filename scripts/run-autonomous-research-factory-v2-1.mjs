import process from "node:process";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  AUTONOMOUS_RESEARCH_FACTORY_VERSION,
} from "../lib/autonomous-research-factory-v2-1.mjs";

function arg(name,fallback=null){
  const prefix="--"+name+"=";
  const hit=process.argv.find(x=>x.startsWith(prefix));
  return hit?hit.slice(prefix.length):fallback;
}
const maxItems=Math.max(1,Math.min(10,Number(arg("max",process.env.RESEARCH_FACTORY_MAX_COMPANIES??10))||10));
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
    child.stdout.on("data",chunk=>{stdout+=chunk;process.stdout.write(chunk);});
    child.stderr.on("data",chunk=>{stderr+=chunk;process.stderr.write(chunk);});
    child.on("error",error=>resolve({
      ok:false,script,error:error instanceof Error?error.message:String(error),stdout,stderr,
    }));
    child.on("close",code=>resolve({
      ok:code===0,script,code,stdout,stderr,
      summary:(stdout+"\n"+stderr).trim().split("\n").slice(-16).join("\n"),
    }));
  });
}

async function required(label,script,args=[],extraEnv={}){
  console.log("\n=== Autonomous Research Factory V2.1 · "+label+" ===");
  const result=await runNode(script,args,extraEnv);
  if(!result.ok)throw new Error(label+" failed: "+(result.summary||result.error||("exit "+result.code)));
  return result;
}

async function findFactoryRun(){
  if(requestedRunId){
    const {data,error}=await sb.from("research_factory_runs").select("*").eq("id",requestedRunId).maybeSingle();
    if(error)throw error;
    return data;
  }
  const {data,error}=await sb.from("research_factory_runs")
    .select("*")
    .eq("factory_version","research-factory-v1")
    .order("created_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(error)throw error;
  return data;
}

async function freshItem(id){
  const {data,error}=await sb.from("research_factory_items").select("*").eq("id",id).single();
  if(error)throw error;
  return data;
}

await required("Ensure Research Factory exists","scripts/materialize-research-factory-v1.mjs");
const factoryRun=await findFactoryRun();
if(!factoryRun)throw new Error("Research Factory V1 run is unavailable after materialization.");

await required(
  "Resolve canonical identities",
  "scripts/onboard-research-factory-v1.mjs",
  ["--factory-run-id="+factoryRun.id]
);

let itemQuery=sb.from("research_factory_items")
  .select("*")
  .eq("research_factory_run_id",factoryRun.id)
  .not("company_id","is",null)
  .neq("status","complete")
  .neq("stage","complete")
  .neq("stage","pipeline_refresh")
  .order("ordinal",{ascending:true});
if(tickerArg)itemQuery=itemQuery.eq("ticker",String(tickerArg).toUpperCase());
const {data:allItems,error:itemError}=await itemQuery;
if(itemError)throw itemError;

const statusPriority={needs_review:0,queued:1,running:2,blocked:3,quarantined:4};
const selected=[...(allItems??[])]
  .sort((a,b)=>
    (statusPriority[a.status]??9)-(statusPriority[b.status]??9)||
    Number(a.ordinal??9999)-Number(b.ordinal??9999)
  )
  .slice(0,tickerArg?1:maxItems);

if(!selected.length){
  console.log(JSON.stringify({
    automation_version:AUTONOMOUS_RESEARCH_FACTORY_VERSION,
    research_factory_run_id:factoryRun.id,
    status:"noop",
    processed:0,
    message:"No unresolved Research Factory items are available for Autonomous V2.1.",
  },null,2));
  process.exit(0);
}

const {data:autoRun,error:autoRunError}=await sb.from("research_factory_autonomous_runs")
  .insert({
    research_factory_run_id:factoryRun.id,
    automation_version:AUTONOMOUS_RESEARCH_FACTORY_VERSION,
    status:"running",
    max_items:selected.length,
    summary:{
      tickers:selected.map(x=>x.ticker),
      selection_policy:"needs_review_then_queued_then_running_then_blocked_then_quarantined",
    },
  })
  .select("id")
  .single();
if(autoRunError)throw autoRunError;

const results=[];
for(const item of selected){
  const ticker=String(item.ticker).toUpperCase();
  const steps=[];
  let outcome="processed";
  try{
    const commonEnv={
      RESEARCH_FACTORY_TICKER:ticker,
      RESEARCH_FACTORY_RUN_ID:factoryRun.id,
      AUTONOMOUS_FACTORY_RUN_ID:autoRun.id,
      COVERAGE_TICKER:ticker,
    };

    for(const [label,script,args,env,critical] of [
      ["SEC fundamentals","scripts/sync-sec-companyfacts-backfill.mjs",[],commonEnv,false],
      ["Yahoo fundamentals fallback","scripts/sync-yahoo-fundamentals-fallback.mjs",[],commonEnv,false],
      ["Market history","scripts/sync-market-history.mjs",[],commonEnv,false],
      ["Industry assignment","scripts/assign-research-factory-industry-v2-1.mjs",
        ["--factory-run-id="+factoryRun.id,"--ticker="+ticker,"--autonomous-run-id="+autoRun.id],commonEnv,true],
    ]){
      const r=await runNode(script,args,env);
      steps.push({label,ok:r.ok,summary:r.ok?null:r.summary});
      if(critical&&!r.ok)throw new Error(label+" failed: "+r.summary);
    }

    let current=await freshItem(item.id);
    if(current.status==="quarantined"){
      outcome="quarantined";
      results.push({ticker,outcome,steps});
      continue;
    }

    for(const [label,script,args,env,critical] of [
      ["Historical and peer context","scripts/build-historical-peer-context.mjs",[],commonEnv,true],
      ["Baseline evidence draft","scripts/build-baseline-draft.mjs",[ticker],commonEnv,true],
      ["Coverage V2","scripts/build-data-coverage.mjs",[],commonEnv,true],
      ["Research composition","scripts/compose-research-drafts.mjs",["--ticker="+ticker],commonEnv,false],
      ["Autonomous valuation","scripts/build-autonomous-valuation-pack-v2-1.mjs",
        ["--factory-run-id="+factoryRun.id,"--ticker="+ticker,"--autonomous-run-id="+autoRun.id],commonEnv,true],
      ["Repair queue refresh","scripts/build-research-repair-queue.mjs",[],commonEnv,false],
      ["Factory state refresh","scripts/refresh-research-factory-v1.mjs",
        ["--factory-run-id="+factoryRun.id,"--ticker="+ticker],commonEnv,true],
    ]){
      const r=await runNode(script,args,env);
      steps.push({label,ok:r.ok,summary:r.ok?null:r.summary});
      if(critical&&!r.ok)throw new Error(label+" failed: "+r.summary);
    }

    current=await freshItem(item.id);
    outcome=current.status==="quarantined"
      ?"quarantined"
      :current.stage==="research_review"
        ?"research_review"
        :current.stage==="pipeline_refresh"
          ?"pipeline_refresh"
          :current.status;
    results.push({ticker,outcome,stage:current.stage,status:current.status,steps});
  }catch(error){
    outcome="failed";
    results.push({
      ticker,
      outcome,
      error:error instanceof Error?error.message:String(error),
      steps,
    });
  }
}

const autoApproved=results.filter(x=>x.outcome==="research_review"||x.outcome==="pipeline_refresh").length;
const quarantined=results.filter(x=>x.outcome==="quarantined").length;
const failed=results.filter(x=>x.outcome==="failed").length;
const completedAt=new Date().toISOString();
const runStatus=failed===results.length?"failed":failed?"partial":"success";
const {error:finishError}=await sb.from("research_factory_autonomous_runs")
  .update({
    status:runStatus,
    processed_count:results.length,
    auto_approved_count:autoApproved,
    quarantined_count:quarantined,
    summary:{
      tickers:selected.map(x=>x.ticker),
      auto_approved:autoApproved,
      quarantined,
      failed,
      results:results.map(x=>({
        ticker:x.ticker,
        outcome:x.outcome,
        stage:x.stage??null,
        status:x.status??null,
        error:x.error??null,
      })),
    },
    completed_at:completedAt,
  })
  .eq("id",autoRun.id);
if(finishError)throw finishError;

console.log(JSON.stringify({
  automation_version:AUTONOMOUS_RESEARCH_FACTORY_VERSION,
  autonomous_run_id:autoRun.id,
  research_factory_run_id:factoryRun.id,
  status:runStatus,
  selected:selected.map(x=>x.ticker),
  processed:results.length,
  auto_approved:autoApproved,
  quarantined,
  failed,
  results,
},null,2));

if(failed===results.length)process.exitCode=1;
