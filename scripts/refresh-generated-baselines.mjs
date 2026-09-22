import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { buildBaselineDraft } from "../lib/baseline-factory.mjs";
import { latestAutonomousIndustryModule } from "../lib/autonomous-research-factory-db.mjs";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const outputFlag=process.argv.indexOf("--output");
const outputPath=outputFlag>=0?process.argv[outputFlag+1]:null;

const [companiesR,draftsR,reviewsR]=await Promise.all([
  sb.from("companies").select("id,ticker,company_name,cik,exchange,sector,industry,description").order("ticker"),
  sb.from("baseline_drafts").select("id,company_id,status,published_run_id,generated_at").order("generated_at",{ascending:false}),
  sb.from("baseline_reviews").select("draft_id,status,reviewed_at"),
]);
for(const r of [companiesR,draftsR,reviewsR])if(r.error)throw r.error;

const reviewedDraftIds=new Set((reviewsR.data??[]).map(r=>r.draft_id));
const latestDraftByCompany=new Map();
for(const draft of draftsR.data??[])if(!latestDraftByCompany.has(draft.company_id))latestDraftByCompany.set(draft.company_id,draft);

const refreshed=[],skipped=[];

for(const company of companiesR.data??[]){
  const draft=latestDraftByCompany.get(company.id);
  if(!draft){skipped.push({ticker:company.ticker,reason:"no_private_draft"});continue;}
  if(draft.published_run_id){skipped.push({ticker:company.ticker,reason:"already_promoted"});continue;}
  if(reviewedDraftIds.has(draft.id)){skipped.push({ticker:company.ticker,reason:"human_review_exists"});continue;}

  const [marketR,fundR,filingR,contextR,coverageR]=await Promise.all([
    sb.from("market_snapshots").select("*").eq("company_id",company.id).order("trading_date",{ascending:false}).limit(1).maybeSingle(),
    sb.from("fundamental_snapshots").select("*").eq("company_id",company.id).order("period_end",{ascending:false}).limit(160),
    sb.from("filing_events").select("id,provider,form_type,filed_at,accepted_at,accession_number,filing_url,period_end,title").eq("company_id",company.id).order("filed_at",{ascending:false}).limit(50),
    sb.from("research_context_packs").select("*").eq("company_id",company.id).order("as_of_date",{ascending:false}).limit(1).maybeSingle(),
    sb.from("data_coverage_reports").select("*").eq("company_id",company.id).order("as_of_date",{ascending:false}).limit(1).maybeSingle(),
  ]);
  for(const r of [marketR,fundR,filingR,contextR,coverageR])if(r.error)throw r.error;

  const autonomousIndustryModule=await latestAutonomousIndustryModule(
    sb,
    {companyId:company.id}
  );
  const result=buildBaselineDraft({
    company,market:marketR.data,fundamentals:fundR.data??[],filings:filingR.data??[],
    industryModuleOverride:autonomousIndustryModule
  });

  if(contextR.data){
    const contextKnownAt=contextR.data.knowledge_cutoff_at??contextR.data.generated_at;
    if(contextKnownAt){
      const currentCutoff=new Date(result.sourceCutoffAt).getTime();
      const contextCutoff=new Date(contextKnownAt).getTime();
      if(Number.isFinite(contextCutoff)&&(!Number.isFinite(currentCutoff)||contextCutoff>currentCutoff)){
        result.sourceCutoffAt=new Date(contextCutoff).toISOString();
        result.payload.research.data_cutoff_at=result.sourceCutoffAt;
      }
    }
    result.payload.factory.research_context={
      context_pack_id:contextR.data.id,context_version:contextR.data.context_version,
      as_of_date:contextR.data.as_of_date,history_coverage:contextR.data.history_coverage,
      trends:contextR.data.trends,latest_metrics:contextR.data.latest_metrics,
      peer_set:contextR.data.peer_set,peer_comparison:contextR.data.peer_comparison,
      capital_allocation:contextR.data.capital_allocation,limitations:contextR.data.limitations,
      summary:contextR.data.summary
    };
  }
  if(coverageR.data){
    result.payload.factory.data_coverage={
      engine_version:coverageR.data.engine_version,as_of_date:coverageR.data.as_of_date,
      status:coverageR.data.status,overall_pct:coverageR.data.overall_pct,
      fundamentals_pct:coverageR.data.fundamentals_pct,balance_sheet_pct:coverageR.data.balance_sheet_pct,
      history_pct:coverageR.data.history_pct,market_history_pct:coverageR.data.market_history_pct,
      industry_pct:coverageR.data.industry_pct,peer_pct:coverageR.data.peer_pct,
      missing_fields:coverageR.data.missing_fields,limitations:coverageR.data.limitations
    };
  }

  const now=new Date().toISOString();
  const {error}=await sb.from("baseline_drafts").update({
    generated_at:now,source_cutoff_at:result.sourceCutoffAt,industry_module:result.industryModule,
    status:"generated",evidence_completeness_pct:result.evidenceCompletenessPct,
    standard_valid:result.validation.valid,standard_status:result.validation.status,
    validation_result:result.validation,
    evidence_summary:{
      ...result.evidenceSummary,
      context_pack_id:contextR.data?.id??null,context_version:contextR.data?.context_version??null,
      coverage_engine_version:coverageR.data?.engine_version??null,coverage_overall_pct:coverageR.data?.overall_pct??null
    },
    draft_payload:result.payload,updated_at:now
  }).eq("id",draft.id);
  if(error)throw error;

  refreshed.push({
    ticker:company.ticker,draft_id:draft.id,
    evidence_completeness_pct:result.evidenceCompletenessPct,
    coverage_overall_pct:coverageR.data?.overall_pct??null,
    latest_provider:result.evidenceSummary.latest_provider
  });
}

const artifact={generated_at:new Date().toISOString(),refreshed_count:refreshed.length,skipped_count:skipped.length,refreshed,skipped,auto_publish:false};
if(outputPath){
  const absolute=path.resolve(outputPath);await fs.mkdir(path.dirname(absolute),{recursive:true});
  await fs.writeFile(absolute,JSON.stringify(artifact,null,2)+"\n","utf8");
}
console.log(JSON.stringify(artifact,null,2));
