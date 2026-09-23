import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createPostgresCompatClient } from "../lib/pg-supabase-compat.mjs";
import { pgQuery } from "../lib/postgres-node.mjs";
import { marketNumber, positiveMarketPrice } from "../lib/market-history.mjs";

if(!process.env.SOLPIENT_DATABASE_URL)throw new Error("Missing SOLPIENT_DATABASE_URL.");
const sb=createPostgresCompatClient();
const userAgent=process.env.MARKET_DATA_USER_AGENT??"SOLPIENT Research/1.0";
const outputFlag=process.argv.indexOf("--output");
const outputPath=outputFlag>=0?process.argv[outputFlag+1]:null;
const onlyTicker=process.env.COVERAGE_TICKER?String(process.env.COVERAGE_TICKER).toUpperCase():null;
const solpient100Only=process.argv.includes("--solpient-100");

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

async function yahooHistory(symbol,range){
  const endpoint="https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol)+
    "?interval=1d&range="+encodeURIComponent(range)+"&includePrePost=false&events=div%2Csplits";
  let lastError=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const response=await fetch(endpoint,{headers:{"User-Agent":userAgent,Accept:"application/json"}});
      if(response.status===429||response.status>=500){await sleep(attempt*1000);continue;}
      if(!response.ok)throw new Error("Yahoo history HTTP "+response.status);
      const body=await response.json(),result=body?.chart?.result?.[0];
      if(!result)throw new Error(body?.chart?.error?.description??"No chart result");
      return{endpoint,result};
    }catch(error){lastError=error;if(attempt<3)await sleep(attempt*800);}
  }
  throw lastError??new Error("Yahoo history request failed");
}

function selectShareSeries(rows){
  const priority={sec_companyfacts:0,fmp:1,alpha_vantage:2,unknown:9};
  const sorted=[...rows].filter(r=>marketNumber(r.shares_outstanding)>0).sort((a,b)=>{
    const d=String(b.period_end).localeCompare(String(a.period_end));
    return d||((priority[a.provider]??8)-(priority[b.provider]??8));
  });
  const seen=new Set();
  return sorted.filter(r=>{if(seen.has(r.period_end))return false;seen.add(r.period_end);return true;});
}
function sharesAt(series,date){
  const found=series.find(r=>String(r.period_end)<=String(date));
  return marketNumber(found?.shares_outstanding);
}
async function insertBatches(rows){
  for(let i=0;i<rows.length;i+=400){
    const {error}=await sb.from("market_snapshots").upsert(rows.slice(i,i+400),{
      onConflict:"symbol,trading_date,provider"
    });
    if(error)throw error;
  }
}

const {data:companies,error:companyError}=await sb.from("companies").select("id,ticker").order("ticker");
if(companyError)throw companyError;

let scopedCompanies=companies??[];
let scope={name:"all_companies",candidate_pipeline_run_id:null,expected_candidates:null,matched_companies:scopedCompanies.length};

if(solpient100Only){
  const candidateRuns=await pgQuery(
    "select id,candidate_count,evaluation_as_of from public.research_candidate_pipeline_runs " +
    "order by evaluation_as_of desc nulls last, created_at desc limit 1"
  );
  const candidateRun=candidateRuns[0]??null;
  if(!candidateRun)throw new Error("Cannot use --solpient-100: no candidate pipeline run exists.");

  const candidateRows=await pgQuery(
    "select company_id,ticker from public.research_candidate_pipeline_items " +
    "where research_candidate_pipeline_run_id=$1",
    [candidateRun.id]
  );
  if(candidateRows.length!==Number(candidateRun.candidate_count)){
    throw new Error(
      "Cannot use --solpient-100: latest candidate run is incomplete. expected="+
      candidateRun.candidate_count+" actual="+candidateRows.length
    );
  }

  const ids=new Set(candidateRows.map(row=>row.company_id).filter(Boolean));
  const tickers=new Set(candidateRows.map(row=>String(row.ticker??"").toUpperCase()).filter(Boolean));
  scopedCompanies=scopedCompanies.filter(
    company=>ids.has(company.id)||tickers.has(String(company.ticker).toUpperCase())
  );
  scope={
    name:"solpient_100",
    candidate_pipeline_run_id:candidateRun.id,
    expected_candidates:Number(candidateRun.candidate_count),
    matched_companies:scopedCompanies.length,
  };
}

const summary=[];

async function syncBenchmark(symbol="SPY",range="10y"){
  try{
    const {endpoint,result}=await yahooHistory(symbol,range);
    const timestamps=result.timestamp??[],quotes=result.indicators?.quote?.[0]??{},closes=quotes.close??[],volumes=quotes.volume??[];
    const rows=[];
    for(let i=0;i<timestamps.length;i++){
      const price=positiveMarketPrice(closes[i]);if(price==null)continue;
      const tradingDate=new Date(Number(timestamps[i])*1000).toISOString().slice(0,10);
      rows.push({
        company_id:null,symbol,observed_at:new Date().toISOString(),
        trading_date:tradingDate,price,previous_close:i>0?marketNumber(closes[i-1]):null,
        volume:marketNumber(volumes[i]),market_cap:null,provider:"yahoo-chart-history",
        source_url:endpoint,raw_payload:{currency:result.meta?.currency??null,exchangeName:result.meta?.exchangeName??null,range,benchmark:true,temporary_source:true}
      });
    }
    await insertBatches(rows);
    summary.push({ticker:symbol,status:"success",range,rows:rows.length,benchmark:true});
    console.log("Benchmark history",symbol,range,"rows="+rows.length);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    summary.push({ticker:symbol,status:"failed",rows:0,error:message,benchmark:true});
    console.warn("Benchmark history failed",symbol,message);
  }
}

for(const company of scopedCompanies.filter(c=>!onlyTicker||c.ticker===onlyTicker)){
  await pgQuery(`delete from public.market_snapshots where company_id=$1 and provider='yahoo-chart-history' and (price is null or price<=0)`,[company.id]);
  const [{count,error:countError},{data:fundamentals,error:fundError}]=await Promise.all([
    sb.from("market_snapshots").select("id",{count:"exact",head:true}).eq("company_id",company.id),
    sb.from("fundamental_snapshots").select("period_end,shares_outstanding,provider").eq("company_id",company.id).not("shares_outstanding","is",null).order("period_end",{ascending:false}).limit(80),
  ]);
  if(countError)throw countError;if(fundError)throw fundError;
  const existing=Number(count??0),range=existing>=750?"1mo":"10y";
  try{
    const {endpoint,result}=await yahooHistory(company.ticker,range);
    const timestamps=result.timestamp??[],quotes=result.indicators?.quote?.[0]??{},closes=quotes.close??[],volumes=quotes.volume??[];
    const shareSeries=selectShareSeries(fundamentals??[]);
    const rows=[];
    for(let i=0;i<timestamps.length;i++){
      const price=positiveMarketPrice(closes[i]);if(price==null)continue;
      const tradingDate=new Date(Number(timestamps[i])*1000).toISOString().slice(0,10);
      const shares=sharesAt(shareSeries,tradingDate);
      rows.push({
        company_id:company.id,symbol:company.ticker,observed_at:new Date().toISOString(),
        trading_date:tradingDate,price,previous_close:i>0?marketNumber(closes[i-1]):null,
        volume:marketNumber(volumes[i]),market_cap:shares?shares*price:null,provider:"yahoo-chart-history",
        source_url:endpoint,raw_payload:{currency:result.meta?.currency??null,exchangeName:result.meta?.exchangeName??null,range,temporary_source:true}
      });
    }
    await insertBatches(rows);
    summary.push({ticker:company.ticker,status:"success",range,rows:rows.length,existing_before:existing});
    console.log("Market history",company.ticker,range,"rows="+rows.length);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    summary.push({ticker:company.ticker,status:"failed",rows:0,error:message,existing_before:existing});
    console.warn("Market history failed",company.ticker,message);
  }
  await sleep(120);
}

if(!onlyTicker) await syncBenchmark("SPY","10y");

const artifact={generated_at:new Date().toISOString(),provider:"yahoo-chart-history",temporary_source:true,scope,summary};
if(outputPath){
  const absolute=path.resolve(outputPath);await fs.mkdir(path.dirname(absolute),{recursive:true});
  await fs.writeFile(absolute,JSON.stringify(artifact,null,2)+"\n","utf8");
}
console.log(JSON.stringify(artifact,null,2));
