import fs from "node:fs/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  CAPITAL_ORCHESTRATOR_VERSION,
  dedupeCapitalRecords,
  materialityForCapitalActivity,
  normalizeCapitalRecord,
  providerHealthRow,
} from "../lib/capital-intelligence-orchestrator.mjs";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.SUPABASE_SECRET_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const supabase=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const fileArg=process.argv.find((arg)=>arg.startsWith("--file="))?.split("=")[1];
if(!fileArg)throw new Error("Use --file=/path/to/capital-intelligence.json");
const body=JSON.parse(await fs.readFile(fileArg,"utf8"));
const provider=String(body.provider??"").trim();
const records=Array.isArray(body.records)?body.records:[];
const verifiedAt=body.verified_at?new Date(body.verified_at).toISOString():new Date().toISOString();
if(!provider||!records.length)throw new Error("Batch requires provider and records.");

const {data:companies,error:companyError}=await supabase.from("companies").select("id,ticker,company_name");
if(companyError)throw companyError;
const companyByTicker=new Map((companies??[]).map((company)=>[String(company.ticker).toUpperCase(),company]));

const rejected=[];
const normalized=[];
records.forEach((record,index)=>{
  const result=normalizeCapitalRecord(record,{provider,verifiedAt,companyByTicker});
  if(result.valid)normalized.push(result.row);
  else rejected.push({index,ticker:result.ticker,errors:result.errors});
});
const accepted=dedupeCapitalRecords(normalized);
let stored=[];

if(accepted.length){
  const {data,error}=await supabase.from("capital_activity")
    .upsert(accepted,{onConflict:"provider,source_key",ignoreDuplicates:false})
    .select("id,company_id,activity_type,actor_name,actor_detail,action,shares,price,value,change_pct,amount_range,transaction_date,disclosure_date,position_date,source_url,provider,source_key,verified_at");
  if(error)throw error;
  stored=data??[];
}

if(stored.length){
  const events=stored.map((row)=>({
    company_id:row.company_id,
    source_kind:"capital_activity",
    source_id:row.id,
    event_type:row.activity_type,
    occurred_at:row.transaction_date??row.position_date??null,
    disclosed_at:row.disclosure_date?row.disclosure_date+"T00:00:00Z":row.verified_at,
    title:row.actor_name+" · "+row.action,
    summary:row.activity_type==="institutional"
      ?(row.actor_detail??row.actor_name)+" disclosed a position update."
      :row.activity_type==="insider"
        ?(row.actor_detail??"Insider")+" reported an ownership transaction."
        :(row.actor_detail??"Political filer")+" disclosed a transaction.",
    materiality:materialityForCapitalActivity(row),
    review_status:"open",
    source_url:row.source_url,
    metadata:{
      action:row.action,shares:row.shares,price:row.price,value:row.value,change_pct:row.change_pct,
      amount_range:row.amount_range,position_date:row.position_date,provider:row.provider,
      verified_at:row.verified_at,orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION,
    },
    updated_at:new Date().toISOString(),
  }));
  const {error}=await supabase.from("intelligence_events")
    .upsert(events,{onConflict:"source_kind,source_id",ignoreDuplicates:false});
  if(error)throw error;
}

const categories=[...new Set(accepted.map((row)=>row.activity_type))];
const covered=new Set(accepted.map((row)=>row.company_id)).size;
const status=rejected.length?(accepted.length?"partial":"rejected"):"accepted";

const {error:batchError}=await supabase.from("capital_ingest_batches").insert({
  provider,
  feed_type:categories.length===1?categories[0]:"mixed",
  status,
  records_received:records.length,
  records_accepted:accepted.length,
  records_rejected:rejected.length,
  verified_at:verifiedAt,
  source_run_id:body.source_run_id??null,
  errors:rejected,
  metadata:{orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION,source:body.source??null},
});
if(batchError)throw batchError;

const now=new Date().toISOString();
const healthStatus=rejected.length?"degraded":"healthy";
const healthRows=[
  ...categories.map((feedType)=>providerHealthRow({
    provider,feedType,status:healthStatus,lastAttemptAt:now,lastSuccessAt:accepted.length?now:null,
    lastVerifiedAt:accepted.length?verifiedAt:null,
    rowsWritten:accepted.filter((row)=>row.activity_type===feedType).length,
    companiesCovered:new Set(accepted.filter((row)=>row.activity_type===feedType).map((row)=>row.company_id)).size,
    lastError:rejected.length?rejected.slice(0,5).map((x)=>x.errors.join("; ")).join(" | "):null,
    metadata:{source_run_id:body.source_run_id??null},
  })),
  providerHealthRow({
    provider,feedType:"all",status:healthStatus,lastAttemptAt:now,lastSuccessAt:accepted.length?now:null,
    lastVerifiedAt:accepted.length?verifiedAt:null,rowsWritten:accepted.length,companiesCovered:covered,
    lastError:rejected.length?rejected.slice(0,5).map((x)=>x.errors.join("; ")).join(" | "):null,
    metadata:{source_run_id:body.source_run_id??null,categories},
  }),
];

const {error:healthError}=await supabase.from("capital_provider_health")
  .upsert(healthRows,{onConflict:"provider,feed_type",ignoreDuplicates:false});
if(healthError)throw healthError;

console.log(JSON.stringify({
  orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION,
  provider,verified_at:verifiedAt,records_received:records.length,
  records_accepted:accepted.length,records_rejected:rejected.length,
  companies_covered:covered,rejected,
},null,2));

if(!accepted.length)process.exitCode=1;
