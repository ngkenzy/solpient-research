import fs from "node:fs/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  CAPITAL_ORCHESTRATOR_VERSION,
  feedFreshness,
  providerHealthRow,
  summarizeCapitalCoverage,
} from "../lib/capital-intelligence-orchestrator.mjs";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.SUPABASE_SECRET_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const supabase=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const providers=JSON.parse(await fs.readFile(new URL("../data/monitor/capital-providers.json",import.meta.url),"utf8"));

const {data:run,error:runError}=await supabase.from("automation_runs").insert({
  pipeline:"capital_intelligence_orchestrator",
  status:"running",
  details:{orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION},
}).select("id").single();
if(runError)throw runError;

try{
  const [companiesR,activityR,healthR,directRunsR]=await Promise.all([
    supabase.from("companies").select("id,ticker,company_name").order("ticker"),
    supabase.from("capital_activity").select("company_id,activity_type,provider,verified_at,created_at"),
    supabase.from("capital_provider_health").select("*"),
    supabase.from("automation_runs").select("status,started_at,completed_at,records_written,message,details")
      .eq("pipeline","capital_intelligence").order("started_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  for(const result of [companiesR,activityR,healthR,directRunsR])if(result.error)throw result.error;

  const companies=companiesR.data??[];
  const activity=activityR.data??[];
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

  const coverage=summarizeCapitalCoverage(activity,companies);
  const fullyCovered=coverage.filter((row)=>row.categories_covered===3).length;
  const anyCovered=coverage.filter((row)=>row.categories_covered>0).length;
  const missing=coverage.filter((row)=>row.categories_covered===0).map((row)=>row.ticker);

  const status=anyCovered===companies.length?"success":anyCovered>0?"partial":"failed";
  const message="Capital intelligence coverage: "+anyCovered+"/"+companies.length+" companies have at least one verified category; "+fullyCovered+" have all three.";

  const {error:finishError}=await supabase.from("automation_runs").update({
    status,
    records_written:activity.length,
    message,
    details:{
      orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION,
      companies:companies.length,
      companies_with_any_coverage:anyCovered,
      companies_with_full_coverage:fullyCovered,
      missing_companies:missing,
      coverage,
      providers:healthRows.map((row)=>({provider:row.provider,feed_type:row.feed_type,status:row.status})),
    },
    completed_at:new Date().toISOString(),
  }).eq("id",run.id);
  if(finishError)throw finishError;

  console.log(JSON.stringify({status,message,missing,coverage},null,2));
}catch(error){
  await supabase.from("automation_runs").update({
    status:"failed",
    message:error instanceof Error?error.message:String(error),
    details:{orchestrator_version:CAPITAL_ORCHESTRATOR_VERSION},
    completed_at:new Date().toISOString(),
  }).eq("id",run.id);
  throw error;
}
