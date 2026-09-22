import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pgQuery, postgresConfigured } from "../lib/postgres-node.mjs";

if(!postgresConfigured())throw new Error("Missing SOLPIENT_DATABASE_URL.");

const outputArg=process.argv.find((arg)=>arg.startsWith("--output="))?.split("=")[1]??"artifacts/capital-coverage-queue.json";
const statuses=(process.argv.find((arg)=>arg.startsWith("--status="))?.split("=")[1]??"pending,partial,unavailable")
  .split(",").map((x)=>x.trim()).filter(Boolean);

const rows=await pgQuery(`
  select
    ccc.id,
    ccc.company_id,
    ccc.activity_type,
    ccc.status,
    ccc.provider,
    ccc.window_start,
    ccc.window_end,
    ccc.verified_at,
    ccc.record_count,
    ccc.source_url,
    ccc.notes,
    ccc.updated_at,
    c.ticker,
    c.company_name
  from public.capital_coverage_checks ccc
  join public.companies c on c.id=ccc.company_id
  where ccc.status::text=any($1::text[])
  order by ccc.updated_at asc
`,[statuses]);

const queue=rows.map((row)=>({
  id:row.id,
  ticker:row.ticker,
  company_name:row.company_name,
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
console.log(JSON.stringify({output:absolute,queue_size:queue.length,statuses,database:"postgres"},null,2));
