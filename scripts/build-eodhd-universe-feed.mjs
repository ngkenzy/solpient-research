import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { normalizeEodhdUniverse } from "../lib/universe-feed-eodhd.mjs";

const arg=(name,fallback=null)=>{
  const prefix="--"+name+"=";
  const hit=process.argv.find(x=>x.startsWith(prefix));
  return hit?hit.slice(prefix.length):fallback;
};

const token=process.env.EODHD_API_TOKEN;
const exchange=String(arg("exchange","US")).toUpperCase();
const output=arg("output",path.join("data","universe",`eodhd-${exchange.toLowerCase()}.json`));
const sessions=Math.max(20,Math.min(30,Number(arg("sessions","30"))||30));
const maxSymbols=Math.max(0,Number(arg("max-symbols","0"))||0);
const dryRun=process.argv.includes("--dry-run");

if(!token)throw new Error("Set EODHD_API_TOKEN.");
if(exchange!=="US"){
  throw new Error("Universe Feed V1 is US-only. Global exchanges require FX-normalized market-cap and liquidity semantics.");
}

const base="https://eodhd.com/api";
async function getJson(url){
  const response=await fetch(url,{headers:{"user-agent":"Solpient-Research/1.0"}});
  if(!response.ok)throw new Error(`EODHD ${response.status}: ${await response.text()}`);
  return response.json();
}
const qs=(params)=>new URLSearchParams({...params,api_token:token}).toString();

async function fetchLatestExtended(){
  return getJson(`${base}/eod-bulk-last-day/${exchange}?${qs({fmt:"json",filter:"extended"})}`);
}

async function fetchEodForDate(date){
  return getJson(`${base}/eod-bulk-last-day/${exchange}?${qs({fmt:"json",date})}`);
}

function dateBack(isoDate,days){
  const d=new Date(isoDate+"T12:00:00Z");
  d.setUTCDate(d.getUTCDate()-days);
  return d.toISOString().slice(0,10);
}

async function buildLiquidity(latestDate,allowedTickers){
  const buckets=new Map();
  const seenDates=new Set();
  for(let back=0;back<55&&seenDates.size<sessions;back++){
    const requested=dateBack(latestDate,back);
    const rows=await fetchEodForDate(requested);
    if(!Array.isArray(rows)||!rows.length)continue;
    const actual=String(rows[0]?.date??requested);
    if(seenDates.has(actual))continue;
    seenDates.add(actual);
    for(const row of rows){
      const ticker=String(row.code??"").toUpperCase();
      if(!ticker||(allowedTickers&& !allowedTickers.has(ticker)))continue;
      const price=Number(row.adjusted_close??row.close);
      const volume=Number(row.volume);
      if(!Number.isFinite(price)||!Number.isFinite(volume)||price<=0||volume<0)continue;
      const bucket=buckets.get(ticker)??{sum:0,count:0};
      bucket.sum+=price*volume;
      bucket.count+=1;
      buckets.set(ticker,bucket);
    }
  }
  return new Map([...buckets].map(([ticker,b])=>[ticker,{
    averageDollarVolume:b.count?b.sum/b.count:null,
    observationCount:b.count,
    sessionCount:seenDates.size,
  }]));
}

function normalizeBulkFundamentals(raw){
  if(Array.isArray(raw))return raw;
  if(raw&&Array.isArray(raw.data))return raw.data;
  if(raw&&typeof raw==="object")return Object.values(raw);
  return[];
}

async function fetchFundamentals(allowedTickers){
  const map=new Map();
  for(let offset=0;;offset+=500){
    const url=`${base}/v1.1/bulk-fundamentals/${exchange}?${qs({fmt:"json",limit:"500",offset:String(offset),version:"1.2"})}`;
    const raw=await getJson(url);
    const rows=normalizeBulkFundamentals(raw);
    if(!rows.length)break;
    for(const row of rows){
      const ticker=String(row?.General?.Code??row?.code??row?.Code??"").toUpperCase();
      if(!ticker)continue;
      if(allowedTickers&& !allowedTickers.has(ticker))continue;
      map.set(ticker,row);
    }
    if(rows.length<500)break;
  }
  return map;
}

const latest=await fetchLatestExtended();
if(!Array.isArray(latest)||!latest.length)throw new Error("EODHD returned no extended US EOD rows.");
const latestDate=String(latest[0]?.date??"");
if(!latestDate)throw new Error("Latest bulk EOD response has no date.");

let quotes=latest.filter(row=>{
  const ticker=String(row?.code??"").toUpperCase();
  const type=String(row?.type??"").toLowerCase();
  const marketCap=Number(row?.MarketCapitalization);
  const price=Number(row?.adjusted_close??row?.close);
  return ticker &&
    (!type||type.includes("common")||type.includes("stock")||type.includes("adr")) &&
    Number.isFinite(marketCap)&&marketCap>=400_000_000 &&
    Number.isFinite(price)&&price>=1.5;
});
quotes.sort((a,b)=>Number(b.MarketCapitalization??0)-Number(a.MarketCapitalization??0));
if(maxSymbols>0)quotes=quotes.slice(0,maxSymbols);
const allowed=new Set(quotes.map(row=>String(row.code).toUpperCase()));

console.error(`EODHD Universe Feed V1: ${quotes.length} preliminary US securities as of ${latestDate}`);
const [liquidity,fundamentals]=await Promise.all([
  buildLiquidity(latestDate,allowed),
  fetchFundamentals(allowed),
]);

const securities=normalizeEodhdUniverse({
  quotes,
  fundamentalsByTicker:fundamentals,
  liquidityByTicker:liquidity,
});

const payload={
  provider:"eodhd-us-universe-v1",
  as_of_at:latestDate+"T23:59:59Z",
  source_version:"eodhd-bulk-fundamentals-v1.2+eod-bulk",
  universe_name:"US listed common equities · Solpient Universe Feed V1",
  feed_metadata:{
    exchange,
    exact_liquidity_sessions:sessions,
    input_quotes:quotes.length,
    fundamentals_matched:securities.filter(x=>x.revenue_ttm!=null).length,
    liquidity_covered:securities.filter(x=>x.avg_dollar_volume_30d!=null).length,
    note:"US-only V1 avoids cross-currency market-cap comparisons. Global coverage requires FX normalization.",
  },
  securities,
};

if(dryRun){
  console.log(JSON.stringify({
    ...payload,
    securities:securities.slice(0,10),
    preview_only:true,
  },null,2));
}else{
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(payload,null,2)+"\n");
  console.log(JSON.stringify({
    output,
    securities:securities.length,
    latest_date:latestDate,
    fundamentals_matched:payload.feed_metadata.fundamentals_matched,
    liquidity_covered:payload.feed_metadata.liquidity_covered,
    next:`node scripts/run-universe-screen.mjs --input=${output} --limit=100 --dry-run`,
  },null,2));
}
