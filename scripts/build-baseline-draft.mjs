import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { buildBaselineDraft, BASELINE_FACTORY_VERSION } from "../lib/baseline-factory.mjs";
import { latestAutonomousIndustryModule } from "../lib/autonomous-research-factory-db.mjs";
import {
  loadCompanyFactoryInputsByTickerPg,
  upsertBaselineDraftPg,
} from "../lib/factory-storage-pg.mjs";
import { postgresConfigured } from "../lib/postgres-node.mjs";

const ticker=String(process.argv[2]??process.env.BASELINE_TICKER??"").trim().toUpperCase();
const outputFlag=process.argv.indexOf("--output");
const outputPath=outputFlag>=0?process.argv[outputFlag+1]:null;

if(!ticker){
  console.error("Usage: node scripts/build-baseline-draft.mjs <TICKER> [--output path.json]");
  process.exit(1);
}
if(!postgresConfigured())throw new Error("Missing SOLPIENT_DATABASE_URL.");

const {company,market,fundamentals,filings,context}=await loadCompanyFactoryInputsByTickerPg(ticker,{
  fundamentalLimit:20,
  filingLimit:25,
});
if(!company)throw new Error("Tracked company not found: "+ticker);

const autonomousIndustryModule=await latestAutonomousIndustryModule(null,{companyId:company.id});
const result=buildBaselineDraft({
  company,
  market,
  fundamentals,
  filings,
  industryModuleOverride:autonomousIndustryModule,
});

if(context){
  const contextKnownAt=context.knowledge_cutoff_at??context.generated_at;
  if(contextKnownAt){
    const currentCutoff=new Date(result.sourceCutoffAt).getTime();
    const contextCutoff=new Date(contextKnownAt).getTime();
    if(Number.isFinite(contextCutoff)&&(!Number.isFinite(currentCutoff)||contextCutoff>currentCutoff)){
      result.sourceCutoffAt=new Date(contextCutoff).toISOString();
      result.payload.research.data_cutoff_at=result.sourceCutoffAt;
    }
  }
  result.payload.factory.research_context={
    context_pack_id:context.id,
    context_version:context.context_version,
    as_of_date:context.as_of_date,
    history_coverage:context.history_coverage,
    trends:context.trends,
    latest_metrics:context.latest_metrics,
    peer_set:context.peer_set,
    peer_comparison:context.peer_comparison,
    capital_allocation:context.capital_allocation,
    limitations:context.limitations,
    summary:context.summary,
  };
  result.payload.factory.review_queue.unshift(
    "Review the historical/peer context pack before qualitative scoring or valuation."
  );
}

const stored=await upsertBaselineDraftPg({
  company_id:company.id,
  generation_version:BASELINE_FACTORY_VERSION,
  generated_at:result.payload.factory.generated_at,
  source_cutoff_at:result.sourceCutoffAt,
  industry_module:result.industryModule,
  status:"generated",
  evidence_completeness_pct:result.evidenceCompletenessPct,
  standard_valid:result.validation.valid,
  standard_status:result.validation.status,
  validation_result:result.validation,
  evidence_summary:{
    ...result.evidenceSummary,
    context_pack_id:context?.id??null,
    context_version:context?.context_version??null,
  },
  draft_payload:result.payload,
  updated_at:new Date().toISOString(),
});

if(outputPath){
  const absolute=path.resolve(outputPath);
  await fs.mkdir(path.dirname(absolute),{recursive:true});
  await fs.writeFile(absolute,JSON.stringify(result.payload,null,2)+"\n","utf8");
  console.log("Wrote draft artifact:",absolute);
}

console.log(JSON.stringify({
  ticker,
  draft_id:stored.id,
  industry_module:result.industryModule,
  evidence_completeness_pct:result.evidenceCompletenessPct,
  standard_valid:result.validation.valid,
  standard_status:result.validation.status,
  evidence_gaps:result.payload.factory.evidence_gaps.length,
  auto_publish:false,
  database:"postgres",
},null,2));
