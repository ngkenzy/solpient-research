import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { buildBaselineDraft, BASELINE_FACTORY_VERSION } from "../lib/baseline-factory.mjs";
import { latestAutonomousIndustryModule } from "../lib/autonomous-research-factory-db.mjs";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const outputFlag=process.argv.indexOf("--output");
const outputPath=outputFlag>=0?process.argv[outputFlag+1]:null;

const [companiesR,runsR,draftsR]=await Promise.all([
  sb.from("companies").select("id,ticker,company_name,cik,exchange,sector,industry,description").order("ticker"),
  sb.from("research_runs").select("company_id,id,version,standard_status,status,researched_at").eq("status","published").eq("standard_status","complete"),
  sb.from("baseline_drafts").select("company_id,id,status,generation_version,generated_at"),
]);
for(const r of [companiesR,runsR,draftsR])if(r.error)throw r.error;
const published=new Set((runsR.data??[]).map(r=>r.company_id));
const drafted=new Set((draftsR.data??[]).map(r=>r.company_id));
const generated=[],skipped=[];

for(const company of companiesR.data??[]){
  if(published.has(company.id)){skipped.push({ticker:company.ticker,reason:"complete_published_research_exists"});continue;}
  if(drafted.has(company.id)){skipped.push({ticker:company.ticker,reason:"baseline_draft_exists"});continue;}

  const [marketR,fundR,filingR,contextR]=await Promise.all([
    sb.from("market_snapshots").select("*").eq("company_id",company.id).order("trading_date",{ascending:false}).limit(1).maybeSingle(),
    sb.from("fundamental_snapshots").select("*").eq("company_id",company.id).order("period_end",{ascending:false}).limit(20),
    sb.from("filing_events").select("id,provider,form_type,filed_at,accepted_at,accession_number,filing_url,period_end,title").eq("company_id",company.id).order("filed_at",{ascending:false}).limit(25),
    sb.from("research_context_packs").select("*").eq("company_id",company.id).order("as_of_date",{ascending:false}).limit(1).maybeSingle(),
  ]);
  for(const r of [marketR,fundR,filingR,contextR])if(r.error)throw r.error;

  const autonomousIndustryModule=await latestAutonomousIndustryModule(
    sb,
    {companyId:company.id}
  );
  const result=buildBaselineDraft({
    company,market:marketR.data,fundamentals:fundR.data??[],filings:filingR.data??[],
    industryModuleOverride:autonomousIndustryModule
  });
  if(contextR.data){
    result.payload.factory.research_context={
      context_pack_id:contextR.data.id,
      context_version:contextR.data.context_version,
      as_of_date:contextR.data.as_of_date,
      history_coverage:contextR.data.history_coverage,
      trends:contextR.data.trends,
      latest_metrics:contextR.data.latest_metrics,
      peer_set:contextR.data.peer_set,
      peer_comparison:contextR.data.peer_comparison,
      capital_allocation:contextR.data.capital_allocation,
      limitations:contextR.data.limitations,
      summary:contextR.data.summary,
    };
    result.payload.factory.review_queue.unshift("Review the historical/peer context pack before qualitative scoring or valuation.");
  }

  const {data:stored,error}=await sb.from("baseline_drafts").upsert({
    company_id:company.id,generation_version:BASELINE_FACTORY_VERSION,
    generated_at:result.payload.factory.generated_at,source_cutoff_at:result.sourceCutoffAt,
    industry_module:result.industryModule,status:"generated",
    evidence_completeness_pct:result.evidenceCompletenessPct,
    standard_valid:result.validation.valid,standard_status:result.validation.status,
    validation_result:result.validation,
    evidence_summary:{...result.evidenceSummary,context_pack_id:contextR.data?.id??null,context_version:contextR.data?.context_version??null},
    draft_payload:result.payload,updated_at:new Date().toISOString()
  },{onConflict:"company_id,generation_version,source_cutoff_at"}).select("id").single();
  if(error)throw error;
  generated.push({ticker:company.ticker,draft_id:stored.id,evidence_completeness_pct:result.evidenceCompletenessPct,industry_module:result.industryModule,context_pack:Boolean(contextR.data)});
}

const artifact={generated_count:generated.length,skipped_count:skipped.length,generated,skipped,auto_publish:false};
if(outputPath){
  const absolute=path.resolve(outputPath);await fs.mkdir(path.dirname(absolute),{recursive:true});
  await fs.writeFile(absolute,JSON.stringify(artifact,null,2)+"\n","utf8");
  console.log("Wrote baseline batch artifact:",absolute);
}
console.log(JSON.stringify(artifact,null,2));
