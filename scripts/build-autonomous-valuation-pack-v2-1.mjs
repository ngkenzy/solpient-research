import process from "node:process";
import { canonicalSha256 } from "../lib/integrity-hash.mjs";
import {
  AUTONOMOUS_RESEARCH_FACTORY_VERSION,
  AUTONOMOUS_VALUATION_POLICY_VERSION,
  buildAutonomousValuationPolicy,
} from "../lib/autonomous-research-factory-v2-1.mjs";
import { buildFactoryStateHash } from "../lib/research-factory-v1.mjs";
import { latestAutonomousIndustryAssignment } from "../lib/autonomous-research-factory-db.mjs";
import {
  findFactoryRunPg,
  loadIndustryWorkerItemsPg,
  loadValuationPolicyInputsPg,
  storeAutonomousDecisionPg,
  findValuationDraftPg,
  createValuationDraftPg,
  publishAutonomousValuationPackPg,
  transitionFactoryItemPg,
} from "../lib/factory-worker-pg.mjs";
import { postgresConfigured } from "../lib/postgres-node.mjs";

function arg(name,fallback=null){
  const prefix="--"+name+"=";
  const hit=process.argv.find(x=>x.startsWith(prefix));
  return hit?hit.slice(prefix.length):fallback;
}
if(!postgresConfigured())throw new Error("Missing SOLPIENT_DATABASE_URL.");

const tickerArg=arg("ticker",process.env.RESEARCH_FACTORY_TICKER??null);
const factoryRunId=arg("factory-run-id",process.env.RESEARCH_FACTORY_RUN_ID??null);
const autonomousRunId=arg("autonomous-run-id",process.env.AUTONOMOUS_FACTORY_RUN_ID??null);

const run=await findFactoryRunPg(factoryRunId);
if(!run)throw new Error("Research Factory run not found.");
const items=await loadIndustryWorkerItemsPg(run.id,tickerArg);
const summary=[];

for(const item of items){
  const assignment=await latestAutonomousIndustryAssignment(null,{researchFactoryItemId:item.id});
  if(!assignment){
    summary.push({ticker:item.ticker,status:"skipped",reason:"no_applied_industry_assignment"});
    continue;
  }

  const input=await loadValuationPolicyInputsPg(item);
  const policy=buildAutonomousValuationPolicy({
    screenResult:input.screenResult,
    industryAssignment:assignment,
    baselineDraft:input.baselineDraft,
    fundamentals:input.fundamentals,
    market:input.market,
    consensus:input.consensus,
    valuationHistory:input.valuationHistory,
    contextPack:input.contextPack,
    coverage:input.coverage,
  });
  const valuationInputHash=canonicalSha256({
    contract:"autonomous-valuation-input-v2.1",
    valuation_input:policy.valuation_input,
  });
  const decisionStatus=policy.status==="auto_approved"?"applied":"quarantined";

  if(autonomousRunId){
    await storeAutonomousDecisionPg({
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
    });
  }

  const existingDraft=await findValuationDraftPg(item.id,valuationInputHash);
  let valuationDraftId=existingDraft?.id??null;
  if(!valuationDraftId){
    const stored=await createValuationDraftPg({
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
    });
    valuationDraftId=stored.id;
  }

  if(policy.status==="auto_approved"){
    const packId=await publishAutonomousValuationPackPg({
      itemId:item.id,
      decisionHash:policy.decision_hash,
      industryModule:assignment.module,
      valuationInput:policy.valuation_input,
      inputHash:valuationInputHash,
      confidence:policy.confidence,
      policyVersion:AUTONOMOUS_VALUATION_POLICY_VERSION,
    });

    if(item.status==="quarantined"&&item?.state_snapshot?.autonomous_v2_1?.valuation?.status==="quarantined"){
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
      await transitionFactoryItemPg({
        itemId:item.id,stage:item.stage,status:"queued",companyId:item.company_id,
        coverageReportId:item.coverage_report_id,baselineDraftId:item.baseline_draft_id,
        compositionId:item.composition_id,coveragePct:item.coverage_pct,
        repairJobCount:item.repair_job_count,manualReviewCount:0,
        nextActions:[{priority:100,type:"autonomous_recheck",action:"Autonomous valuation now clears policy; refresh the factory state.",reason:policy.reason}],
        stateSnapshot:snapshot,stateHash:buildFactoryStateHash(snapshot),lastError:null,
        eventType:"autonomous_valuation_released",
      });
    }

    summary.push({
      ticker:item.ticker,status:"auto_approved",confidence_pct:policy.confidence_pct,
      valuation_draft_id:valuationDraftId,candidate_valuation_input_pack_id:packId,
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
  await transitionFactoryItemPg({
    itemId:item.id,stage:item.stage,status:"quarantined",companyId:item.company_id,
    coverageReportId:item.coverage_report_id,baselineDraftId:item.baseline_draft_id,
    compositionId:item.composition_id,coveragePct:item.coverage_pct,
    repairJobCount:item.repair_job_count,manualReviewCount:0,
    nextActions:[{priority:100,type:"autonomy_quarantine",action:"Autonomous valuation policy did not clear the evidence threshold.",reason:policy.reason,critical_issues:policy.critical_issues}],
    stateSnapshot:snapshot,stateHash:buildFactoryStateHash(snapshot),lastError:null,
    eventType:"autonomous_valuation_quarantined",
  });

  summary.push({
    ticker:item.ticker,status:"quarantined",confidence_pct:policy.confidence_pct,
    critical_issues:policy.critical_issues,valuation_draft_id:valuationDraftId,
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
  database:"postgres",
},null,2));
