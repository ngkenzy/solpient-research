import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createPostgresCompatClient } from "../lib/pg-supabase-compat.mjs";
import { buildCompanyHistory, buildPeerContext, buildContextPack, latestMetricMap, CONTEXT_ENGINE_VERSION } from "../lib/historical-peer-engine.mjs";
import { peerSetForTicker } from "../lib/peer-sets.mjs";
import { latestAutonomousIndustryModule } from "../lib/autonomous-research-factory-db.mjs";

if(!process.env.SOLPIENT_DATABASE_URL)throw new Error("Missing SOLPIENT_DATABASE_URL.");\nconst sb=createPostgresCompatClient();

const asOfDate=process.env.CONTEXT_AS_OF_DATE??new Date().toISOString().slice(0,10);
const requestedCutoff=process.env.CONTEXT_KNOWLEDGE_CUTOFF_AT??(asOfDate+"T23:59:59.999Z");
const cutoffDate=new Date(requestedCutoff);
const now=new Date();
const knowledgeCutoffAt=(Number.isFinite(cutoffDate.getTime())?(cutoffDate>now?now:cutoffDate):now).toISOString();
const outputFlag=process.argv.indexOf("--output");
const outputPath=outputFlag>=0?process.argv[outputFlag+1]:null;
const onlyTicker=process.env.COVERAGE_TICKER?String(process.env.COVERAGE_TICKER).toUpperCase():null;

const {data:companies,error:companiesError}=await sb
  .from("companies")
  .select("id,ticker,company_name,cik,exchange,sector,industry,description")
  .order("ticker");
if(companiesError)throw companiesError;

const tracked=new Set((companies??[]).map(c=>c.ticker));
const selected=(companies??[]).filter(c=>!onlyTicker||c.ticker===onlyTicker);
const results=new Map();

async function upsertRows(table,rows,onConflict){
  if(!rows.length)return;
  for(let i=0;i<rows.length;i+=400){
    const {error}=await sb.from(table).upsert(rows.slice(i,i+400),{onConflict});
    if(error)throw new Error(table+": "+error.message);
  }
}

for(const company of selected){
  const [fundR,marketR]=await Promise.all([
    sb.from("fundamental_snapshots").select("*").eq("company_id",company.id).lte("observed_at",knowledgeCutoffAt).order("period_end",{ascending:false}).limit(160),
    sb.from("market_snapshots").select("*").eq("company_id",company.id).lte("trading_date",asOfDate).lte("observed_at",knowledgeCutoffAt).order("trading_date",{ascending:false}).limit(3200),
  ]);
  if(fundR.error)throw fundR.error;
  if(marketR.error)throw marketR.error;

  const autonomousIndustryModule=await latestAutonomousIndustryModule(
    sb,
    {companyId:company.id}
  );
  const result=buildCompanyHistory({
    company,
    fundamentals:fundR.data??[],
    markets:marketR.data??[],
    industryModuleOverride:autonomousIndustryModule,
  });
  results.set(company.ticker,result);

  await upsertRows("company_metric_history",result.history,"company_id,module,metric_key,period_end,period_type");
  await upsertRows("capital_allocation_history",result.capital,"company_id,period_end");
  await upsertRows("valuation_history",result.valuations,"company_id,trading_date,provider");

  const peerRows=peerSetForTicker(company.ticker).map(peer=>({
    company_id:company.id,peer_ticker:peer.ticker,peer_name:null,peer_module:null,
    relationship_type:peer.relationship_type??"reference",rationale:peer.rationale??null,
    is_active:true,updated_at:new Date().toISOString()
  }));
  await upsertRows("company_peers",peerRows,"company_id,peer_ticker");
}

const latestByTicker=new Map([...results.entries()].map(([ticker,result])=>[ticker,latestMetricMap(result)]));
const summary=[];

for(const company of selected){
  const result=results.get(company.ticker);
  const peerContext=buildPeerContext({company,trackedCompanies:tracked,latestByTicker,asOfDate,knowledgeCutoffAt});
  await upsertRows("peer_metric_snapshots",peerContext.snapshotRows,"company_id,peer_ticker,metric_key,as_of_date");

  const pack=buildContextPack({company,result,peerContext,asOfDate,knowledgeCutoffAt});
  let contextVersion=pack.context_version;
  let stored=null;
  let storeError=null;
  ({data:stored,error:storeError}=await sb.from("research_context_packs").upsert({
    ...pack,context_version:contextVersion,updated_at:new Date().toISOString()
  },{onConflict:"company_id,context_version,as_of_date"}).select("id").single());
  if(storeError&&String(storeError.message??"").includes("context pack used by published research")){
    contextVersion=CONTEXT_ENGINE_VERSION+"-"+new Date().toISOString().replace(/[^0-9]/g,"").slice(0,14);
    ({data:stored,error:storeError}=await sb.from("research_context_packs").insert({
      ...pack,context_version:contextVersion,updated_at:new Date().toISOString()
    }).select("id").single());
  }
  if(storeError)throw storeError;

  const {error:freshnessError}=await sb.from("research_freshness").upsert({
    company_id:company.id,peers_updated_at:new Date().toISOString(),
    historical_valuation_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()
  },{onConflict:"company_id"});
  if(freshnessError)throw freshnessError;

  summary.push({
    ticker:company.ticker,context_pack_id:stored.id,context_version:contextVersion,
    full_fiscal_years:result.coverage.full_year_count,historical_metric_rows:result.history.length,
    valuation_history_rows:result.valuations.length,configured_peers:peerContext.peerSet.length,
    peers_with_local_data:peerContext.peerComparison.filter(p=>p.data_status==="available").length,
    limitations:result.limitations
  });
}

const artifact={as_of_date:asOfDate,knowledge_cutoff_at:knowledgeCutoffAt,context_version:CONTEXT_ENGINE_VERSION,companies:summary.length,summary};
if(outputPath){
  const absolute=path.resolve(outputPath);await fs.mkdir(path.dirname(absolute),{recursive:true});
  await fs.writeFile(absolute,JSON.stringify(artifact,null,2)+"\n","utf8");
}
console.log(JSON.stringify(artifact,null,2));
