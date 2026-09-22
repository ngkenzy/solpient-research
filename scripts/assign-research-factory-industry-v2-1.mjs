import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalSha256 } from "../lib/integrity-hash.mjs";
import {
  AUTONOMOUS_RESEARCH_FACTORY_VERSION,
  AUTONOMOUS_INDUSTRY_POLICY_VERSION,
  assignAutonomousIndustryModule,
  autonomousDecisionHash,
} from "../lib/autonomous-research-factory-v2-1.mjs";
import { buildFactoryStateHash } from "../lib/research-factory-v1.mjs";

function arg(name,fallback=null){
  const prefix="--"+name+"=";
  const hit=process.argv.find(x=>x.startsWith(prefix));
  return hit?hit.slice(prefix.length):fallback;
}

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const tickerArg=arg("ticker",process.env.RESEARCH_FACTORY_TICKER??null);
const factoryRunId=arg("factory-run-id",process.env.RESEARCH_FACTORY_RUN_ID??null);
const autonomousRunId=arg("autonomous-run-id",process.env.AUTONOMOUS_FACTORY_RUN_ID??null);

let run=null;
if(factoryRunId){
  const {data,error}=await sb.from("research_factory_runs").select("*").eq("id",factoryRunId).maybeSingle();
  if(error)throw error;
  run=data;
}else{
  const {data,error}=await sb.from("research_factory_runs")
    .select("*")
    .eq("factory_version","research-factory-v1")
    .order("created_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(error)throw error;
  run=data;
}
if(!run)throw new Error("Research Factory run not found.");

let query=sb.from("research_factory_items")
  .select("*")
  .eq("research_factory_run_id",run.id)
  .not("company_id","is",null)
  .order("ordinal",{ascending:true});
if(tickerArg)query=query.eq("ticker",String(tickerArg).toUpperCase());
const {data:items,error:itemError}=await query;
if(itemError)throw itemError;

const summary=[];

for(const item of items??[]){
  const {data:screen,error:screenError}=await sb.from("universe_screen_results")
    .select("id,ticker,company_name,sector,industry,screen_profile,score_detail,result_hash")
    .eq("id",item.source_screen_result_id)
    .single();
  if(screenError)throw screenError;

  const sectorClassification=screen?.score_detail?.sector_classification??{};
  const assignment=assignAutonomousIndustryModule({
    ticker:item.ticker,
    screenProfile:screen.screen_profile,
    sector:screen.sector,
    industry:screen.industry,
    sectorClassification,
  });
  const inputHash=canonicalSha256({
    contract:"autonomous-industry-assignment-input-v2.1",
    screen_result_id:screen.id,
    screen_result_hash:screen.result_hash,
    ticker:screen.ticker,
    sector:screen.sector,
    industry:screen.industry,
    screen_profile:screen.screen_profile,
    sector_classification:sectorClassification,
  });

  const {data:existing,error:existingError}=await sb
    .from("research_factory_industry_assignments")
    .select("id")
    .eq("research_factory_item_id",item.id)
    .eq("decision_hash",assignment.decision_hash)
    .maybeSingle();
  if(existingError)throw existingError;

  let assignmentId=existing?.id??null;
  if(!assignmentId){
    const {data:stored,error:storeError}=await sb.from("research_factory_industry_assignments")
      .insert({
        research_factory_item_id:item.id,
        company_id:item.company_id,
        source_screen_result_id:item.source_screen_result_id,
        ticker:item.ticker,
        policy_version:AUTONOMOUS_INDUSTRY_POLICY_VERSION,
        module:assignment.module,
        proposed_module:assignment.proposed_module,
        status:assignment.status,
        confidence:assignment.confidence,
        method:assignment.method,
        reason:assignment.reason,
        evidence:assignment.evidence,
        decision_hash:assignment.decision_hash,
      })
      .select("id")
      .single();
    if(storeError)throw storeError;
    assignmentId=stored.id;
  }

  const decisionPayload={
    assignment_id:assignmentId,
    module:assignment.module,
    proposed_module:assignment.proposed_module,
    method:assignment.method,
    reason:assignment.reason,
  };
  const decisionHash=autonomousDecisionHash({
    decision_type:"industry_assignment",
    policy_version:AUTONOMOUS_INDUSTRY_POLICY_VERSION,
    assignment_decision_hash:assignment.decision_hash,
    output:decisionPayload,
  });

  const {error:decisionError}=await sb.from("research_factory_autonomous_decisions")
    .upsert({
      autonomous_run_id:autonomousRunId,
      research_factory_item_id:item.id,
      ticker:item.ticker,
      decision_type:"industry_assignment",
      decision_status:assignment.status==="applied"?"applied":"quarantined",
      policy_version:AUTONOMOUS_INDUSTRY_POLICY_VERSION,
      confidence:assignment.confidence,
      input_hash:inputHash,
      decision_hash:decisionHash,
      output:decisionPayload,
      evidence:assignment.evidence,
    },{
      onConflict:"research_factory_item_id,decision_type,decision_hash",
      ignoreDuplicates:true,
    });
  if(decisionError)throw decisionError;

  if(assignment.status==="quarantined"){
    const snapshot={
      ...(item.state_snapshot??{}),
      autonomous_v2_1:{
        industry_assignment:{
          status:"quarantined",
          assignment_id:assignmentId,
          confidence:assignment.confidence,
          proposed_module:assignment.proposed_module,
          reason:assignment.reason,
        },
      },
    };
    const {error:transitionError}=await sb.rpc("transition_research_factory_item_v1",{
      p_item_id:item.id,
      p_stage:item.stage,
      p_status:"quarantined",
      p_company_id:item.company_id,
      p_coverage_report_id:item.coverage_report_id,
      p_baseline_draft_id:item.baseline_draft_id,
      p_composition_id:item.composition_id,
      p_coverage_pct:item.coverage_pct,
      p_repair_job_count:item.repair_job_count,
      p_manual_review_count:0,
      p_next_actions:[{
        priority:100,
        type:"autonomy_quarantine",
        action:"Autonomous industry assignment did not clear policy confidence.",
        reason:assignment.reason,
      }],
      p_state_snapshot:snapshot,
      p_state_hash:buildFactoryStateHash(snapshot),
      p_last_error:null,
      p_event_type:"autonomous_industry_quarantined",
    });
    if(transitionError)throw transitionError;
  }

  summary.push({
    ticker:item.ticker,
    status:assignment.status,
    module:assignment.module,
    proposed_module:assignment.proposed_module,
    confidence_pct:assignment.confidence_pct,
    assignment_id:assignmentId,
  });
}

console.log(JSON.stringify({
  automation_version:AUTONOMOUS_RESEARCH_FACTORY_VERSION,
  policy_version:AUTONOMOUS_INDUSTRY_POLICY_VERSION,
  factory_run_id:run.id,
  processed:summary.length,
  applied:summary.filter(x=>x.status==="applied").length,
  quarantined:summary.filter(x=>x.status==="quarantined").length,
  summary,
},null,2));
