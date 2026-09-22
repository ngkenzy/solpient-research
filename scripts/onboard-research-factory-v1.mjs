import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalSha256 } from "../lib/integrity-hash.mjs";
import {
  RESEARCH_FACTORY_VERSION,
  parseSecTickerExchange,
  resolveSecIdentity,
  deriveResearchFactoryState,
  buildFactoryStateHash,
} from "../lib/research-factory-v1.mjs";

function arg(name,fallback=null){
  const prefix="--"+name+"=";
  const hit=process.argv.find(x=>x.startsWith(prefix));
  return hit?hit.slice(prefix.length):fallback;
}

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const secContact=process.env.SEC_CONTACT??"ngkenzy@users.noreply.github.com";
const secUserAgent=process.env.SEC_USER_AGENT??("SOLPIENT Research "+secContact);
const sourceUrl="https://www.sec.gov/files/company_tickers_exchange.json";
const requestedRunId=arg("factory-run-id",process.env.RESEARCH_FACTORY_RUN_ID??null);

let factoryRun=null;
if(requestedRunId){
  const {data,error}=await sb.from("research_factory_runs")
    .select("*")
    .eq("id",requestedRunId)
    .maybeSingle();
  if(error)throw error;
  factoryRun=data;
}else{
  const {data,error}=await sb.from("research_factory_runs")
    .select("*")
    .eq("factory_version",RESEARCH_FACTORY_VERSION)
    .eq("status","active")
    .order("created_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(error)throw error;
  factoryRun=data;
}
if(!factoryRun)throw new Error("No active Research Factory V1 run is available.");

const {data:items,error:itemError}=await sb.from("research_factory_items")
  .select("*")
  .eq("research_factory_run_id",factoryRun.id)
  .eq("stage","onboarding")
  .order("ordinal",{ascending:true});
if(itemError)throw itemError;

const screenIds=(items??[]).map(x=>x.source_screen_result_id);
const {data:screens,error:screenError}=screenIds.length
  ?await sb.from("universe_screen_results")
    .select("id,ticker,company_name,sector,industry,screen_profile,input_summary,result_hash")
    .in("id",screenIds)
  :{data:[],error:null};
if(screenError)throw screenError;
const screenById=new Map((screens??[]).map(x=>[x.id,x]));

const response=await fetch(sourceUrl,{
  headers:{
    "User-Agent":secUserAgent,
    From:secContact,
    Accept:"application/json",
  },
});
if(!response.ok)throw new Error("SEC ticker/exchange mapping HTTP "+response.status);
const secRows=parseSecTickerExchange(await response.json());

const result={
  factory_run_id:factoryRun.id,
  source_url:sourceUrl,
  existing:0,
  created:0,
  enriched:0,
  ambiguous:0,
  missing:0,
  failures:[],
  resolved:[],
};

for(const item of items??[]){
  const screen=screenById.get(item.source_screen_result_id);
  if(!screen){
    result.failures.push({ticker:item.ticker,error:"source screen result missing"});
    continue;
  }

  const {data:existing,error:existingError}=await sb.from("companies")
    .select("id,ticker,company_name,cik,exchange,sector,industry,description")
    .eq("ticker",item.ticker)
    .maybeSingle();
  if(existingError)throw existingError;

  let company=existing;
  let identity=null;

  if(existing){
    result.existing++;
    if(!existing.cik||!existing.exchange||!existing.sector||!existing.industry){
      identity=resolveSecIdentity({
        ticker:item.ticker,
        companyName:screen.company_name,
      },secRows);
      if(identity.status==="matched"){
        const patch={updated_at:new Date().toISOString()};
        if(!existing.cik)patch.cik=identity.match.cik;
        if(!existing.exchange)patch.exchange=identity.match.exchange;
        if(!existing.sector)patch.sector=screen.sector??null;
        if(!existing.industry)patch.industry=screen.industry??null;
        if(Object.keys(patch).length>1){
          const {data,error}=await sb.from("companies")
            .update(patch)
            .eq("id",existing.id)
            .select("id,ticker,company_name,cik,exchange,sector,industry,description")
            .single();
          if(error)throw error;
          company=data;
          result.enriched++;
        }
      }
    }

    if(!company?.cik&&identity?.status!=="matched"){
      const reason=identity?.status==="ambiguous"
        ?"Existing company has no CIK and the SEC ticker mapping is ambiguous; identity review is required."
        :"Existing company has no CIK and the ticker could not be resolved from the SEC mapping.";
      const snapshot={
        ...(item.state_snapshot??{}),
        factory_version:RESEARCH_FACTORY_VERSION,
        company_id:company?.id??null,
        identity_resolution:{
          status:identity?.status??"missing",
          source_url:sourceUrl,
          candidate_count:identity?.candidates??0,
          options:(identity?.options??[]).map(x=>({
            cik:x.cik,company_name:x.company_name,ticker:x.ticker,exchange:x.exchange,
          })),
        },
      };
      const nextActions=[{
        priority:100,
        type:"identity_review",
        action:reason,
      }];
      const stateHash=buildFactoryStateHash(snapshot);
      if(item.state_hash!==stateHash||item.status!=="blocked"){
        const {error}=await sb.rpc("transition_research_factory_item_v1",{
          p_item_id:item.id,
          p_stage:"onboarding",
          p_status:"blocked",
          p_company_id:company?.id??null,
          p_coverage_report_id:null,
          p_baseline_draft_id:null,
          p_composition_id:null,
          p_coverage_pct:null,
          p_repair_job_count:0,
          p_manual_review_count:1,
          p_next_actions:nextActions,
          p_state_snapshot:snapshot,
          p_state_hash:stateHash,
          p_last_error:reason,
          p_event_type:"identity_resolution_blocked",
        });
        if(error)throw error;
      }
      if(identity?.status==="ambiguous")result.ambiguous++;
      else result.missing++;
      continue;
    }
  }else{
    identity=resolveSecIdentity({
      ticker:item.ticker,
      companyName:screen.company_name,
    },secRows);

    if(identity.status!=="matched"){
      const reason=identity.status==="ambiguous"
        ?"SEC ticker mapping is ambiguous and requires identity review."
        :"Ticker is absent from the SEC ticker/exchange mapping.";
      const snapshot={
        ...(item.state_snapshot??{}),
        factory_version:RESEARCH_FACTORY_VERSION,
        identity_resolution:{
          status:identity.status,
          source_url:sourceUrl,
          candidate_count:identity.candidates??0,
          options:(identity.options??[]).map(x=>({
            cik:x.cik,company_name:x.company_name,ticker:x.ticker,exchange:x.exchange,
          })),
        },
      };
      const nextActions=[{
        priority:100,
        type:"identity_review",
        action:reason,
      }];
      const stateHash=buildFactoryStateHash(snapshot);
      if(item.state_hash===stateHash&&item.status==="blocked"){
        if(identity.status==="ambiguous")result.ambiguous++;
        else result.missing++;
        continue;
      }
      const {error}=await sb.rpc("transition_research_factory_item_v1",{
        p_item_id:item.id,
        p_stage:"onboarding",
        p_status:"blocked",
        p_company_id:null,
        p_coverage_report_id:null,
        p_baseline_draft_id:null,
        p_composition_id:null,
        p_coverage_pct:null,
        p_repair_job_count:0,
        p_manual_review_count:1,
        p_next_actions:nextActions,
        p_state_snapshot:snapshot,
        p_state_hash:stateHash,
        p_last_error:reason,
        p_event_type:"identity_resolution_blocked",
      });
      if(error)throw error;
      if(identity.status==="ambiguous")result.ambiguous++;
      else result.missing++;
      continue;
    }

    const canonical={
      ticker:String(item.ticker).toUpperCase(),
      company_name:identity.match.company_name||screen.company_name||item.ticker,
      cik:identity.match.cik,
      exchange:identity.match.exchange,
      sector:screen.sector??null,
      industry:screen.industry??null,
      updated_at:new Date().toISOString(),
    };
    const {data,error}=await sb.from("companies")
      .insert(canonical)
      .select("id,ticker,company_name,cik,exchange,sector,industry,description")
      .single();
    if(error)throw error;
    company=data;
    result.created++;
  }

  if(!company)continue;

  const derived=deriveResearchFactoryState({
    company,
    sourcePipelineItem:{
      stage:item?.state_snapshot?.source_stage??null,
    },
  });
  const identityPayload={
    status:"matched",
    source_url:sourceUrl,
    source_kind:"SEC company_tickers_exchange.json",
    observed_at:new Date().toISOString(),
    cik:company.cik??identity?.match?.cik??null,
    sec_company_name:identity?.match?.company_name??null,
    exchange:company.exchange??identity?.match?.exchange??null,
    screen_company_name:screen.company_name??null,
  };
  const snapshot={
    ...(item.state_snapshot??{}),
    company_id:company.id,
    company:{
      id:company.id,
      ticker:company.ticker,
      company_name:company.company_name,
      cik:company.cik,
      exchange:company.exchange,
      sector:company.sector,
      industry:company.industry,
    },
    identity_resolution:identityPayload,
    last_refresh_at:new Date().toISOString(),
  };
  const stateHash=buildFactoryStateHash(snapshot);

  const {error:transitionError}=await sb.rpc("transition_research_factory_item_v1",{
    p_item_id:item.id,
    p_stage:derived.stage,
    p_status:derived.status,
    p_company_id:company.id,
    p_coverage_report_id:null,
    p_baseline_draft_id:null,
    p_composition_id:null,
    p_coverage_pct:null,
    p_repair_job_count:0,
    p_manual_review_count:0,
    p_next_actions:derived.next_actions,
    p_state_snapshot:snapshot,
    p_state_hash:stateHash,
    p_last_error:null,
    p_event_type:"identity_resolved",
  });
  if(transitionError)throw transitionError;

  const eventPayload={
    source_url:sourceUrl,
    identity:identityPayload,
    company_id:company.id,
  };
  const {error:eventError}=await sb.from("research_factory_events").insert({
    research_factory_run_id:factoryRun.id,
    research_factory_item_id:item.id,
    ticker:item.ticker,
    event_type:"identity_provenance",
    from_stage:item.stage,
    to_stage:derived.stage,
    payload:eventPayload,
    payload_hash:canonicalSha256(eventPayload),
  });
  if(eventError)throw eventError;

  result.resolved.push({
    ticker:item.ticker,
    company_id:company.id,
    cik:company.cik,
    exchange:company.exchange,
    stage:derived.stage,
  });
}

console.log(JSON.stringify(result,null,2));
