import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createPostgresCompatClient } from "../lib/pg-supabase-compat.mjs";

if(!process.env.SOLPIENT_DATABASE_URL)throw new Error("Missing SOLPIENT_DATABASE_URL.");\nconst sb=createPostgresCompatClient();
const userAgent=process.env.MARKET_DATA_USER_AGENT??"SOLPIENT Research/1.0";
const outputFlag=process.argv.indexOf("--output");
const outputPath=outputFlag>=0?process.argv[outputFlag+1]:null;
const onlyTicker=process.env.COVERAGE_TICKER?String(process.env.COVERAGE_TICKER).toUpperCase():null;

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}

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
  const sorted=[...rows].filter(r=>n(r.shares_outstanding)>0).sort((a,b)=>{
    const d=String(b.period_end).localeCompare(String(a.period_end));
    return d||((priority[a.provider]??8)-(priority[b.provider]??8));
  });
  const seen=new Set();
  return sorted.filter(r=>{if(seen.has(r.period_end))return false;seen.add(r.period_end);return true;});
}
function sharesAt(series,date){
  const found=series.find(r=>String(r.period_end)<=String(date));
  return n(found?.shares_outstanding);
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
const summary=[];

async function syncBenchmark(symbol="SPY",range="10y"){
  try{
    const {endpoint,result}=await yahooHistory(symbol,range);
    const timestamps=result.timestamp??[],quotes=result.indicators?.quote?.[0]??{},closes=quotes.close??[],volumes=quotes.volume??[];
    const rows=[];
    for(let i=0;i<timestamps.length;i++){
      const price=n(closes[i]);if(price==null)continue;
      const tradingDate=new Date(Number(timestamps[i])*1000).toISOString().slice(0,10);
      rows.push({
        company_id:null,symbol,observed_at:new Date().toISOString(),
        trading_date:tradingDate,price,previous_close:i>0?n(closes[i-1]):null,
        volume:n(volumes[i]),market_cap:null,provider:"yahoo-chart-history",
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

for(const company of (companies??[]).filter(c=>!onlyTicker||c.ticker===onlyTicker)){
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
      const price=n(closes[i]);if(price==null)continue;
      const tradingDate=new Date(Number(timestamps[i])*1000).toISOString().slice(0,10);
      const shares=sharesAt(shareSeries,tradingDate);
      rows.push({
        company_id:company.id,symbol:company.ticker,observed_at:new Date().toISOString(),
        trading_date:tradingDate,price,previous_close:i>0?n(closes[i-1]):null,
        volume:n(volumes[i]),market_cap:shares?shares*price:null,provider:"yahoo-chart-history",
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

const artifact={generated_at:new Date().toISOString(),provider:"yahoo-chart-history",temporary_source:true,summary};
if(outputPath){
  const absolute=path.resolve(outputPath);await fs.mkdir(path.dirname(absolute),{recursive:true});
  await fs.writeFile(absolute,JSON.stringify(artifact,null,2)+"\n","utf8");
}
console.log(JSON.stringify(artifact,null,2));
