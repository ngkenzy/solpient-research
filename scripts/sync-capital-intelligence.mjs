import fs from "node:fs/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  CAPITAL_INTELLIGENCE_VERSION,
  buildInstitutionalActivity,
  parse13FInformationTable,
  parseForm4,
} from "../lib/capital-intelligence-engine.mjs";

const supabaseUrl=process.env.SUPABASE_URL;
const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.SUPABASE_SECRET_KEY;
if(!supabaseUrl||!serviceRoleKey)throw new Error("Missing SUPABASE_URL and server secret.");
const supabase=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});

const secContact=process.env.SEC_CONTACT||"ngkenzy@users.noreply.github.com";
const userAgent=process.env.SEC_USER_AGENT||("SOLPIENT Research "+secContact);
const maxForm4=Math.max(1,Number(process.env.FORM4_FILINGS_PER_COMPANY??20));
const companiesConfig=JSON.parse(await fs.readFile(new URL("../data/monitor/companies.json",import.meta.url),"utf8"));
const managers=JSON.parse(await fs.readFile(new URL("../data/monitor/managers.json",import.meta.url),"utf8"));

const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
let requestCount=0;

async function secText(url){
  const response=await fetch(url,{headers:{
    "User-Agent":userAgent,
    From:secContact,
    Accept:"application/json,application/xml,text/xml,text/plain,*/*",
    "Accept-Encoding":"gzip, deflate",
  }});
  if(!response.ok)throw new Error("SEC request failed "+response.status+" for "+url);
  requestCount+=1;
  await sleep(140);
  return response.text();
}
async function secJson(url){return JSON.parse(await secText(url));}

function filingRows(submissions){
  const r=submissions?.filings?.recent??{};
  const n=Array.isArray(r.accessionNumber)?r.accessionNumber.length:0;
  return Array.from({length:n},(_,i)=>({
    accession:r.accessionNumber?.[i]??null,
    form:r.form?.[i]??null,
    filingDate:r.filingDate?.[i]??null,
    reportDate:r.reportDate?.[i]??null,
    primaryDocument:r.primaryDocument?.[i]??null,
  })).filter((row)=>row.accession);
}
function cik10(value){return String(value??"").replace(/\D/g,"").padStart(10,"0");}
function cikArchive(value){return String(Number(String(value??"").replace(/\D/g,"")));}
function accessionCompact(value){return String(value??"").replaceAll("-","");}
function archiveBase(cik,accession){
  return "https://www.sec.gov/Archives/edgar/data/"+cikArchive(cik)+"/"+accessionCompact(accession)+"/";
}
function filingIndexUrl(cik,accession){return archiveBase(cik,accession)+"index.json";}

async function candidateXmlFiles(cik,accession){
  const index=await secJson(filingIndexUrl(cik,accession));
  return (index?.directory?.item??[])
    .map((item)=>item?.name)
    .filter((name)=>typeof name==="string"&&name.toLowerCase().endsWith(".xml"));
}
async function ownershipXml(cik,filing){
  const base=archiveBase(cik,filing.accession);
  if(filing.primaryDocument?.toLowerCase().endsWith(".xml")){
    const xml=await secText(base+filing.primaryDocument);
    if(/ownershipDocument/i.test(xml))return {xml,url:base+filing.primaryDocument};
  }
  for(const name of await candidateXmlFiles(cik,filing.accession)){
    const xml=await secText(base+name);
    if(/ownershipDocument/i.test(xml))return {xml,url:base+name};
  }
  throw new Error("No ownership XML found for "+filing.accession);
}
async function informationTableXml(cik,filing){
  const base=archiveBase(cik,filing.accession);
  for(const name of await candidateXmlFiles(cik,filing.accession)){
    if(/^primary_doc\.xml$/i.test(name))continue;
    const xml=await secText(base+name);
    if(/<(?:(?:[A-Za-z0-9_]+):)?informationTable[\s>]/i.test(xml)||/<(?:(?:[A-Za-z0-9_]+):)?infoTable[\s>]/i.test(xml)){
      return {xml,url:base+name};
    }
  }
  throw new Error("No 13F information table XML found for "+filing.accession);
}
function latest13FFilings(submissions){
  const rows=filingRows(submissions)
    .filter((row)=>["13F-HR","13F-HR/A"].includes(String(row.form).toUpperCase())&&row.reportDate)
    .sort((a,b)=>String(b.filingDate).localeCompare(String(a.filingDate)));
  const byPeriod=new Map();
  for(const row of rows)if(!byPeriod.has(row.reportDate))byPeriod.set(row.reportDate,row);
  return [...byPeriod.values()].sort((a,b)=>String(b.reportDate).localeCompare(String(a.reportDate))).slice(0,2);
}

async function startRun(){
  const {data,error}=await supabase.from("automation_runs").insert({
    pipeline:"capital_intelligence",
    status:"running",
    details:{engine_version:CAPITAL_INTELLIGENCE_VERSION},
  }).select("id").single();
  if(error)throw error;
  return data.id;
}
async function finishRun(id,status,records,message,details={}){
  const {error}=await supabase.from("automation_runs").update({
    status,records_written:records,message,details,completed_at:new Date().toISOString(),
  }).eq("id",id);
  if(error)throw error;
}
async function upsertRows(rows){
  let written=0;
  for(let i=0;i<rows.length;i+=250){
    const chunk=rows.slice(i,i+250).filter((row)=>row.company_id);
    if(!chunk.length)continue;
    const {error}=await supabase.from("capital_activity").upsert(chunk,{onConflict:"provider,source_key",ignoreDuplicates:false});
    if(error)throw error;
    written+=chunk.length;
  }
  return written;
}

const runId=await startRun();
const failures=[];
let rows=[];
try{
  const {data:dbCompanies,error:companyError}=await supabase.from("companies").select("id,ticker,company_name");
  if(companyError)throw companyError;
  const configByTicker=new Map(companiesConfig.map((c)=>[c.ticker.toUpperCase(),c]));
  const companies=(dbCompanies??[]).map((company)=>({
    ...company,
    ...(configByTicker.get(company.ticker.toUpperCase())??{}),
    id:company.id,
    company_name:company.company_name,
  }));

  const {data:existing,error:existingError}=await supabase.from("capital_activity")
    .select("provider,source_key,raw_payload")
    .in("provider",["sec_form4","sec_13f"]);
  if(existingError)throw existingError;
  const seenForm4=new Set((existing??[]).filter((r)=>r.provider==="sec_form4").map((r)=>r.raw_payload?.accession).filter(Boolean));

  for(const company of companies){
    const cik=cik10(company.cik);
    if(!cik||cik==="0000000000"){failures.push(company.ticker+": missing CIK");continue;}
    try{
      const submissions=await secJson("https://data.sec.gov/submissions/CIK"+cik+".json");
      const filings=filingRows(submissions)
        .filter((row)=>String(row.form).toUpperCase()==="4")
        .sort((a,b)=>String(b.filingDate).localeCompare(String(a.filingDate)))
        .slice(0,maxForm4);
      let parsed=0;
      for(const filing of filings){
        if(seenForm4.has(filing.accession))continue;
        try{
          const doc=await ownershipXml(cik,filing);
          const activity=parseForm4(doc.xml,{
            companyId:company.id,ticker:company.ticker,accession:filing.accession,
            filingDate:filing.filingDate,sourceUrl:doc.url,
          });
          rows.push(...activity);
          parsed+=activity.length;
        }catch(error){
          failures.push(company.ticker+" Form4 "+filing.accession+": "+error.message);
        }
      }
      console.log(company.ticker+": parsed "+parsed+" open-market insider transaction(s).");
    }catch(error){
      failures.push(company.ticker+": "+error.message);
    }
  }

  for(const manager of managers){
    try{
      const cik=cik10(manager.cik);
      const submissions=await secJson("https://data.sec.gov/submissions/CIK"+cik+".json");
      const filings=latest13FFilings(submissions);
      if(!filings.length){failures.push(manager.name+": no recent 13F-HR");continue;}

      const latestDoc=await informationTableXml(cik,filings[0]);
      const latestHoldings=parse13FInformationTable(latestDoc.xml);
      let previousHoldings=[];
      if(filings[1]){
        const previousDoc=await informationTableXml(cik,filings[1]);
        previousHoldings=parse13FInformationTable(previousDoc.xml);
      }
      const activity=buildInstitutionalActivity({
        manager,companies,latestHoldings,previousHoldings,
        positionDate:filings[0].reportDate,disclosureDate:filings[0].filingDate,
        sourceUrl:latestDoc.url,accession:filings[0].accession,
      });
      rows.push(...activity);
      console.log(manager.name+": matched "+activity.length+" tracked company position(s).");
    }catch(error){
      failures.push(manager.name+": "+error.message);
    }
  }

  const deduped=[...new Map(rows.map((row)=>[[row.provider,row.source_key].join("|"),row])).values()];
  const written=await upsertRows(deduped);
  const blockedEverywhere=requestCount===0 && deduped.length===0 && failures.length>0;
  const status=blockedEverywhere?"failed":failures.length&&written>0?"partial":"success";
  const message=blockedEverywhere
    ?"Capital intelligence could not reach SEC from this runner; no rows were written."
    :"Capital intelligence refreshed from SEC disclosures.";
  await finishRun(runId,status,written,message,{
    engine_version:CAPITAL_INTELLIGENCE_VERSION,
    sec_requests:requestCount,
    generated_rows:deduped.length,
    insider_rows:deduped.filter((r)=>r.activity_type==="insider").length,
    institutional_rows:deduped.filter((r)=>r.activity_type==="institutional").length,
    managers:managers.length,
    companies:companies.length,
    failures:failures.slice(0,100),
  });
  console.log(JSON.stringify({status,written,generated:deduped.length,requests:requestCount,failures},null,2));
  if(blockedEverywhere)process.exitCode=1;
}catch(error){
  await finishRun(runId,"failed",0,error.message,{engine_version:CAPITAL_INTELLIGENCE_VERSION,failures:[...failures,error.message]});
  throw error;
}
