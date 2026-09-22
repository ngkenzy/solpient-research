import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createPostgresCompatClient } from "../lib/pg-supabase-compat.mjs";
import { buildCoverageReport, COVERAGE_ENGINE_VERSION } from "../lib/data-coverage-engine.mjs";
import { buildBaselineDraft } from "../lib/baseline-factory.mjs";
import { latestAutonomousIndustryModule } from "../lib/autonomous-research-factory-db.mjs";

if(!process.env.SOLPIENT_DATABASE_URL)throw new Error("Missing SOLPIENT_DATABASE_URL.");
const sb=createPostgresCompatClient();
const asOfDate=process.env.COVERAGE_AS_OF_DATE??new Date().toISOString().slice(0,10);
const outputFlag=process.argv.indexOf("--output");
const outputPath=outputFlag>=0?process.argv[outputFlag+1]:null;
const onlyTicker=process.env.COVERAGE_TICKER?String(process.env.COVERAGE_TICKER).toUpperCase():null;
const CAPITAL_KEYS=["dividends_paid","buybacks","stock_based_compensation","acquisitions","debt_issued","debt_repaid"];

function yearsBetween(start,end){
  if(!start||!end)return 0;
  const a=new Date(start),b=new Date(end);
  if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime()))return 0;
  return Math.max(0,(b-a)/(365.25*24*60*60*1000));
}
function capitalCompleteYears(rows=[]){
  const map=new Map();
  for(const row of rows){
    if(row.period_type!=="fiscal_year")continue;
    const year=Number(row.fiscal_year);
    if(!Number.isInteger(year)||!CAPITAL_KEYS.includes(row.metric_key))continue;
    if(!map.has(year))map.set(year,new Set());
    map.get(year).add(row.metric_key);
  }
  return [...map.values()].filter(set=>CAPITAL_KEYS.every(key=>set.has(key))).length;
}

const {data:companies,error:companyError}=await sb
  .from("companies")
  .select("id,ticker,company_name")
  .order("ticker");
if(companyError)throw companyError;

const summary=[];

for(const company of (companies??[]).filter(c=>!onlyTicker||c.ticker===onlyTicker)){
  const [
    fundR,marketLatestR,marketHistoryCountR,contextR,filingR,
    valuationCountR,valuationFirstR,valuationLastR,capitalR,peerR,consensusR,runR
  ]=await Promise.all([
    sb.from("fundamental_snapshots").select("*").eq("company_id",company.id).order("period_end",{ascending:false}).limit(160),
    sb.from("market_snapshots").select("trading_date,price,market_cap,observed_at,source_url,provider").eq("company_id",company.id).order("trading_date",{ascending:false}).limit(1).maybeSingle(),
    sb.from("market_snapshots").select("id",{count:"exact",head:true}).eq("company_id",company.id).eq("provider","yahoo-chart-history"),
    sb.from("research_context_packs").select("summary").eq("company_id",company.id).order("as_of_date",{ascending:false}).limit(1).maybeSingle(),
    sb.from("filing_events").select("id,provider,form_type,filed_at,accepted_at,accession_number,filing_url,period_end,title").eq("company_id",company.id).order("filed_at",{ascending:false}).limit(25),
    sb.from("valuation_history").select("id",{count:"exact",head:true}).eq("company_id",company.id).not("price_to_fcf","is",null).not("fcf_yield","is",null),
    sb.from("valuation_history").select("trading_date").eq("company_id",company.id).not("price_to_fcf","is",null).not("fcf_yield","is",null).order("trading_date",{ascending:true}).limit(1).maybeSingle(),
    sb.from("valuation_history").select("trading_date").eq("company_id",company.id).not("price_to_fcf","is",null).not("fcf_yield","is",null).order("trading_date",{ascending:false}).limit(1).maybeSingle(),
    sb.from("company_metric_history").select("fiscal_year,period_type,metric_key").eq("company_id",company.id).in("metric_key",CAPITAL_KEYS),
    sb.from("peer_metric_snapshots").select("peer_ticker").eq("company_id",company.id),
    sb.from("consensus_snapshots").select("id",{count:"exact",head:true}).eq("company_id",company.id),
    sb.from("research_runs").select("id,version,standard_version,status").eq("company_id",company.id).eq("status","published").order("version",{ascending:false}).limit(1).maybeSingle(),
  ]);
  for(const r of [fundR,marketLatestR,marketHistoryCountR,contextR,filingR,valuationCountR,valuationFirstR,valuationLastR,capitalR,peerR,consensusR,runR])if(r.error)throw r.error;

  let valuationFormulaPersisted=false;
  if(runR.data?.id&&runR.data?.standard_version==="solpient-v2"){
    const {data,error}=await sb.from("research_v2_sections").select("valuation_analysis").eq("research_run_id",runR.data.id).maybeSingle();
    if(error)throw error;
    valuationFormulaPersisted=Boolean(data?.valuation_analysis?.valuation_bridge?.formula);
  }

  const autonomousIndustryModule=await latestAutonomousIndustryModule(
    sb,
    {companyId:company.id}
  );

  const temporaryBaseline=buildBaselineDraft({
    company,
    market:marketLatestR.data??null,
    fundamentals:fundR.data??[],
    filings:filingR.data??[],
    industryModuleOverride:autonomousIndustryModule,
  });

  const valuationFirst=valuationFirstR.data?.trading_date??null;
  const valuationLast=valuationLastR.data?.trading_date??null;
  const peerTickers=new Set((peerR.data??[]).map(r=>r.peer_ticker).filter(Boolean));
  const report=buildCoverageReport({
    company,
    fundamentals:fundR.data??[],
    marketDays:Number(marketHistoryCountR.count??0),
    context:contextR.data,
    draft:{draft_payload:temporaryBaseline.payload},
    valuationObservations:Number(valuationCountR.count??0),
    valuationCoverageYears:yearsBetween(valuationFirst,valuationLast),
    capitalCompleteYears:capitalCompleteYears(capitalR.data??[]),
    peerMetricTickers:peerTickers.size,
    consensusSnapshots:Number(consensusR.count??0),
    publishedResearch:Boolean(runR.data?.id),
    valuationFormulaPersisted,
    asOfDate,
  });

  const {error}=await sb.from("data_coverage_reports").upsert(report,{
    onConflict:"company_id,engine_version,as_of_date"
  });
  if(error)throw error;

  summary.push({
    ticker:company.ticker,status:report.status,overall_pct:report.overall_pct,
    decision_readiness_pct:report.decision_readiness_pct,
    fundamentals_pct:report.fundamentals_pct,balance_sheet_pct:report.balance_sheet_pct,
    history_pct:report.history_pct,market_history_pct:report.market_history_pct,
    valuation_history_pct:report.valuation_history_pct,
    capital_allocation_pct:report.capital_allocation_pct,
    industry_pct:report.industry_pct,peer_pct:report.peer_pct,
    consensus_pct:report.consensus_pct,research_structure_pct:report.research_structure_pct,
    missing_fields:report.missing_fields
  });
}

summary.sort((a,b)=>a.decision_readiness_pct-b.decision_readiness_pct||a.ticker.localeCompare(b.ticker));
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
