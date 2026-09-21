import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { marketMetricsFromYahooChart, mergeSecMarketMetrics } from "../lib/universe-feed-sec.mjs";

const arg=(name,fallback=null)=>{
  const prefix="--"+name+"=";
  const hit=process.argv.find(x=>x.startsWith(prefix));
  return hit?hit.slice(prefix.length):fallback;
};
const input=arg("input","data/universe/sec-us-fundamentals.json");
const output=arg("output","data/universe/sec-us-screening.json");
const cacheDir=path.resolve(arg("cache-dir",".cache/yahoo-universe"));
const concurrency=Math.max(1,Math.min(8,Number(arg("concurrency","4"))||4));
const maxSymbols=Math.max(0,Number(arg("max-symbols","0"))||0);
const refresh=process.argv.includes("--refresh");
const userAgent=process.env.MARKET_DATA_USER_AGENT??"SOLPIENT Research/1.0";

const source=JSON.parse(await fs.readFile(path.resolve(input),"utf8"));
let securities=Array.isArray(source.securities)?source.securities:[];
if(maxSymbols)securities=securities.slice(0,maxSymbols);
await fs.mkdir(cacheDir,{recursive:true});

const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const yahooSymbol=(ticker)=>String(ticker).replaceAll(".","-");

async function fetchChart(ticker){
  const cache=path.join(cacheDir,ticker.replaceAll("/","_")+".json");
  if(!refresh){
    try{return JSON.parse(await fs.readFile(cache,"utf8"));}catch{}
  }
  const symbol=yahooSymbol(ticker);
  const endpoint="https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol)+
    "?interval=1d&range=3mo&includePrePost=false&events=div%2Csplits";
  let last=null;
  for(let attempt=1;attempt<=4;attempt++){
    const response=await fetch(endpoint,{headers:{"User-Agent":userAgent,Accept:"application/json"}});
    if(response.status===429||response.status>=500){
      last=new Error("Yahoo chart HTTP "+response.status);
      await sleep(attempt*1200);
      continue;
    }
    if(!response.ok)throw new Error("Yahoo chart HTTP "+response.status);
    const body=await response.json();
    const result=body?.chart?.result?.[0];
    if(!result)throw new Error(body?.chart?.error?.description??"No Yahoo chart result");
    await fs.writeFile(cache,JSON.stringify(result));
    return result;
  }
  throw last??new Error("Yahoo chart failed");
}

const results=new Array(securities.length);
let cursor=0,success=0,failed=0;
async function worker(){
  while(true){
    const index=cursor++;
    if(index>=securities.length)return;
    const row=securities[index];
    try{
      const chart=await fetchChart(row.ticker);
      const market=marketMetricsFromYahooChart(chart);
      results[index]=mergeSecMarketMetrics(row,market);
      success++;
    }catch(error){
      failed++;
      results[index]={...row,_market_metadata:{provider:"yahoo-chart-history",temporary_source:true,error:error instanceof Error?error.message:String(error)}};
      console.error("Market enrich failed",row.ticker,error instanceof Error?error.message:String(error));
    }
    if((success+failed)%100===0)console.error("Market enriched",success+failed,"/",securities.length,"success",success);
    await sleep(75);
  }
}
await Promise.all(Array.from({length:concurrency},()=>worker()));

const marketDates=results.map(r=>r?._market_metadata?.market_date).filter(Boolean).sort();
const asOfAt=marketDates.at(-1)?marketDates.at(-1)+"T23:59:59Z":new Date().toISOString();
const payload={
  provider:"sec-edgar+yahoo-chart-prototype-v1",
  as_of_at:asOfAt,
  source_version:source.source_version+"+yahoo-chart-3mo",
  universe_name:"SEC EDGAR fundamentals + Yahoo market prototype · Solpient U.S. Universe Feed V1",
  feed_metadata:{
    ...source.feed_metadata,
    market_provider:"yahoo-chart-history",
    temporary_market_source:true,
    requested:securities.length,
    market_success:success,
    market_failed:failed,
    liquidity_basis:"latest 30 valid daily close×volume sessions; minimum 20 required",
    market_cap_basis:"latest SEC shares outstanding × latest Yahoo close",
  },
  securities:results.filter(Boolean),
};
await fs.mkdir(path.dirname(path.resolve(output)),{recursive:true});
await fs.writeFile(path.resolve(output),JSON.stringify(payload,null,2)+"\n");
console.log(JSON.stringify({
  output:path.resolve(output),
  securities:payload.securities.length,
  market_success:success,
  market_failed:failed,
  next:"node scripts/run-universe-screen.mjs --input="+output+" --limit=100 --dry-run",
},null,2));
