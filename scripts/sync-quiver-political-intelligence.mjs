import process from "node:process";
import { createPostgresCompatClient } from "../lib/pg-supabase-compat.mjs";
import { normalizeQuiverPolitical, QUIVER_POLITICAL_PROVIDER } from "../lib/quiver-political-intelligence.mjs";
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
const userAgent=process.env.QUIVER_USER_AGENT??"Mozilla/5.0 (compatible; SOLPIENT-Research/1.0; +https://github.com/ngkenzy/solpient-research)";
const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
let requests=0;

async function fetchPage(pageUrl,ticker){
  const response=await fetch(pageUrl,{
    headers:{
      "User-Agent":userAgent,
      Accept:"text/html,application/xhtml+xml",
      "Accept-Language":"en-US,en;q=0.8",
    },
    signal:AbortSignal.timeout(15000),
  });
  requests+=1;
  const html=await response.text();
  if(!response.ok)throw new Error("Quiver HTTP "+response.status+" for "+ticker);
  return html;
}

async function fetchTickerPage(ticker){
  const congressUrl="https://www.quiverquant.com/congresstrading/stock/"+encodeURIComponent(ticker);
  const congressHtml=await fetchPage(congressUrl,ticker);
  if(/Congress Trading Activity|Congress Trades/i.test(congressHtml)){
    return {html:congressHtml,pageUrl:congressUrl,explicitNone:false};
  }
  if(/No Congressional activity found for this ticker/i.test(congressHtml)){
    return {html:congressHtml,pageUrl:congressUrl,explicitNone:true};
  }

  const stockUrl="https://www.quiverquant.com/stock/"+encodeURIComponent(ticker)+"/";
  const stockHtml=await fetchPage(stockUrl,ticker);
  if(/No Congress Trading data for this ticker|No Congressional activity found for this ticker/i.test(stockHtml)){
    return {html:stockHtml,pageUrl:stockUrl,explicitNone:true};
  }
  throw new Error("Quiver did not expose a recognized Congress trading state for "+ticker);
}

const {data:run,error:runError}=await supabase.from("automation_runs").insert({
  pipeline:"quiver_political_intelligence",
  status:"running",
  details:{provider:QUIVER_POLITICAL_PROVIDER,orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION},
}).select("id").single();
if(runError)throw runError;

let rowsWritten=0;
let coverageApplied=0;
let companiesSucceeded=0;
const failures=[];

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
      const page=await fetchTickerPage(company.ticker);
      const normalized=normalizeQuiverPolitical({
        company,
        html:page.html,
        verifiedAt,
        sourceUrl:page.pageUrl,
        explicitNone:page.explicitNone,
      });

      if(normalized.rows.length){
        const {error}=await supabase.from("capital_activity")
          .upsert(normalized.rows,{onConflict:"provider,source_key",ignoreDuplicates:false});
        if(error)throw error;
        rowsWritten+=normalized.rows.length;
      }

      const key=[normalized.coverage.company_id,normalized.coverage.activity_type].join("|");
      if(shouldReplaceCoverage(existingCoverage.get(key),normalized.coverage)){
        const {error}=await supabase.from("capital_coverage_checks")
          .upsert(normalized.coverage,{onConflict:"company_id,activity_type",ignoreDuplicates:false});
        if(error)throw error;
        existingCoverage.set(key,normalized.coverage);
        coverageApplied+=1;
      }

      companiesSucceeded+=1;
      console.log(company.ticker+": "+normalized.rows.length+" political trade row(s), coverage "+normalized.coverage.status+".");
    }catch(error){
      failures.push({ticker:company.ticker,error:error instanceof Error?error.message:String(error)});
    }
    await sleep(250);
  }

  const quiverCoverage=[...existingCoverage.values()].filter((row)=>row.provider===QUIVER_POLITICAL_PROVIDER&&row.activity_type==="political");
  const now=new Date().toISOString();
  const healthRows=[
    providerHealthRow({
      provider:QUIVER_POLITICAL_PROVIDER,
      feedType:"political",
      status:failures.length?"degraded":"healthy",
      lastAttemptAt:now,
      lastSuccessAt:companiesSucceeded?now:null,
      lastVerifiedAt:companiesSucceeded?verifiedAt:null,
      rowsWritten,
      companiesCovered:new Set(quiverCoverage.map((row)=>row.company_id)).size,
      lastError:failures.length?failures.slice(0,5).map((x)=>x.ticker+": "+x.error).join(" | "):null,
      metadata:{requests,companies_succeeded:companiesSucceeded,coverage_applied:coverageApplied,source:"public_html"},
    }),
    providerHealthRow({
      provider:QUIVER_POLITICAL_PROVIDER,
      feedType:"all",
      status:failures.length?"degraded":"healthy",
      lastAttemptAt:now,
      lastSuccessAt:companiesSucceeded?now:null,
      lastVerifiedAt:companiesSucceeded?verifiedAt:null,
      rowsWritten,
      companiesCovered:new Set(quiverCoverage.map((row)=>row.company_id)).size,
      lastError:failures.length?failures.slice(0,5).map((x)=>x.ticker+": "+x.error).join(" | "):null,
      metadata:{requests,companies_succeeded:companiesSucceeded,coverage_applied:coverageApplied,source:"public_html"},
    }),
  ];
  const {error:healthError}=await supabase.from("capital_provider_health")
    .upsert(healthRows,{onConflict:"provider,feed_type",ignoreDuplicates:false});
  if(healthError)throw healthError;

  const status=companiesSucceeded===companies.length?"success":companiesSucceeded?"partial":"failed";
  const message="Quiver political fallback processed "+companiesSucceeded+"/"+companies.length+" companies; wrote "+rowsWritten+" political activity rows and applied "+coverageApplied+" coverage updates.";
  const {error:finishError}=await supabase.from("automation_runs").update({
    status,
    records_written:rowsWritten,
    message,
    details:{
      provider:QUIVER_POLITICAL_PROVIDER,
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
    details:{provider:QUIVER_POLITICAL_PROVIDER,requests,failures,orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION},
    completed_at:new Date().toISOString(),
  }).eq("id",run.id);
  throw error;
}
