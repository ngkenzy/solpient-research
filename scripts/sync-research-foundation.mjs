import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY?.trim()||process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");

const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const onlyTicker=(process.env.COVERAGE_TICKER??"").trim().toUpperCase()||null;
const asOf=new Date().toISOString();

const {data:run,error:runError}=await sb.from("automation_runs").insert({
  pipeline:"research_foundation_state_v1",
  status:"running",
  details:{as_of:asOf,ticker:onlyTicker},
}).select("id").single();
if(runError)throw runError;

const summary=[];
let written=0;

try{
  let query=sb.from("companies").select("id,ticker,company_name").order("ticker");
  if(onlyTicker)query=query.eq("ticker",onlyTicker);
  const {data:companies,error}=await query;
  if(error)throw error;

  for(const company of companies??[]){
    try{
      const {data:state,error:stateError}=await sb.rpc("refresh_research_foundation_state_v1",{
        p_company_id:company.id,
        p_as_of:asOf,
      });
      if(stateError)throw stateError;

      const {data:queued,error:queueError}=await sb.rpc("enqueue_due_research_maintenance_v1",{
        p_company_id:company.id,
        p_as_of:asOf,
      });
      if(queueError)throw queueError;

      summary.push({
        ticker:company.ticker,
        status:"success",
        coverage_level:state?.coverage_level??null,
        queued:Number(queued??0),
      });
      written+=1;
    }catch(error){
      summary.push({
        ticker:company.ticker,
        status:"failed",
        error:error instanceof Error?error.message:String(error),
      });
    }
  }

  const failed=summary.filter((row)=>row.status==="failed");
  const status=failed.length===0?"success":failed.length===summary.length?"failed":"partial";
  const {error:finishError}=await sb.from("automation_runs").update({
    status,
    records_written:written,
    message:`Research foundation synchronized ${written}/${summary.length} companies.`,
    details:{as_of:asOf,ticker:onlyTicker,summary},
    completed_at:new Date().toISOString(),
  }).eq("id",run.id);
  if(finishError)throw finishError;

  console.log(JSON.stringify({as_of:asOf,status,summary},null,2));
  if(status==="failed")process.exitCode=1;
}catch(error){
  await sb.from("automation_runs").update({
    status:"failed",
    message:error instanceof Error?error.message:String(error),
    details:{as_of:asOf,ticker:onlyTicker},
    completed_at:new Date().toISOString(),
  }).eq("id",run.id);
  throw error;
}
