import process from "node:process";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  AUTONOMOUS_RESEARCH_FACTORY_VERSION,
  AUTONOMOUS_SETTLED_QUEUE_VERSION,
  buildAutonomousSettlementHash,
  selectAutonomousResearchFactoryCandidates,
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

async function loadSettlementHash(item){
  if(!item?.company_id)return null;
  const companyId=item.company_id;

  const [coverageR,contextR,consensusR,baselineR,assignmentR]=await Promise.all([
    sb.from("data_coverage_reports")
      .select("status,fundamentals_pct,history_pct,market_history_pct,valuation_history_pct,capital_allocation_pct,consensus_pct,industry_pct,peer_pct,overall_pct,decision_readiness_pct,normalized_quarters,complete_fiscal_years,market_days,primary_source_quarters,missing_fields,provider_summary")
      .eq("company_id",companyId)
      .eq("engine_version","coverage-v2")
      .order("as_of_date",{ascending:false})
      .order("generated_at",{ascending:false})
      .limit(1)
      .maybeSingle(),
    sb.from("research_context_packs")
      .select("industry_module,history_coverage,peer_comparison,summary,limitations")
      .eq("company_id",companyId)
      .order("as_of_date",{ascending:false})
      .order("generated_at",{ascending:false})
      .limit(1)
      .maybeSingle(),
    sb.from("consensus_snapshots")
      .select("analyst_count,revenue_next_fy,eps_next_fy,revenue_growth_next_fy,eps_growth_next_fy")
      .eq("company_id",companyId)
      .order("observed_at",{ascending:false})
      .limit(1)
      .maybeSingle(),
    sb.from("baseline_drafts")
      .select("industry_module,evidence_completeness_pct,standard_status,draft_payload")
      .eq("company_id",companyId)
      .order("generated_at",{ascending:false})
      .limit(1)
      .maybeSingle(),
    sb.from("research_factory_industry_assignments")
      .select("policy_version,status,module,proposed_module,decision_hash")
      .eq("research_factory_item_id",item.id)
      .order("created_at",{ascending:false})
      .limit(1)
      .maybeSingle(),
  ]);
  for(const r of [coverageR,contextR,consensusR,baselineR,assignmentR]){
    if(r.error)throw r.error;
  }
  return buildAutonomousSettlementHash({
    item,
    coverage:coverageR.data??null,
    contextPack:contextR.data??null,
    consensus:consensusR.data??null,
    baselineDraft:baselineR.data??null,
    industryAssignment:assignmentR.data??null,
  });
}

async function settledResult(item,payload={}){
  const current=await freshItem(item.id);
  return{
    ...payload,
    ticker:String(item.ticker).toUpperCase(),
    selection_reason:item.selection_reason??null,
    evidence_state_hash:await loadSettlementHash(current),
  };
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
  .order("ordinal",{ascending:true});
if(tickerArg)itemQuery=itemQuery.eq("ticker",String(tickerArg).toUpperCase());
const {data:allItems,error:itemError}=await itemQuery;
if(itemError)throw itemError;

const itemIds=(allItems??[]).map(item=>item.id);
const {data:decisions,error:decisionError}=itemIds.length
  ?await sb.from("research_factory_autonomous_decisions")
    .select("research_factory_item_id,decision_type,decision_status,policy_version,created_at")
    .in("research_factory_item_id",itemIds)
    .order("created_at",{ascending:false})
  :{data:[],error:null};
if(decisionError)throw decisionError;

const {data:priorRuns,error:priorRunError}=await sb.from("research_factory_autonomous_runs")
  .select("started_at,summary")
  .eq("research_factory_run_id",factoryRun.id)
  .order("started_at",{ascending:false})
  .limit(250);
if(priorRunError)throw priorRunError;

const priorSettlementByTicker=new Map();
for(const run of priorRuns??[]){
  for(const result of Array.isArray(run?.summary?.results)?run.summary.results:[]){
    const ticker=String(result?.ticker??"").toUpperCase();
    const hash=result?.evidence_state_hash??null;
    if(ticker&&hash&&!priorSettlementByTicker.has(ticker)){
      priorSettlementByTicker.set(ticker,hash);
    }
  }
}
const currentSettlementHashes=new Map();
const priorSettlementHashes=new Map();
if(!tickerArg){
  for(const item of (allItems??[]).filter(row=>row.status==="quarantined")){
    const current=await loadSettlementHash(item);
    if(current)currentSettlementHashes.set(item.id,current);
    const prior=priorSettlementByTicker.get(String(item.ticker).toUpperCase())??null;
    if(prior)priorSettlementHashes.set(item.id,prior);
  }
}

const selected=selectAutonomousResearchFactoryCandidates({
  items:allItems??[],
  decisions:decisions??[],
  currentSettlementHashes,
  priorSettlementHashes,
  ticker:tickerArg,
  maxItems:tickerArg?1:maxItems,
});

if(!selected.length){
  console.log(JSON.stringify({
    automation_version:AUTONOMOUS_RESEARCH_FACTORY_VERSION,
    research_factory_run_id:factoryRun.id,
    status:"noop",
    processed:0,
    queue_version:AUTONOMOUS_SETTLED_QUEUE_VERSION,
    message:"No unsettled Research Factory items are available for Autonomous V2.1.2.",
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
      queue_version:AUTONOMOUS_SETTLED_QUEUE_VERSION,
      selection_policy:"unattempted_review_gate_then_queued_then_changed_quarantine",
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
      results.push(await settledResult(item,{outcome,steps}));
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
    results.push(await settledResult(item,{outcome,stage:current.stage,status:current.status,steps}));
  }catch(error){
    outcome="failed";
    results.push({
      ticker,
      outcome,
      selection_reason:item.selection_reason??null,
      evidence_state_hash:null,
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
      queue_version:AUTONOMOUS_SETTLED_QUEUE_VERSION,
      selection_policy:"unattempted_review_gate_then_queued_then_changed_quarantine",
      auto_approved:autoApproved,
      quarantined,
      failed,
      results:results.map(x=>({
        ticker:x.ticker,
        outcome:x.outcome,
        selection_reason:x.selection_reason??null,
        evidence_state_hash:x.evidence_state_hash??null,
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
  queue_version:AUTONOMOUS_SETTLED_QUEUE_VERSION,
  selected:selected.map(x=>({ticker:x.ticker,selection_reason:x.selection_reason})),
  processed:results.length,
  auto_approved:autoApproved,
  quarantined,
  failed,
  results,
},null,2));

if(failed===results.length)process.exitCode=1;
