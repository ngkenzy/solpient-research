import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const url=process.env.SUPABASE_URL?.trim();
const secret=
  process.env.SUPABASE_SECRET_KEY?.trim()||
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if(!url||!secret){
  throw new Error("Missing SUPABASE_URL and server secret.");
}

const sb=createClient(url,secret,{
  auth:{persistSession:false,autoRefreshToken:false},
});

const batchSize=Math.max(
  1,
  Math.min(1000,Number(process.env.CONSUMER_ATTENTION_BATCH_SIZE??200))
);
const sinceDays=Math.max(
  1,
  Math.min(365,Number(process.env.CONSUMER_ATTENTION_SINCE_DAYS??30))
);

const sinceDate=new Date(Date.now()-sinceDays*24*60*60*1000)
  .toISOString()
  .slice(0,10);
const digestDate=new Date().toISOString().slice(0,10);
const workerId=process.env.GITHUB_RUN_ID
  ? "github:"+process.env.GITHUB_RUN_ID
  : "local:"+process.pid;

function formatError(error){
  if(error instanceof Error)return error.message;
  if(error&&typeof error==="object"){
    const parts=[
      error.code?String(error.code):null,
      error.message?String(error.message):null,
      error.details?String(error.details):null,
      error.hint?String(error.hint):null,
    ].filter(Boolean);
    if(parts.length)return parts.join(" | ");
    try{return JSON.stringify(error);}
    catch{return String(error);}
  }
  return String(error);
}

const {data:run,error:runError}=await sb
  .from("automation_runs")
  .insert({
    pipeline:"consumer_attention_refresh_v1",
    status:"running",
    details:{
      worker_id:workerId,
      batch_size:batchSize,
      since_days:sinceDays,
      since_date:sinceDate,
      digest_date:digestDate,
    },
  })
  .select("id")
  .single();

if(runError)throw runError;

try{
  const {data,error}=await sb.rpc("refresh_consumer_attention_batch_v1",{
    p_since:sinceDate,
    p_digest_date:digestDate,
    p_limit:batchSize,
  });
  if(error)throw error;

  const result=data??{};
  const failures=Number(result.failures??0);
  const status=failures===0?"success":"partial";

  const {error:finishError}=await sb
    .from("automation_runs")
    .update({
      status,
      records_written:
        Number(result.alerts_upserted??0)+Number(result.digests_ready??0),
      message:
        "Consumer attention refresh processed "+
        Number(result.users_processed??0)+
        " users.",
      details:{
        worker_id:workerId,
        result,
      },
      completed_at:new Date().toISOString(),
    })
    .eq("id",run.id);

  if(finishError)throw finishError;

  console.log(JSON.stringify({worker_id:workerId,...result},null,2));
  if(failures>0)process.exitCode=1;
}catch(error){
  const message=formatError(error);
  await sb
    .from("automation_runs")
    .update({
      status:"failed",
      message:message.slice(0,8000),
      details:{worker_id:workerId},
      completed_at:new Date().toISOString(),
    })
    .eq("id",run.id);
  throw error;
}
