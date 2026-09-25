import process from "node:process";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY?.trim()||process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");

const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const limit=Math.max(1,Math.min(50,Number(process.env.RESEARCH_MAINTENANCE_BATCH_SIZE??10)));
const workerId=process.env.GITHUB_RUN_ID
  ?`github:${process.env.GITHUB_RUN_ID}`
  :`local:${process.pid}`;
const defaultSafeActions=["market_refresh","evidence_refresh","ownership_refresh"];
const requestedActions=String(process.env.RESEARCH_MAINTENANCE_ACTIONS??"")
  .split(",")
  .map((value)=>value.trim())
  .filter(Boolean);
const invalidActions=requestedActions.filter((value)=>!defaultSafeActions.includes(value));
if(invalidActions.length){
  throw new Error("Unsupported RESEARCH_MAINTENANCE_ACTIONS: "+invalidActions.join(", "));
}
const safeActions=requestedActions.length?requestedActions:defaultSafeActions;

function runNode(script,args=[],extraEnv={}){
  const result=spawnSync(process.execPath,[script,...args],{
    cwd:process.cwd(),
    env:{...process.env,...extraEnv},
    encoding:"utf8",
    stdio:["ignore","pipe","pipe"],
  });
  if(result.status!==0){
    const error=new Error(
      `${script} failed with exit ${result.status}: ${String(result.stderr||result.stdout).slice(-4000)}`
    );
    error.stdout=result.stdout;
    error.stderr=result.stderr;
    throw error;
  }
  return{stdout:result.stdout,stderr:result.stderr};
}

const {data:run,error:runError}=await sb.from("automation_runs").insert({
  pipeline:"research_maintenance_worker_v1",
  status:"running",
  details:{worker_id:workerId,limit,safe_actions:safeActions},
}).select("id").single();
if(runError)throw runError;

const results=[];

try{
  const {data:items,error:claimError}=await sb.rpc("claim_research_maintenance_batch_v1",{
    p_limit:limit,
    p_worker_id:workerId,
    p_actions:safeActions,
  });
  if(claimError)throw claimError;

  const companyIds=[...new Set((items??[]).map((item)=>item.company_id))];
  const byId=new Map();
  if(companyIds.length){
    const {data:companies,error}=await sb
      .from("companies")
      .select("id,ticker")
      .in("id",companyIds);
    if(error)throw error;
    for(const row of companies??[])byId.set(row.id,row);
  }

  for(const item of items??[]){
    const company=byId.get(item.company_id);
    if(!company){
      const message="Queue item references a missing canonical company.";
      await sb.rpc("complete_research_maintenance_item_v1",{
        p_queue_item_id:item.id,
        p_status:"failed",
        p_error_message:message,
        p_details:{worker_id:workerId},
      });
      results.push({id:item.id,status:"failed",error:message});
      continue;
    }

    try{
      const env={COVERAGE_TICKER:company.ticker};

      if(item.required_action==="market_refresh"){
        runNode("scripts/sync-market-history.mjs",[],env);
      }else if(item.required_action==="evidence_refresh"){
        runNode("scripts/sync-sec-companyfacts-backfill.mjs",[],env);
        runNode("scripts/sync-evidence-provenance.mjs",[`--ticker=${company.ticker}`],env);
      }else if(item.required_action==="ownership_refresh"){
        runNode("scripts/sync-yahoo-capital-intelligence.mjs",[],env);
        runNode("scripts/sync-evidence-provenance.mjs",[`--ticker=${company.ticker}`],env);
      }else{
        throw new Error("Worker claimed an unsupported action: "+item.required_action);
      }

      const {error:completeError}=await sb.rpc("complete_research_maintenance_item_v1",{
        p_queue_item_id:item.id,
        p_status:"succeeded",
        p_details:{
          worker_id:workerId,
          ticker:company.ticker,
          action:item.required_action,
        },
      });
      if(completeError)throw completeError;

      const now=new Date().toISOString();
      const {error:refreshError}=await sb.rpc("refresh_research_foundation_state_v1",{
        p_company_id:company.id,
        p_as_of:now,
      });
      if(refreshError)throw refreshError;

      const {data:queued,error:queueError}=await sb.rpc("enqueue_due_research_maintenance_v1",{
        p_company_id:company.id,
        p_as_of:now,
      });
      if(queueError)throw queueError;

      results.push({
        id:item.id,
        ticker:company.ticker,
        action:item.required_action,
        status:"succeeded",
        follow_on_items:Number(queued??0),
      });
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      const {error:completeError}=await sb.rpc("complete_research_maintenance_item_v1",{
        p_queue_item_id:item.id,
        p_status:"failed",
        p_error_message:message.slice(0,8000),
        p_details:{worker_id:workerId,ticker:company.ticker},
      });
      if(completeError)console.error("Unable to record failed queue item",item.id,completeError.message);
      results.push({
        id:item.id,
        ticker:company.ticker,
        action:item.required_action,
        status:"failed",
        error:message,
      });
    }
  }

  const failures=results.filter((row)=>row.status==="failed");
  const status=failures.length===0?"success":failures.length===results.length&&results.length?"failed":"partial";
  const {error:finishError}=await sb.from("automation_runs").update({
    status,
    records_written:results.filter((row)=>row.status==="succeeded").length,
    message:`Research maintenance worker processed ${results.length} items.`,
    details:{worker_id:workerId,results},
    completed_at:new Date().toISOString(),
  }).eq("id",run.id);
  if(finishError)throw finishError;

  console.log(JSON.stringify({worker_id:workerId,status,results},null,2));
  if(status==="failed")process.exitCode=1;
}catch(error){
  await sb.from("automation_runs").update({
    status:"failed",
    message:error instanceof Error?error.message:String(error),
    details:{worker_id:workerId,results},
    completed_at:new Date().toISOString(),
  }).eq("id",run.id);
  throw error;
}
