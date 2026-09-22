import process from "node:process";
import { createPostgresCompatClient } from "../lib/pg-supabase-compat.mjs";
import { normalizeYahooCapital, YAHOO_CAPITAL_PROVIDER } from "../lib/yahoo-capital-intelligence.mjs";
import {
  CAPITAL_ORCHESTRATOR_VERSION,
  providerHealthRow,
  shouldReplaceCoverage,
} from "../lib/capital-intelligence-orchestrator.mjs";

if(!process.env.SOLPIENT_DATABASE_URL && typeof process.loadEnvFile==="function"){
  try{process.loadEnvFile(".env.local");}catch{}
}
if(!process.env.SOLPIENT_DATABASE_URL)throw new Error("Missing SOLPIENT_DATABASE_URL.");
const supabase=createPostgresCompatClient();

const onlyTicker=process.env.COVERAGE_TICKER?String(process.env.COVERAGE_TICKER).toUpperCase():null;
const userAgent=process.env.YAHOO_DATA_USER_AGENT??"SOLPIENT Research/1.0";
const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
let auth=null;
let requests=0;

async function cookieCrumb(){
  try{
    const boot=await fetch("https://fc.yahoo.com",{headers:{"User-Agent":userAgent},redirect:"manual"});
    const sets=typeof boot.headers.getSetCookie==="function"
      ?boot.headers.getSetCookie()
      :[boot.headers.get("set-cookie")].filter(Boolean);
    const cookie=sets.map((value)=>String(value).split(";")[0]).join("; ");
    if(!cookie)return null;
    const response=await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb",{
      headers:{"User-Agent":userAgent,Cookie:cookie},
    });
    if(!response.ok)return null;
    const crumb=(await response.text()).trim();
    return crumb?{cookie,crumb}:null;
  }catch{return null;}
}

async function requestSummary(symbol){
  async function attempt(host,withAuth=false){
    const endpoint=new URL(host+"/v10/finance/quoteSummary/"+encodeURIComponent(symbol));
    endpoint.searchParams.set("modules","insiderTransactions,institutionOwnership");
    endpoint.searchParams.set("formatted","false");
    const headers={"User-Agent":userAgent,Accept:"application/json"};
    if(withAuth&&auth){
      endpoint.searchParams.set("crumb",auth.crumb);
      headers.Cookie=auth.cookie;
    }
    const response=await fetch(endpoint,{headers});
    requests+=1;
    const text=await response.text();
    let body;
    try{body=JSON.parse(text);}catch{body=null;}
    const error=body?.quoteSummary?.error??body?.finance?.error;
    if(response.ok&&!error&&body?.quoteSummary?.result?.[0])return body;
    const e=new Error("Yahoo capital HTTP "+response.status+": "+String(error?.description??text).slice(0,220));
    e.status=response.status;
    throw e;
  }
  try{return await attempt("https://query1.finance.yahoo.com");}
  catch(first){
    try{return await attempt("https://query2.finance.yahoo.com");}
    catch(second){
      if([401,403].includes(Number(second.status??first.status))){
        auth=auth??await cookieCrumb();
        if(auth)return attempt("https://query2.finance.yahoo.com",true);
      }
      throw second;
    }
  }
}

const {data:run,error:runError}=await supabase.from("automation_runs").insert({
  pipeline:"yahoo_capital_intelligence",
  status:"running",
  details:{provider:YAHOO_CAPITAL_PROVIDER,orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION},
}).select("id").single();
if(runError)throw runError;

const failures=[];
let rowsWritten=0;
let coverageApplied=0;
let companiesSucceeded=0;

try{
  const [companiesR,coverageR]=await Promise.all([
    supabase.from("companies").select("id,ticker,company_name").order("ticker"),
    supabase.from("capital_coverage_checks").select("*"),
  ]);
  if(companiesR.error)throw companiesR.error;
  if(coverageR.error)throw coverageR.error;

  const companies=(companiesR.data??[]).filter((company)=>!onlyTicker||company.ticker===onlyTicker);
  const existingCoverage=new Map(
    (coverageR.data??[]).map((row)=>[[row.company_id,row.activity_type].join("|"),row]),
  );
  const verifiedAt=new Date().toISOString();

  for(const company of companies){
    try{
      const body=await requestSummary(company.ticker);
      const normalized=normalizeYahooCapital({company,body,verifiedAt});

      if(normalized.rows.length){
        const {error}=await supabase.from("capital_activity")
          .upsert(normalized.rows,{onConflict:"provider,source_key",ignoreDuplicates:false});
        if(error)throw error;
        rowsWritten+=normalized.rows.length;
      }

      const toWrite=normalized.coverage.filter((row)=>{
        const key=[row.company_id,row.activity_type].join("|");
        return shouldReplaceCoverage(existingCoverage.get(key),row);
      });
      if(toWrite.length){
        const {error}=await supabase.from("capital_coverage_checks")
          .upsert(toWrite,{onConflict:"company_id,activity_type",ignoreDuplicates:false});
        if(error)throw error;
        coverageApplied+=toWrite.length;
        for(const row of toWrite)existingCoverage.set([row.company_id,row.activity_type].join("|"),row);
      }

      companiesSucceeded+=1;
      console.log(company.ticker+": "+normalized.summary.insider_rows+" insider rows, "+normalized.summary.institutional_rows+" institutional rows.");
    }catch(error){
      failures.push({ticker:company.ticker,error:error instanceof Error?error.message:String(error)});
    }
    await sleep(120);
  }

  const currentCoverage=[...existingCoverage.values()].filter((row)=>row.provider===YAHOO_CAPITAL_PROVIDER);
  const now=new Date().toISOString();
  const healthRows=["insider","institutional"].map((feedType)=>{
    const feedRows=currentCoverage.filter((row)=>row.activity_type===feedType);
    return providerHealthRow({
      provider:YAHOO_CAPITAL_PROVIDER,
      feedType,
      status:failures.length?"degraded":"healthy",
      lastAttemptAt:now,
      lastSuccessAt:companiesSucceeded?now:null,
      lastVerifiedAt:companiesSucceeded?verifiedAt:null,
      rowsWritten:0,
      companiesCovered:new Set(feedRows.map((row)=>row.company_id)).size,
      lastError:failures.length?failures.slice(0,5).map((x)=>x.ticker+": "+x.error).join(" | "):null,
      metadata:{requests,companies_succeeded:companiesSucceeded,coverage_applied:coverageApplied},
    });
  });
  healthRows.push(providerHealthRow({
    provider:YAHOO_CAPITAL_PROVIDER,
    feedType:"all",
    status:failures.length?"degraded":"healthy",
    lastAttemptAt:now,
    lastSuccessAt:companiesSucceeded?now:null,
    lastVerifiedAt:companiesSucceeded?verifiedAt:null,
    rowsWritten,
    companiesCovered:new Set(currentCoverage.map((row)=>row.company_id)).size,
    lastError:failures.length?failures.slice(0,5).map((x)=>x.ticker+": "+x.error).join(" | "):null,
    metadata:{requests,companies_succeeded:companiesSucceeded,coverage_applied:coverageApplied},
  }));
  const {error:healthError}=await supabase.from("capital_provider_health")
    .upsert(healthRows,{onConflict:"provider,feed_type",ignoreDuplicates:false});
  if(healthError)throw healthError;

  const status=companiesSucceeded===companies.length?"success":companiesSucceeded?"partial":"failed";
  const message="Yahoo capital fallback processed "+companiesSucceeded+"/"+companies.length+" companies; wrote "+rowsWritten+" activity rows and applied "+coverageApplied+" coverage updates.";
  const {error:finishError}=await supabase.from("automation_runs").update({
    status,
    records_written:rowsWritten,
    message,
    details:{
      provider:YAHOO_CAPITAL_PROVIDER,
      requests,
      companies_attempted:companies.length,
      companies_succeeded:companiesSucceeded,
      coverage_applied:coverageApplied,
      failures,
      orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION,
    },
    completed_at:new Date().toISOString(),
  }).eq("id",run.id);
  if(finishError)throw finishError;

  console.log(JSON.stringify({status,message,failures},null,2));
  if(!companiesSucceeded)process.exitCode=1;
}catch(error){
  await supabase.from("automation_runs").update({
    status:"failed",
    records_written:rowsWritten,
    message:error instanceof Error?error.message:String(error),
    details:{provider:YAHOO_CAPITAL_PROVIDER,requests,failures,orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION},
    completed_at:new Date().toISOString(),
  }).eq("id",run.id);
  throw error;
}
