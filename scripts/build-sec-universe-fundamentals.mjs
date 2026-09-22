import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { buildSecScreenFundamentals } from "../lib/universe-feed-sec.mjs";
import { canonicalizeIssuerMappings } from "../lib/universe-issuer-selection.mjs";

const arg=(name,fallback=null)=>{
  const prefix="--"+name+"=";
  const hit=process.argv.find(x=>x.startsWith(prefix));
  return hit?hit.slice(prefix.length):fallback;
};
const output=arg("output","data/universe/sec-us-fundamentals.json");
const cacheDir=path.resolve(arg("cache-dir",".cache/sec-universe"));
const maxSymbols=Math.max(0,Number(arg("max-symbols","0"))||0);
const refresh=process.argv.includes("--refresh");
const exchanges=new Set(String(arg("exchanges","Nasdaq,NYSE,NYSE American")).split(",").map(x=>x.trim()).filter(Boolean));
const contact=process.env.SEC_CONTACT??null;
const userAgent=process.env.SEC_USER_AGENT??(contact?"Solpient Research "+contact:null);

if(!userAgent)throw new Error("Set SEC_CONTACT or SEC_USER_AGENT for SEC automated access.");

const SEC_COMPANYFACTS="https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip";
const SEC_SUBMISSIONS="https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip";
const SEC_TICKERS="https://www.sec.gov/files/company_tickers_exchange.json";

async function download(url,destination){
  if(!refresh&&fsSync.existsSync(destination))return;
  const response=await fetch(url,{headers:{"User-Agent":userAgent,Accept:"application/octet-stream,application/json"}});
  if(!response.ok)throw new Error("SEC download failed "+response.status+" "+url);
  await fs.mkdir(path.dirname(destination),{recursive:true});
  const buffer=Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destination,buffer);
}
function unzip(zip,destination){
  if(!refresh&&fsSync.existsSync(destination)&&fsSync.readdirSync(destination).length)return;
  fsSync.mkdirSync(destination,{recursive:true});
  execFileSync("unzip",["-q","-o",zip,"-d",destination],{stdio:"inherit"});
}
function cik10(value){return String(value??"").replace(/\D/g,"").padStart(10,"0");}
function candidateJson(root,cik){
  const name="CIK"+cik10(cik)+".json";
  for(const p of [path.join(root,name),path.join(root,"companyfacts",name),path.join(root,"submissions",name)]){
    if(fsSync.existsSync(p))return p;
  }
  return null;
}
function parseTickerMap(body){
  if(Array.isArray(body?.data)&&Array.isArray(body?.fields)){
    const idx=Object.fromEntries(body.fields.map((f,i)=>[f,i]));
    return body.data.map(row=>({
      cik:row[idx.cik],name:row[idx.name],ticker:row[idx.ticker],exchange:row[idx.exchange],
    }));
  }
  return[];
}
function submissionMetadata(body){
  return{
    sic:body?.sic??null,
    sicDescription:body?.sicDescription??null,
  };
}

await fs.mkdir(cacheDir,{recursive:true});
const companyfactsZip=path.join(cacheDir,"companyfacts.zip");
const submissionsZip=path.join(cacheDir,"submissions.zip");
const tickerFile=path.join(cacheDir,"company_tickers_exchange.json");
const companyfactsDir=path.join(cacheDir,"companyfacts");
const submissionsDir=path.join(cacheDir,"submissions");

await Promise.all([
  download(SEC_COMPANYFACTS,companyfactsZip),
  download(SEC_SUBMISSIONS,submissionsZip),
  download(SEC_TICKERS,tickerFile),
]);
unzip(companyfactsZip,companyfactsDir);
unzip(submissionsZip,submissionsDir);

const tickerMap=parseTickerMap(JSON.parse(await fs.readFile(tickerFile,"utf8")))
  .filter(row=>row.ticker&&row.cik&&exchanges.has(String(row.exchange??"")));
const canonical=canonicalizeIssuerMappings(tickerMap);
const selected=maxSymbols?canonical.selected.slice(0,maxSymbols):canonical.selected;

const securities=[];
const skipped={missing_companyfacts:0,no_normalized_facts:0,parse_error:0};
const diagnostics={missing_companyfacts:[],no_normalized_facts:[],parse_errors:[]};
for(let i=0;i<selected.length;i++){
  const meta=selected[i];
  const factsPath=candidateJson(companyfactsDir,meta.cik);
  if(!factsPath){
    skipped.missing_companyfacts++;
    if(diagnostics.missing_companyfacts.length<25)diagnostics.missing_companyfacts.push({ticker:meta.ticker,cik:cik10(meta.cik)});
    continue;
  }
  try{
    const companyFacts=JSON.parse(await fs.readFile(factsPath,"utf8"));
    const submissionPath=candidateJson(submissionsDir,meta.cik);
    const submission=submissionPath?JSON.parse(await fs.readFile(submissionPath,"utf8")):{};
    const sm=submissionMetadata(submission);
    const row=buildSecScreenFundamentals({
      companyFacts,
      ticker:meta.ticker,
      cik:meta.cik,
      companyName:meta.name,
      exchange:meta.exchange,
      sic:sm.sic,
      sicDescription:sm.sicDescription,
    });
    if(!row){
      skipped.no_normalized_facts++;
      if(diagnostics.no_normalized_facts.length<25)diagnostics.no_normalized_facts.push({ticker:meta.ticker,cik:cik10(meta.cik)});
      continue;
    }
    securities.push(row);
  }catch(error){
    skipped.parse_error++;
    const message=error instanceof Error?error.message:String(error);
    if(diagnostics.parse_errors.length<25)diagnostics.parse_errors.push({ticker:meta.ticker,cik:cik10(meta.cik),error:message});
    console.error("SEC universe normalize failed",meta.ticker,message);
  }
  if((i+1)%250===0)console.error("SEC normalized",i+1,"/",selected.length,"kept",securities.length);
}

const generatedAt=new Date().toISOString();
const payload={
  provider:"sec-edgar-bulk-v1",
  as_of_at:generatedAt,
  source_version:"companyfacts.zip+submissions.zip+company_tickers_exchange.json",
  universe_name:"SEC EDGAR U.S. listed fundamentals · Solpient Universe Feed V1",
  feed_metadata:{
    exchanges:[...exchanges],
    raw_security_mappings:tickerMap.length,
    canonical_issuers:canonical.issuerCount,
    duplicate_or_secondary_security_mappings_removed:canonical.removedSecurityMappings,
    input_mappings:selected.length,
    securities:securities.length,
    skipped,
    diagnostics,
    sec_user_agent:userAgent,
    market_data_required:true,
  },
  securities,
};
await fs.mkdir(path.dirname(path.resolve(output)),{recursive:true});
await fs.writeFile(path.resolve(output),JSON.stringify(payload,null,2)+"\n");
console.log(JSON.stringify({output:path.resolve(output),...payload.feed_metadata},null,2));
