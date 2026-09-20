import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.SUPABASE_SECRET_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const supabase=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const outputArg=process.argv.find((arg)=>arg.startsWith("--output="))?.split("=")[1]??"artifacts/capital-coverage-queue.json";
const statuses=(process.argv.find((arg)=>arg.startsWith("--status="))?.split("=")[1]??"pending,partial,unavailable")
  .split(",").map((x)=>x.trim()).filter(Boolean);

const {data,error}=await supabase
  .from("capital_coverage_checks")
  .select("id,company_id,activity_type,status,provider,window_start,window_end,verified_at,record_count,source_url,notes,updated_at,companies!inner(ticker,company_name)")
  .in("status",statuses)
  .order("updated_at",{ascending:true});
if(error)throw error;

const queue=(data??[]).map((row)=>({
  id:row.id,
  ticker:row.companies?.ticker,
  company_name:row.companies?.company_name,
  activity_type:row.activity_type,
  status:row.status,
  previous_provider:row.provider,
  window_start:row.window_start,
  window_end:row.window_end,
  verified_at:row.verified_at,
  record_count:row.record_count,
  source_url:row.source_url,
  notes:row.notes,
}));

const artifact={
  generated_at:new Date().toISOString(),
  statuses,
  queue_size:queue.length,
  queue,
  ingest_contract:{
    positive_activity:"Submit matching records plus coverage status activity_found.",
    verified_negative:"Submit coverage status verified_none with source_url, verified_at, and search window.",
    unresolved:"Keep pending/partial; never convert provider failure into verified_none.",
  },
};

const absolute=path.resolve(outputArg);
await fs.mkdir(path.dirname(absolute),{recursive:true});
await fs.writeFile(absolute,JSON.stringify(artifact,null,2)+"\n","utf8");
console.log(JSON.stringify({output:absolute,queue_size:queue.length,statuses},null,2));
