import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { buildCoverageReport, COVERAGE_ENGINE_VERSION } from "../lib/data-coverage-engine.mjs";
import { buildBaselineDraft } from "../lib/baseline-factory.mjs";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const asOfDate=process.env.COVERAGE_AS_OF_DATE??new Date().toISOString().slice(0,10);
const outputFlag=process.argv.indexOf("--output");
const outputPath=outputFlag>=0?process.argv[outputFlag+1]:null;

const {data:companies,error:companyError}=await sb
  .from("companies")
  .select("id,ticker,company_name")
  .order("ticker");
if(companyError)throw companyError;

const summary=[];

for(const company of companies??[]){
  const [fundR,marketR,contextR,filingR]=await Promise.all([
    sb.from("fundamental_snapshots").select("*").eq("company_id",company.id).order("period_end",{ascending:false}).limit(160),
    sb.from("market_snapshots").select("trading_date,price,market_cap,observed_at,source_url,provider").eq("company_id",company.id).order("trading_date",{ascending:false}).limit(4000),
    sb.from("research_context_packs").select("summary").eq("company_id",company.id).order("as_of_date",{ascending:false}).limit(1).maybeSingle(),
    sb.from("filing_events").select("id,provider,form_type,filed_at,accepted_at,accession_number,filing_url,period_end,title").eq("company_id",company.id).order("filed_at",{ascending:false}).limit(25),
  ]);
  for(const r of [fundR,marketR,contextR,filingR])if(r.error)throw r.error;

  const marketRows=marketR.data??[];
  const temporaryBaseline=buildBaselineDraft({
    company,
    market:marketRows[0]??null,
    fundamentals:fundR.data??[],
    filings:filingR.data??[],
  });

  const report=buildCoverageReport({
    company,
    fundamentals:fundR.data??[],
    marketDays:new Set(marketRows.map(row=>row.trading_date).filter(Boolean)).size,
    context:contextR.data,
    draft:{draft_payload:temporaryBaseline.payload},
    asOfDate,
  });

  const {error}=await sb.from("data_coverage_reports").upsert(report,{
    onConflict:"company_id,engine_version,as_of_date"
  });
  if(error)throw error;

  summary.push({
    ticker:company.ticker,status:report.status,overall_pct:report.overall_pct,
    fundamentals_pct:report.fundamentals_pct,balance_sheet_pct:report.balance_sheet_pct,
    history_pct:report.history_pct,market_history_pct:report.market_history_pct,
    industry_pct:report.industry_pct,peer_pct:report.peer_pct,
    normalized_quarters:report.normalized_quarters,complete_fiscal_years:report.complete_fiscal_years,
    market_days:report.market_days,primary_source_quarters:report.primary_source_quarters,
    missing_fields:report.missing_fields
  });
}

summary.sort((a,b)=>a.overall_pct-b.overall_pct||a.ticker.localeCompare(b.ticker));
const artifact={
  generated_at:new Date().toISOString(),as_of_date:asOfDate,engine_version:COVERAGE_ENGINE_VERSION,
  counts:{
    sufficient:summary.filter(x=>x.status==="sufficient").length,
    partial:summary.filter(x=>x.status==="partial").length,
    blocked:summary.filter(x=>x.status==="blocked").length,
  },
  summary
};
if(outputPath){
  const absolute=path.resolve(outputPath);await fs.mkdir(path.dirname(absolute),{recursive:true});
  await fs.writeFile(absolute,JSON.stringify(artifact,null,2)+"\n","utf8");
}
console.log(JSON.stringify(artifact,null,2));
