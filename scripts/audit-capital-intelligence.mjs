import fs from "node:fs/promises";
import process from "node:process";
import { createPostgresCompatClient } from "../lib/pg-supabase-compat.mjs";
import {
  CAPITAL_ORCHESTRATOR_VERSION,
  feedFreshness,
  providerHealthRow,
  summarizeCapitalCoverageMatrix,
} from "../lib/capital-intelligence-orchestrator.mjs";

if(!process.env.SOLPIENT_DATABASE_URL && typeof process.loadEnvFile==="function"){
  try{process.loadEnvFile(".env.local");}catch{}
}
if(!process.env.SOLPIENT_DATABASE_URL)throw new Error("Missing SOLPIENT_DATABASE_URL.");
const supabase=createPostgresCompatClient();
const providers=JSON.parse(await fs.readFile(new URL("../data/monitor/capital-providers.json",import.meta.url),"utf8"));

async function fetchAllCapitalActivity() {
  const pageSize=1000;
  const rows=[];
  for(let from=0;from<100000;from+=pageSize){
    const {data,error}=await supabase
      .from("capital_activity")
      .select("id,company_id,activity_type,provider,verified_at,created_at")
      .order("id",{ascending:true})
      .range(from,from+pageSize-1);
    if(error)throw error;
    const page=data??[];
    rows.push(...page);
    if(page.length<pageSize)break;
  }
  return rows;
}

const {data:run,error:runError}=await supabase.from("automation_runs").insert({
  pipeline:"capital_intelligence_orchestrator",
  status:"running",
  details:{orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION},
}).select("id").single();
if(runError)throw runError;

try{
  const [companiesR,activity,coverageR,healthR,directRunsR]=await Promise.all([
    supabase.from("companies").select("id,ticker,company_name").order("ticker"),
    fetchAllCapitalActivity(),
    supabase.from("capital_coverage_checks").select("*"),
    supabase.from("capital_provider_health").select("*"),
    supabase.from("automation_runs").select("status,started_at,completed_at,records_written,message,details")
      .eq("pipeline","capital_intelligence").order("started_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  for(const result of [companiesR,coverageR,healthR,directRunsR])if(result.error)throw result.error;

  const companies=companiesR.data??[];
  const existing=new Map((healthR.data??[]).map((row)=>[[row.provider,row.feed_type].join("|"),row]));
  const now=new Date();
  const healthRows=[];

  for(const config of providers){
    for(const feedType of [...config.feeds,"all"]){
      const key=[config.provider,feedType].join("|");
      const prior=existing.get(key);
      let status=prior?.status??"inactive";
      let lastError=prior?.last_error??null;
      let lastAttemptAt=prior?.last_attempt_at??null;
      let lastSuccessAt=prior?.last_success_at??null;
      let lastVerifiedAt=prior?.last_verified_at??null;
      let rowsWritten=prior?.rows_written??0;
      let companiesCovered=prior?.companies_covered??0;

      const providerRows=activity.filter((row)=>
        row.provider===config.provider &&
        (feedType==="all" || row.activity_type===feedType)
      );
      if(providerRows.length){
        const latestVerified=providerRows
          .map((row)=>row.verified_at??row.created_at)
          .filter(Boolean)
          .sort()
          .at(-1)??null;
        rowsWritten=providerRows.length;
        companiesCovered=new Set(providerRows.map((row)=>row.company_id)).size;
        if(!lastSuccessAt)lastSuccessAt=latestVerified;
        if(!lastVerifiedAt)lastVerifiedAt=latestVerified;
        if(!prior){
          status=feedFreshness({
            lastSuccessAt:latestVerified,
            now,
            staleAfterHours:Number(config.stale_after_hours??36),
          });
        }
      }

      if(config.provider==="sec_direct"){
        const direct=directRunsR.data;
        if(direct){
          lastAttemptAt=direct.completed_at??direct.started_at??lastAttemptAt;
          const failures=Array.isArray(direct.details?.failures)?direct.details.failures:[];
          const blocked=Number(direct.records_written??0)===0 && failures.some((x)=>String(x).includes("403"));
          if(blocked){
            status="blocked";
            lastError="SEC rejected direct requests from the cloud runner (HTTP 403).";
          }else if(direct.status==="success" && Number(direct.records_written??0)>0){
            status="healthy";
            lastSuccessAt=direct.completed_at??lastSuccessAt;
            lastError=null;
          }else if(direct.status==="partial"){
            status="degraded";
            lastSuccessAt=direct.completed_at??lastSuccessAt;
            lastError=direct.message??lastError;
          }
        }
      }else if(prior?.last_success_at){
        const freshness=feedFreshness({
          lastSuccessAt:prior.last_success_at,
          now,
          staleAfterHours:Number(config.stale_after_hours??36),
        });
        status=freshness==="stale"?"stale":prior.status==="blocked"?"blocked":"healthy";
      }

      healthRows.push(providerHealthRow({
        provider:config.provider,
        feedType,
        status,
        lastAttemptAt,
        lastSuccessAt,
        lastVerifiedAt,
        rowsWritten,
        companiesCovered,
        lastError,
        metadata:{
          ...(prior?.metadata??{}),
          mode:config.mode,
          priority:config.priority,
          stale_after_hours:config.stale_after_hours,
          description:config.description,
        },
      }));
    }
  }

  if(healthRows.length){
    const {error}=await supabase.from("capital_provider_health")
      .upsert(healthRows,{onConflict:"provider,feed_type",ignoreDuplicates:false});
    if(error)throw error;
  }

  const coverage=summarizeCapitalCoverageMatrix(coverageR.data??[],activity,companies);
  const fullyReviewed=coverage.filter((row)=>row.fully_reviewed).length;
  const fullyVerified=coverage.filter((row)=>row.fully_verified).length;
  const anyReviewed=coverage.filter((row)=>row.categories_reviewed>0).length;
  const unresolvedCells=coverage.reduce((sum,row)=>sum+(3-row.categories_complete),0);
  const incomplete=coverage.filter((row)=>!row.fully_verified).map((row)=>row.ticker);

  const status=fullyVerified===companies.length?"success":anyReviewed>0?"partial":"failed";
  const message="Capital intelligence verification: "+fullyVerified+"/"+companies.length+" companies have all three categories verified; "+unresolvedCells+" of "+(companies.length*3)+" cells remain unresolved.";

  const {error:finishError}=await supabase.from("automation_runs").update({
    status,
    records_written:activity.length,
    message,
    details:{
      orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION,
      companies:companies.length,
      companies_with_any_review:anyReviewed,
      companies_fully_reviewed:fullyReviewed,
      companies_fully_verified:fullyVerified,
      total_coverage_cells:companies.length*3,
      unresolved_coverage_cells:unresolvedCells,
      incomplete_companies:incomplete,
      coverage,
      providers:healthRows.map((row)=>({provider:row.provider,feed_type:row.feed_type,status:row.status})),
    },
    completed_at:new Date().toISOString(),
  }).eq("id",run.id);
  if(finishError)throw finishError;

  console.log(JSON.stringify({status,message,incomplete,unresolvedCells,coverage},null,2));
}catch(error){
  await supabase.from("automation_runs").update({
    status:"failed",
    message:error instanceof Error?error.message:String(error),
    details:{orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION},
    completed_at:new Date().toISOString(),
  }).eq("id",run.id);
  throw error;
}
