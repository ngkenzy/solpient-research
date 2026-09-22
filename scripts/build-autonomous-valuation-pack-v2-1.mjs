import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalSha256 } from "../lib/integrity-hash.mjs";
import {
  AUTONOMOUS_RESEARCH_FACTORY_VERSION,
  AUTONOMOUS_VALUATION_POLICY_VERSION,
  buildAutonomousValuationPolicy,
} from "../lib/autonomous-research-factory-v2-1.mjs";
import { buildFactoryStateHash } from "../lib/research-factory-v1.mjs";
import { latestAutonomousIndustryAssignment } from "../lib/autonomous-research-factory-db.mjs";

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
  const assignment=await latestAutonomousIndustryAssignment(
    sb,
    {researchFactoryItemId:item.id}
  );
  if(!assignment){
    summary.push({ticker:item.ticker,status:"skipped",reason:"no_applied_industry_assignment"});
    continue;
  }

  const [
    screenR,
    baselineR,
    fundamentalsR,
    marketR,
    consensusR,
    historyR,
    contextR,
    coverageR,
  ]=await Promise.all([
    sb.from("universe_screen_results").select("*").eq("id",item.source_screen_result_id).single(),
    sb.from("baseline_drafts").select("*").eq("company_id",item.company_id)
      .order("generated_at",{ascending:false}).limit(1).maybeSingle(),
    sb.from("fundamental_snapshots").select("*").eq("company_id",item.company_id)
      .order("period_end",{ascending:false}).limit(160),
    sb.from("market_snapshots").select("trading_date,price,market_cap,provider,source_url,observed_at")
      .eq("company_id",item.company_id)
      .order("trading_date",{ascending:false})
      .limit(1).maybeSingle(),
    sb.from("consensus_snapshots").select("*").eq("company_id",item.company_id)
      .order("observed_at",{ascending:false}).limit(1).maybeSingle(),
    sb.from("valuation_history")
      .select("trading_date,pe,forward_pe,ev_to_ebitda,price_to_fcf,fcf_yield,provider,source_url,observed_at")
      .eq("company_id",item.company_id)
      .order("trading_date",{ascending:false})
      .limit(3200),
    sb.from("research_context_packs").select("*").eq("company_id",item.company_id)
      .order("as_of_date",{ascending:false}).order("generated_at",{ascending:false})
      .limit(1).maybeSingle(),
    sb.from("data_coverage_reports").select("*").eq("company_id",item.company_id)
      .eq("engine_version","coverage-v2")
      .order("as_of_date",{ascending:false}).order("generated_at",{ascending:false})
      .limit(1).maybeSingle(),
  ]);
  for(const r of [screenR,baselineR,fundamentalsR,marketR,consensusR,historyR,contextR,coverageR]){
    if(r.error)throw r.error;
  }

  const policy=buildAutonomousValuationPolicy({
    screenResult:screenR.data,
    industryAssignment:assignment,
    baselineDraft:baselineR.data??null,
    fundamentals:fundamentalsR.data??[],
    market:marketR.data??null,
    consensus:consensusR.data??null,
    valuationHistory:historyR.data??[],
    contextPack:contextR.data??null,
    coverage:coverageR.data??null,
  });
  const valuationInputHash=canonicalSha256({
    contract:"autonomous-valuation-input-v2.1",
    valuation_input:policy.valuation_input,
  });
  const decisionStatus=policy.status==="auto_approved"?"applied":"quarantined";

  const {error:decisionError}=await sb.from("research_factory_autonomous_decisions")
    .upsert({
      autonomous_run_id:autonomousRunId,
      research_factory_item_id:item.id,
      ticker:item.ticker,
      decision_type:"valuation_assumptions",
      decision_status:decisionStatus,
      policy_version:AUTONOMOUS_VALUATION_POLICY_VERSION,
      confidence:policy.confidence,
      input_hash:valuationInputHash,
      decision_hash:policy.decision_hash,
      output:{
        status:policy.status,
        valuation_input:policy.valuation_input,
        preflight:policy.preflight,
        critical_issues:policy.critical_issues,
      },
      evidence:policy.evidence,
    },{
      onConflict:"research_factory_item_id,decision_type,decision_hash",
      ignoreDuplicates:true,
    });
  if(decisionError)throw decisionError;

  const {data:existingDraft,error:existingDraftError}=await sb
    .from("research_factory_valuation_drafts")
    .select("id")
    .eq("research_factory_item_id",item.id)
    .eq("input_hash",valuationInputHash)
    .maybeSingle();
  if(existingDraftError)throw existingDraftError;

  let valuationDraftId=existingDraft?.id??null;
  if(!valuationDraftId){
    const {data:storedDraft,error:storedDraftError}=await sb
      .from("research_factory_valuation_drafts")
      .insert({
        research_factory_item_id:item.id,
        company_id:item.company_id,
        source_screen_result_id:item.source_screen_result_id,
        ticker:item.ticker,
        factory_version:AUTONOMOUS_RESEARCH_FACTORY_VERSION,
        industry_module:assignment.module,
        status:"draft",
        valuation_input:policy.valuation_input,
        preflight:policy.preflight??{},
        missing_fields:policy.preflight?.missing??[],
        evidence:{
          autonomous_policy_version:AUTONOMOUS_VALUATION_POLICY_VERSION,
          confidence_pct:policy.confidence_pct,
          critical_issues:policy.critical_issues,
          ...policy.evidence,
        },
        input_hash:valuationInputHash,
      })
      .select("id")
      .single();
    if(storedDraftError)throw storedDraftError;
    valuationDraftId=storedDraft.id;
  }

  if(policy.status==="auto_approved"){
    const {data:packId,error:packError}=await sb.rpc(
      "publish_autonomous_valuation_pack_v2_1",
      {
        p_research_factory_item_id:item.id,
        p_decision_hash:policy.decision_hash,
        p_industry_module:assignment.module,
        p_valuation_input:policy.valuation_input,
        p_input_hash:valuationInputHash,
        p_confidence:policy.confidence,
        p_policy_version:AUTONOMOUS_VALUATION_POLICY_VERSION,
      }
    );
    if(packError)throw packError;

    if(
      item.status==="quarantined"&&
      item?.state_snapshot?.autonomous_v2_1?.valuation?.status==="quarantined"
    ){
      const snapshot={
        ...(item.state_snapshot??{}),
        autonomous_v2_1:{
          ...(item.state_snapshot?.autonomous_v2_1??{}),
          valuation:{
            status:"auto_approved",
            policy_version:AUTONOMOUS_VALUATION_POLICY_VERSION,
            confidence_pct:policy.confidence_pct,
            valuation_draft_id:valuationDraftId,
            candidate_valuation_input_pack_id:packId,
          },
        },
      };
      const {error:releaseError}=await sb.rpc("transition_research_factory_item_v1",{
        p_item_id:item.id,
        p_stage:item.stage,
        p_status:"queued",
        p_company_id:item.company_id,
        p_coverage_report_id:item.coverage_report_id,
        p_baseline_draft_id:item.baseline_draft_id,
        p_composition_id:item.composition_id,
        p_coverage_pct:item.coverage_pct,
        p_repair_job_count:item.repair_job_count,
        p_manual_review_count:0,
        p_next_actions:[{
          priority:100,
          type:"autonomous_recheck",
          action:"Autonomous valuation now clears policy; refresh the factory state.",
          reason:policy.reason,
        }],
        p_state_snapshot:snapshot,
        p_state_hash:buildFactoryStateHash(snapshot),
        p_last_error:null,
        p_event_type:"autonomous_valuation_released",
      });
      if(releaseError)throw releaseError;
    }

    summary.push({
      ticker:item.ticker,
      status:"auto_approved",
      confidence_pct:policy.confidence_pct,
      valuation_draft_id:valuationDraftId,
      candidate_valuation_input_pack_id:packId,
      industry_module:assignment.module,
    });
    continue;
  }

  const snapshot={
    ...(item.state_snapshot??{}),
    autonomous_v2_1:{
      ...(item.state_snapshot?.autonomous_v2_1??{}),
      valuation:{
        status:"quarantined",
        policy_version:AUTONOMOUS_VALUATION_POLICY_VERSION,
        confidence_pct:policy.confidence_pct,
        critical_issues:policy.critical_issues,
        valuation_draft_id:valuationDraftId,
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
      action:"Autonomous valuation policy did not clear the evidence threshold.",
      reason:policy.reason,
      critical_issues:policy.critical_issues,
    }],
    p_state_snapshot:snapshot,
    p_state_hash:buildFactoryStateHash(snapshot),
    p_last_error:null,
    p_event_type:"autonomous_valuation_quarantined",
  });
  if(transitionError)throw transitionError;

  summary.push({
    ticker:item.ticker,
    status:"quarantined",
    confidence_pct:policy.confidence_pct,
    critical_issues:policy.critical_issues,
    valuation_draft_id:valuationDraftId,
    industry_module:assignment.module,
  });
}

console.log(JSON.stringify({
  automation_version:AUTONOMOUS_RESEARCH_FACTORY_VERSION,
  policy_version:AUTONOMOUS_VALUATION_POLICY_VERSION,
  factory_run_id:run.id,
  processed:summary.length,
  auto_approved:summary.filter(x=>x.status==="auto_approved").length,
  quarantined:summary.filter(x=>x.status==="quarantined").length,
  skipped:summary.filter(x=>x.status==="skipped").length,
  summary,
},null,2));
