import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  MARKETBEAT_CAPITAL_PROVIDER,
  marketBeatPageLooksValid,
  normalizeMarketBeatInsiders,
  normalizeMarketBeatInstitutional,
} from "../lib/marketbeat-capital-intelligence.mjs";
import {
  CAPITAL_ORCHESTRATOR_VERSION,
  providerHealthRow,
  shouldReplaceCoverage,
} from "../lib/capital-intelligence-orchestrator.mjs";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.SUPABASE_SECRET_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const supabase=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const onlyTicker=process.env.COVERAGE_TICKER?String(process.env.COVERAGE_TICKER).toUpperCase():null;
const userAgent=process.env.MARKETBEAT_USER_AGENT??"Mozilla/5.0 (compatible; SOLPIENT-Research/1.0; +https://github.com/ngkenzy/solpient-research)";
const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
const exchanges=["NASDAQ","NYSE"];
let requests=0;

async function fetchHtml(url){
  const response=await fetch(url,{
    headers:{
      "User-Agent":userAgent,
      Accept:"text/html,application/xhtml+xml",
      "Accept-Language":"en-US,en;q=0.8",
    },
    redirect:"follow",
    signal:AbortSignal.timeout(15000),
  });
  requests+=1;
  const html=await response.text();
  if(!response.ok)throw new Error("MarketBeat HTTP "+response.status+" for "+url);
  return html;
}

async function findPage(ticker,kind,preferredExchange=null){
  const suffix=kind==="insider"?"insider-trades":"institutional-ownership";
  const candidates=[preferredExchange,...exchanges].filter((value,index,array)=>value&&array.indexOf(value)===index);
  const errors=[];
  for(const exchange of candidates){
    const pageUrl="https://www.marketbeat.com/stocks/"+exchange+"/"+encodeURIComponent(ticker)+"/"+suffix+"/";
    try{
      const html=await fetchHtml(pageUrl);
      if(marketBeatPageLooksValid(html,{ticker,kind}))return {exchange,pageUrl,html};
      errors.push(exchange+": page shape mismatch");
    }catch(error){
      errors.push(exchange+": "+(error instanceof Error?error.message:String(error)));
    }
    await sleep(100);
  }
  throw new Error("No valid MarketBeat "+kind+" page found for "+ticker+" ("+errors.join(" | ")+")");
}

async function upsertCoverage(candidate,existingCoverage){
  const key=[candidate.company_id,candidate.activity_type].join("|");
  if(!shouldReplaceCoverage(existingCoverage.get(key),candidate))return false;
  const {error}=await supabase.from("capital_coverage_checks")
    .upsert(candidate,{onConflict:"company_id,activity_type",ignoreDuplicates:false});
  if(error)throw error;
  existingCoverage.set(key,candidate);
  return true;
}

const {data:run,error:runError}=await supabase.from("automation_runs").insert({
  pipeline:"marketbeat_capital_intelligence",
  status:"running",
  details:{provider:MARKETBEAT_CAPITAL_PROVIDER,orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION},
}).select("id").single();
if(runError)throw runError;

let rowsWritten=0;
let coverageApplied=0;
let companiesWithInsiderPage=0;
let companiesWithInstitutionalPage=0;
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
    let exchange=null;

    try{
      const page=await findPage(company.ticker,"insider");
      exchange=page.exchange;
      const normalized=normalizeMarketBeatInsiders({
        company,html:page.html,sourceUrl:page.pageUrl,verifiedAt,maxRows:100,
      });
      if(normalized.rows.length){
        const {error}=await supabase.from("capital_activity")
          .upsert(normalized.rows,{onConflict:"provider,source_key",ignoreDuplicates:false});
        if(error)throw error;
        rowsWritten+=normalized.rows.length;
      }
      if(await upsertCoverage(normalized.coverage,existingCoverage))coverageApplied+=1;
      companiesWithInsiderPage+=1;
      console.log(company.ticker+": MarketBeat insider rows "+normalized.rows.length+", "+normalized.coverage.status+".");
    }catch(error){
      failures.push({ticker:company.ticker,feed:"insider",error:error instanceof Error?error.message:String(error)});
    }

    try{
      const page=await findPage(company.ticker,"institutional",exchange);
      const normalized=normalizeMarketBeatInstitutional({
        company,html:page.html,sourceUrl:page.pageUrl,verifiedAt,maxRows:100,
      });
      if(normalized.rows.length){
        const {error}=await supabase.from("capital_activity")
          .upsert(normalized.rows,{onConflict:"provider,source_key",ignoreDuplicates:false});
        if(error)throw error;
        rowsWritten+=normalized.rows.length;
      }
      if(await upsertCoverage(normalized.coverage,existingCoverage))coverageApplied+=1;
      companiesWithInstitutionalPage+=1;
      console.log(company.ticker+": MarketBeat institutional rows "+normalized.rows.length+", "+normalized.coverage.status+".");
    }catch(error){
      failures.push({ticker:company.ticker,feed:"institutional",error:error instanceof Error?error.message:String(error)});
    }

    await sleep(250);
  }

  const current=[...existingCoverage.values()].filter((row)=>row.provider===MARKETBEAT_CAPITAL_PROVIDER);
  const now=new Date().toISOString();
  const insiderCoverage=current.filter((row)=>row.activity_type==="insider");
  const institutionalCoverage=current.filter((row)=>row.activity_type==="institutional");
  const healthRows=[
    providerHealthRow({
      provider:MARKETBEAT_CAPITAL_PROVIDER,
      feedType:"insider",
      status:companiesWithInsiderPage===companies.length?"healthy":companiesWithInsiderPage?"degraded":"blocked",
      lastAttemptAt:now,
      lastSuccessAt:companiesWithInsiderPage?now:null,
      lastVerifiedAt:companiesWithInsiderPage?verifiedAt:null,
      rowsWritten:0,
      companiesCovered:new Set(insiderCoverage.map((row)=>row.company_id)).size,
      lastError:failures.filter((x)=>x.feed==="insider").slice(0,5).map((x)=>x.ticker+": "+x.error).join(" | ")||null,
      metadata:{requests,pages_loaded:companiesWithInsiderPage,coverage_applied:coverageApplied,source:"public_html"},
    }),
    providerHealthRow({
      provider:MARKETBEAT_CAPITAL_PROVIDER,
      feedType:"institutional",
      status:companiesWithInstitutionalPage===companies.length?"healthy":companiesWithInstitutionalPage?"degraded":"blocked",
      lastAttemptAt:now,
      lastSuccessAt:companiesWithInstitutionalPage?now:null,
      lastVerifiedAt:companiesWithInstitutionalPage?verifiedAt:null,
      rowsWritten:0,
      companiesCovered:new Set(institutionalCoverage.map((row)=>row.company_id)).size,
      lastError:failures.filter((x)=>x.feed==="institutional").slice(0,5).map((x)=>x.ticker+": "+x.error).join(" | ")||null,
      metadata:{requests,pages_loaded:companiesWithInstitutionalPage,coverage_applied:coverageApplied,source:"public_html"},
    }),
    providerHealthRow({
      provider:MARKETBEAT_CAPITAL_PROVIDER,
      feedType:"all",
      status:(companiesWithInsiderPage+companiesWithInstitutionalPage)===companies.length*2?"healthy":(companiesWithInsiderPage||companiesWithInstitutionalPage)?"degraded":"blocked",
      lastAttemptAt:now,
      lastSuccessAt:(companiesWithInsiderPage||companiesWithInstitutionalPage)?now:null,
      lastVerifiedAt:(companiesWithInsiderPage||companiesWithInstitutionalPage)?verifiedAt:null,
      rowsWritten,
      companiesCovered:new Set(current.map((row)=>row.company_id)).size,
      lastError:failures.slice(0,5).map((x)=>x.ticker+" "+x.feed+": "+x.error).join(" | ")||null,
      metadata:{requests,insider_pages:companiesWithInsiderPage,institutional_pages:companiesWithInstitutionalPage,coverage_applied:coverageApplied,source:"public_html"},
    }),
  ];
  const {error:healthError}=await supabase.from("capital_provider_health")
    .upsert(healthRows,{onConflict:"provider,feed_type",ignoreDuplicates:false});
  if(healthError)throw healthError;

  const successfulPages=companiesWithInsiderPage+companiesWithInstitutionalPage;
  const totalPages=companies.length*2;
  const status=successfulPages===totalPages?"success":successfulPages?"partial":"failed";
  const message="MarketBeat fallback loaded "+successfulPages+"/"+totalPages+" company/feed pages; wrote "+rowsWritten+" activity rows and applied "+coverageApplied+" coverage updates.";
  const {error:finishError}=await supabase.from("automation_runs").update({
    status,
    records_written:rowsWritten,
    message,
    details:{
      provider:MARKETBEAT_CAPITAL_PROVIDER,
      requests,
      company_count:companies.length,
      insider_pages:companiesWithInsiderPage,
      institutional_pages:companiesWithInstitutionalPage,
      coverage_applied:coverageApplied,
      failures,
      orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION,
    },
    completed_at:new Date().toISOString(),
  }).eq("id",run.id);
  if(finishError)throw finishError;

  console.log(JSON.stringify({status,message,failures},null,2));
  if(!successfulPages)process.exitCode=1;
}catch(error){
  await supabase.from("automation_runs").update({
    status:"failed",
    records_written:rowsWritten,
    message:error instanceof Error?error.message:String(error),
    details:{provider:MARKETBEAT_CAPITAL_PROVIDER,requests,failures,orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION},
    completed_at:new Date().toISOString(),
  }).eq("id",run.id);
  throw error;
}
