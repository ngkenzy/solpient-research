import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalSha256 } from "../lib/integrity-hash.mjs";
import {
  READINESS_REPAIR_METHODOLOGY_VERSION,
  buildDecisionReadinessRepairPlan,
} from "../lib/decision-readiness-repair-engine.mjs";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const n=(v)=>{
  if(v===null||v===undefined||v==="")return null;
  const x=Number(v);
  return Number.isFinite(x)?x:null;
};

const startedAt=new Date().toISOString();
const {data:automationRun,error:runError}=await sb.from("automation_runs").insert({
  pipeline:"decision_readiness_repair",
  started_at:startedAt,
  status:"running",
  records_written:0,
  message:"Building decision-readiness repair plans.",
  details:{methodology_version:READINESS_REPAIR_METHODOLOGY_VERSION},
}).select("id").single();
if(runError)throw runError;

async function finish(status,records,message,details={}){
  const {error}=await sb.from("automation_runs").update({
    status,records_written:records,message,details,
    completed_at:new Date().toISOString(),
  }).eq("id",automationRun.id);
  if(error)throw error;
}

try{
  const {data:latestRanking,error:latestError}=await sb
    .from("ranking_history")
    .select("ranked_at")
    .eq("methodology_version","decision-ranking-v1")
    .order("ranked_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(latestError)throw latestError;
  if(!latestRanking?.ranked_at)throw new Error("No Phase 3 decision-ranking snapshot is available.");

  const rankedAt=latestRanking.ranked_at;
  const [rankingR,companiesR,coverageR,jobsR,returnsR,researchRunsR]=await Promise.all([
    sb.from("ranking_history")
      .select("id,company_id,research_run_id,ranked_at,rank,decision_score,business_quality_score,business_quality_coverage_pct,investment_opportunity_score,opportunity_coverage_pct,evidence_confidence_score,readiness_state,price,base_fair_value,score_inputs")
      .eq("methodology_version","decision-ranking-v1")
      .eq("ranked_at",rankedAt)
      .order("rank"),
    sb.from("companies").select("id,ticker,company_name"),
    sb.from("data_coverage_reports").select("*")
      .eq("engine_version","coverage-v2")
      .order("as_of_date",{ascending:false})
      .order("generated_at",{ascending:false}),
    sb.from("research_repair_jobs").select("*"),
    sb.from("expected_return_scenarios")
      .select("research_run_id,scenario,horizon_years,expected_cagr,created_at")
      .eq("scenario","base").eq("horizon_years",5)
      .order("created_at",{ascending:false}),
    sb.from("research_runs")
      .select("id,researched_at,status")
      .eq("status","published"),
  ]);
  for(const r of [rankingR,companiesR,coverageR,jobsR,returnsR,researchRunsR])if(r.error)throw r.error;

  const companyById=new Map((companiesR.data??[]).map(row=>[row.id,row]));
  const coverageByCompany=new Map();
  for(const row of coverageR.data??[])if(!coverageByCompany.has(row.company_id))coverageByCompany.set(row.company_id,row);
  const jobsByKey=new Map((jobsR.data??[]).map(row=>[[row.company_id,row.layer,row.field].join("|"),row]));
  const returnByRun=new Map();
  for(const row of returnsR.data??[])if(!returnByRun.has(row.research_run_id))returnByRun.set(row.research_run_id,row);
  const researchRunById=new Map((researchRunsR.data??[]).map(row=>[row.id,row]));

  const plans=[];
  const items=[];
  const jobPriority=new Map();

  for(const ranking of rankingR.data??[]){
    const company=companyById.get(ranking.company_id);
    const coverage=coverageByCompany.get(ranking.company_id)??{};
    const baseReturn=returnByRun.get(ranking.research_run_id);
    const scoreInputs=ranking.score_inputs??{};
    const qualityInputs=scoreInputs.business_quality??{};
    const opportunityInputs=scoreInputs.investment_opportunity??{};

    const input={
      currentState:ranking.readiness_state??"building",
      decisionScore:n(ranking.decision_score),
      evidenceConfidence:n(ranking.evidence_confidence_score),
      businessQualityScore:n(ranking.business_quality_score),
      businessQualityCoverage:n(ranking.business_quality_coverage_pct),
      businessQualityMissing:Array.isArray(qualityInputs.missing)?qualityInputs.missing:[],
      investmentOpportunityScore:n(ranking.investment_opportunity_score),
      opportunityCoverage:n(ranking.opportunity_coverage_pct),
      opportunityMissing:Array.isArray(opportunityInputs.missing)?opportunityInputs.missing:[],
      price:n(ranking.price),
      baseValue:n(ranking.base_fair_value),
      base5yCagr:n(baseReturn?.expected_cagr ?? scoreInputs.raw_inputs?.base5yCagr),
      researchedAt:researchRunById.get(ranking.research_run_id)?.researched_at??null,
      coverage,
      coverageDetails:coverage.coverage_details??{},
    };

    const plan=buildDecisionReadinessRepairPlan(input);
    const planHash=canonicalSha256({
      methodology_version:plan.methodologyVersion,
      company_id:ranking.company_id,
      research_run_id:ranking.research_run_id,
      ranking_history_id:ranking.id,
      current_state:plan.currentState,
      next_state:plan.nextState,
      company_priority:plan.companyPriority,
      research_ready_plan:plan.researchReadyPlan,
      decision_ready_plan:plan.decisionReadyPlan,
    });

    plans.push({
      company_id:ranking.company_id,
      research_run_id:ranking.research_run_id,
      ranking_history_id:ranking.id,
      methodology_version:plan.methodologyVersion,
      ranking_ranked_at:rankedAt,
      current_state:plan.currentState,
      next_state:plan.nextState,
      decision_score:plan.decisionScore,
      evidence_confidence:plan.currentEvidenceConfidence,
      company_priority:plan.companyPriority,
      research_ready_reachable:plan.researchReadyPlan.reachable,
      decision_ready_reachable:plan.decisionReadyPlan.reachable,
      research_ready_plan:plan.researchReadyPlan,
      decision_ready_plan:plan.decisionReadyPlan,
      plan_hash:planHash,
      generated_at:startedAt,
      updated_at:startedAt,
    });

    for(const item of plan.items){
      const exactKey=[ranking.company_id,item.layer,item.field].join("|");
      const linked=jobsByKey.get(exactKey)??null;
      items.push({
        company_id:ranking.company_id,
        repair_key:item.key,
        layer:item.layer,
        field:item.field,
        repair_type:item.repairType,
        automation_mode:item.automationMode,
        runner:item.runner,
        target_state:item.scope==="next"?plan.nextState:"decision_ready",
        current_value:item.currentValue==null?null:item.currentValue,
        target_value:item.targetValue==null?null:item.targetValue,
        direct_gate:Boolean(item.directGate),
        phase2_sensitive:Boolean(item.phase2Sensitive),
        priority:item.priority,
        sequence_to_next:item.sequenceToNext,
        sequence_to_decision:item.sequenceToDecision,
        estimated_evidence_gain:item.estimatedEvidenceGain,
        projected_evidence_confidence:item.projectedEvidenceConfidence,
        projected_readiness_state:item.projectedReadinessState,
        instruction:item.instruction,
        linked_repair_job_id:linked?.id??null,
        details:{
          ticker:company?.ticker??null,
          company_name:company?.company_name??null,
          company_priority:plan.companyPriority,
          current_state:plan.currentState,
          next_state:plan.nextState,
          ranking_rank:ranking.rank,
          phase2_execution_deferred:Boolean(item.phase2Sensitive),
        },
        generated_at:startedAt,
        updated_at:startedAt,
      });

      if(linked && linked.status!=="completed" && !item.phase2Sensitive){
        const prior=jobPriority.get(linked.id);
        if(!prior||item.priority>prior.priority)jobPriority.set(linked.id,{priority:item.priority,item,plan,company});
      }
    }
  }

  const companyIds=(rankingR.data??[]).map(row=>row.company_id);
  if(companyIds.length){
    const {error:staleItemError}=await sb.from("decision_readiness_repair_items").delete().in("company_id",companyIds);
    if(staleItemError)throw staleItemError;
  }

  if(plans.length){
    const {error}=await sb.from("decision_readiness_repair_plans").upsert(plans,{onConflict:"company_id"});
    if(error)throw error;
  }
  for(let i=0;i<items.length;i+=100){
    const {error}=await sb.from("decision_readiness_repair_items").insert(items.slice(i,i+100));
    if(error)throw error;
  }

  let reprioritized=0;
  for(const [jobId,value] of jobPriority){
    const existing=jobsR.data?.find(row=>row.id===jobId);
    const details={
      ...(existing?.details??{}),
      decision_readiness_repair:{
        methodology_version:READINESS_REPAIR_METHODOLOGY_VERSION,
        company_priority:value.plan.companyPriority,
        item_priority:value.priority,
        current_state:value.plan.currentState,
        next_state:value.plan.nextState,
        sequence_to_next:value.item.sequenceToNext,
        sequence_to_decision:value.item.sequenceToDecision,
        estimated_evidence_gain:value.item.estimatedEvidenceGain,
        instruction:value.item.instruction,
        updated_at:startedAt,
      },
    };
    const {error}=await sb.from("research_repair_jobs").update({
      priority:value.priority,
      details,
      updated_at:startedAt,
    }).eq("id",jobId);
    if(error)throw error;
    reprioritized+=1;
  }

  const summary={
    methodology_version:READINESS_REPAIR_METHODOLOGY_VERSION,
    ranking_ranked_at:rankedAt,
    companies:plans.length,
    items:items.length,
    reprioritized_jobs:reprioritized,
    building:plans.filter(p=>p.current_state==="building").length,
    research_ready:plans.filter(p=>p.current_state==="research_ready").length,
    decision_ready:plans.filter(p=>p.current_state==="decision_ready").length,
    top_companies:plans
      .filter(p=>p.current_state!=="decision_ready")
      .sort((a,b)=>b.company_priority-a.company_priority)
      .slice(0,10)
      .map(p=>({
        ticker:companyById.get(p.company_id)?.ticker,
        priority:p.company_priority,
        current_state:p.current_state,
        next_state:p.next_state,
        repairs_to_next:p.current_state==="building"?p.research_ready_plan.repairCount:p.decision_ready_plan.repairCount,
        repairs_to_decision:p.decision_ready_plan.repairCount,
      })),
  };

  await finish("success",plans.length+items.length,"Decision-readiness repair plans refreshed.",summary);
  console.log(JSON.stringify(summary,null,2));
}catch(error){
  await finish("failed",0,error instanceof Error?error.message:String(error),{
    methodology_version:READINESS_REPAIR_METHODOLOGY_VERSION,
  });
  throw error;
}
