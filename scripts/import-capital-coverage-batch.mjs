import fs from "node:fs/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  CAPITAL_ORCHESTRATOR_VERSION,
  normalizeCoverageCheck,
  providerHealthRow,
  shouldReplaceCoverage,
} from "../lib/capital-intelligence-orchestrator.mjs";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.SUPABASE_SECRET_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const supabase=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const fileArg=process.argv.find((arg)=>arg.startsWith("--file="))?.split("=")[1];
if(!fileArg)throw new Error("Use --file=/path/to/capital-coverage-batch.json");

const body=JSON.parse(await fs.readFile(fileArg,"utf8"));
const provider=String(body.provider??"").trim();
const coverage=Array.isArray(body.coverage)?body.coverage:[];
const verifiedAt=body.verified_at?new Date(body.verified_at).toISOString():new Date().toISOString();
if(!provider||!coverage.length)throw new Error("Coverage batch requires provider and coverage.");

const {data:companies,error:companyError}=await supabase.from("companies").select("id,ticker,company_name");
if(companyError)throw companyError;
const companyByTicker=new Map((companies??[]).map((company)=>[String(company.ticker).toUpperCase(),company]));

const rejected=[];
const accepted=[];
coverage.forEach((item,index)=>{
  const result=normalizeCoverageCheck(item,{provider,verifiedAt,companyByTicker});
  if(result.valid)accepted.push(result.row);
  else rejected.push({index,ticker:result.ticker,errors:result.errors});
});

let applied=accepted;
if(accepted.length){
  const companyIds=[...new Set(accepted.map((row)=>row.company_id))];
  const {data:existing,error:existingError}=await supabase.from("capital_coverage_checks")
    .select("*")
    .in("company_id",companyIds);
  if(existingError)throw existingError;
  const existingByKey=new Map((existing??[]).map((row)=>[[row.company_id,row.activity_type].join("|"),row]));
  applied=accepted.filter((row)=>shouldReplaceCoverage(
    existingByKey.get([row.company_id,row.activity_type].join("|")),
    row,
  ));
  if(applied.length){
    const {error}=await supabase.from("capital_coverage_checks")
      .upsert(applied,{onConflict:"company_id,activity_type",ignoreDuplicates:false});
    if(error)throw error;
  }
}

const categories=[...new Set(accepted.map((row)=>row.activity_type))];
const covered=new Set(accepted.map((row)=>row.company_id)).size;
const status=rejected.length?(accepted.length?"partial":"rejected"):"accepted";

const {error:batchError}=await supabase.from("capital_ingest_batches").insert({
  provider,
  feed_type:categories.length===1?categories[0]:"mixed",
  status,
  records_received:0,
  records_accepted:0,
  records_rejected:0,
  verified_at:verifiedAt,
  source_run_id:body.source_run_id??null,
  errors:rejected,
  metadata:{
    orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION,
    coverage_received:coverage.length,
    coverage_accepted:accepted.length,
    coverage_applied:applied.length,
    coverage_rejected:rejected.length,
    source:body.source??null,
  },
});
if(batchError)throw batchError;

const now=new Date().toISOString();
const healthStatus=rejected.length?"degraded":"healthy";
const healthRows=[
  ...categories.map((feedType)=>providerHealthRow({
    provider,
    feedType,
    status:healthStatus,
    lastAttemptAt:now,
    lastSuccessAt:accepted.length?now:null,
    lastVerifiedAt:accepted.length?verifiedAt:null,
    rowsWritten:0,
    companiesCovered:new Set(accepted.filter((row)=>row.activity_type===feedType).map((row)=>row.company_id)).size,
    lastError:rejected.length?rejected.slice(0,5).map((x)=>x.errors.join("; ")).join(" | "):null,
    metadata:{source_run_id:body.source_run_id??null,coverage_only:true},
  })),
  providerHealthRow({
    provider,
    feedType:"all",
    status:healthStatus,
    lastAttemptAt:now,
    lastSuccessAt:accepted.length?now:null,
    lastVerifiedAt:accepted.length?verifiedAt:null,
    rowsWritten:0,
    companiesCovered:covered,
    lastError:rejected.length?rejected.slice(0,5).map((x)=>x.errors.join("; ")).join(" | "):null,
    metadata:{source_run_id:body.source_run_id??null,categories,coverage_only:true},
  }),
];
const {error:healthError}=await supabase.from("capital_provider_health")
  .upsert(healthRows,{onConflict:"provider,feed_type",ignoreDuplicates:false});
if(healthError)throw healthError;

console.log(JSON.stringify({
  orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION,
  provider,
  verified_at:verifiedAt,
  coverage_received:coverage.length,
  coverage_accepted:accepted.length,
  coverage_applied:applied.length,
  coverage_rejected:rejected.length,
  companies_covered:covered,
  rejected,
},null,2));

if(!accepted.length)process.exitCode=1;
