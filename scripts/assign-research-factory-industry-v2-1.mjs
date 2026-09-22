import process from "node:process";
import { canonicalSha256 } from "../lib/integrity-hash.mjs";
import {
  AUTONOMOUS_RESEARCH_FACTORY_VERSION,
  AUTONOMOUS_INDUSTRY_POLICY_VERSION,
  assignAutonomousIndustryModule,
  autonomousDecisionHash,
} from "../lib/autonomous-research-factory-v2-1.mjs";
import { buildFactoryStateHash } from "../lib/research-factory-v1.mjs";
import {
  findFactoryRunPg,
  loadIndustryWorkerItemsPg,
  loadScreenResultPg,
  findIndustryAssignmentPg,
  createIndustryAssignmentPg,
  storeAutonomousDecisionPg,
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
  const screen=await loadScreenResultPg(
    item.source_screen_result_id,
    "id,ticker,company_name,sector,industry,screen_profile,score_detail,result_hash"
  );
  if(!screen)throw new Error("Screen result not found for "+item.ticker);

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

  const existing=await findIndustryAssignmentPg(item.id,assignment.decision_hash);
  let assignmentId=existing?.id??null;
  if(!assignmentId){
    const stored=await createIndustryAssignmentPg({
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
    });
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

  if(autonomousRunId){
    await storeAutonomousDecisionPg({
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
    });
  }

  if(
    assignment.status==="applied" &&
    item.status==="quarantined" &&
    item?.state_snapshot?.autonomous_v2_1?.industry_assignment?.status==="quarantined"
  ){
    const priorAutonomous=item.state_snapshot?.autonomous_v2_1??{};
    const snapshot={
      ...(item.state_snapshot??{}),
      autonomous_v2_1:{
        ...priorAutonomous,
        industry_assignment:{
          status:"applied",
          assignment_id:assignmentId,
          confidence:assignment.confidence,
          module:assignment.module,
          reason:assignment.reason,
        },
      },
    };
    await transitionFactoryItemPg({
      itemId:item.id,stage:item.stage,status:"queued",companyId:item.company_id,
      coverageReportId:item.coverage_report_id,baselineDraftId:item.baseline_draft_id,
      compositionId:item.composition_id,coveragePct:item.coverage_pct,
      repairJobCount:item.repair_job_count,manualReviewCount:0,
      nextActions:[{priority:100,type:"autonomous_recheck",action:"Industry assignment now clears policy; rebuild evidence and coverage automatically.",reason:assignment.reason}],
      stateSnapshot:snapshot,stateHash:buildFactoryStateHash(snapshot),lastError:null,
      eventType:"autonomous_industry_released",
    });
  }

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
    await transitionFactoryItemPg({
      itemId:item.id,stage:item.stage,status:"quarantined",companyId:item.company_id,
      coverageReportId:item.coverage_report_id,baselineDraftId:item.baseline_draft_id,
      compositionId:item.composition_id,coveragePct:item.coverage_pct,
      repairJobCount:item.repair_job_count,manualReviewCount:0,
      nextActions:[{priority:100,type:"autonomy_quarantine",action:"Autonomous industry assignment did not clear policy confidence.",reason:assignment.reason}],
      stateSnapshot:snapshot,stateHash:buildFactoryStateHash(snapshot),lastError:null,
      eventType:"autonomous_industry_quarantined",
    });
  }

  summary.push({
    ticker:item.ticker,status:assignment.status,module:assignment.module,
    proposed_module:assignment.proposed_module,confidence_pct:assignment.confidence_pct,
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
  database:"postgres",
},null,2));
