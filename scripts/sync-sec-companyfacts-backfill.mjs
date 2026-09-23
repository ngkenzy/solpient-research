import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";
import { createPostgresCompatClient } from "../lib/pg-supabase-compat.mjs";
import { normalizeCompanyFacts, SEC_PROVIDER } from "../lib/sec-companyfacts.mjs";

function localEnvValue(key){
  const envPath=path.resolve(process.cwd(),".env.local");
  if(!fsSync.existsSync(envPath))return null;
  for(const rawLine of fsSync.readFileSync(envPath,"utf8").split(/\r?\n/)){
    const line=rawLine.trim();
    if(!line||line.startsWith("#"))continue;
    const prefix=key+"=";
    if(!line.startsWith(prefix))continue;
    let value=line.slice(prefix.length).trim();
    if(
      (value.startsWith('"')&&value.endsWith('"'))||
      (value.startsWith("'")&&value.endsWith("'"))
    ){
      value=value.slice(1,-1);
    }
    return value;
  }
  return null;
}

if(!process.env.SOLPIENT_DATABASE_URL)throw new Error("Missing SOLPIENT_DATABASE_URL.");
const sb=createPostgresCompatClient();

const secContact=String(localEnvValue("SEC_CONTACT")??process.env.SEC_CONTACT??"").trim();
const configuredUserAgent=String(localEnvValue("SEC_USER_AGENT")??process.env.SEC_USER_AGENT??"").trim();
if(!secContact){
  throw new Error(
    "Missing SEC_CONTACT in .env.local. SEC automated access requires identifiable contact information."
  );
}
const userAgent=configuredUserAgent||("Solpient Research "+secContact);
const outputFlag=process.argv.indexOf("--output");
const outputPath=outputFlag>=0?process.argv[outputFlag+1]:null;
const onlyTicker=process.env.COVERAGE_TICKER?String(process.env.COVERAGE_TICKER).toUpperCase():null;

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

function errorDetails(error,stage){
  return {
    stage,
    message:error?.message??String(error),
    code:error?.code??null,
    detail:error?.detail??error?.details??null,
    hint:error?.hint??null,
    schema:error?.schema??null,
    table:error?.table??null,
    column:error?.column??null,
    constraint:error?.constraint??null,
    data_type:error?.dataType??error?.dataTypeName??null,
  };
}

function fundamentalConflictKey(row){
  return [
    row.company_id??"",
    row.period_end??"",
    row.form??"",
    row.provider??"",
  ].join("|");
}

function dedupeFundamentalRows(rows){
  const byKey=new Map();
  for(const row of rows){
    const key=fundamentalConflictKey(row);
    const prior=byKey.get(key);
    if(!prior){
      byKey.set(key,row);
      continue;
    }
    const priorObserved=Date.parse(prior.observed_at??"")||0;
    const currentObserved=Date.parse(row.observed_at??"")||0;
    if(currentObserved>=priorObserved)byKey.set(key,row);
  }
  return [...byKey.values()];
}

async function secJson(cik){
  const padded=String(cik).replace(/\D/g,"").padStart(10,"0");
  const endpoint="https://data.sec.gov/api/xbrl/companyfacts/CIK"+padded+".json";
  let lastError=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const response=await fetch(endpoint,{
        headers:{
          "User-Agent":userAgent,
          From:secContact,
          Accept:"application/json",
          "Accept-Encoding":"gzip, deflate",
        }
      });
      if(response.status===403){
        const bodyText=await response.text().catch(()=>"");
        const error=new Error(
          "SEC companyfacts HTTP 403. SEC rejected automated access. "+
          "Verify SEC_CONTACT/SEC_USER_AGENT and, if this IP was rate-limited, "+
          "allow about 10 minutes below the SEC request-rate threshold before retrying."
        );
        error.code="SEC_BLOCKED";
        error.status=403;
        error.endpoint=endpoint;
        error.response_preview=bodyText.slice(0,500);
        throw error;
      }
      if(response.status===429||response.status===503){
        await sleep(attempt*1500);
        continue;
      }
      if(!response.ok)throw new Error("SEC companyfacts HTTP "+response.status);
      return{endpoint,body:await response.json()};
    }catch(error){
      lastError=error;
      if(error?.code==="SEC_BLOCKED")throw error;
      if(attempt<3)await sleep(attempt*1000);
    }
  }
  throw lastError??new Error("SEC companyfacts request failed.");
}

async function attemptStart(company){
  const {data,error}=await sb.from("data_provider_attempts").insert({
    company_id:company.id,provider:SEC_PROVIDER,stage:"historical_fundamentals",status:"running",
    details:{ticker:company.ticker}
  }).select("id").single();
  if(error)throw error;return data.id;
}
async function attemptFinish(id,status,records,message,details={}){
  const {error}=await sb.from("data_provider_attempts").update({
    status,records_written:records,message,details,completed_at:new Date().toISOString()
  }).eq("id",id);
  if(error)throw error;
}

const {data:companies,error:companiesError}=await sb
  .from("companies")
  .select("id,ticker,company_name,cik")
  .order("ticker");
if(companiesError)throw companiesError;

const selected=(companies??[]).filter(c=>c.cik&&(!onlyTicker||c.ticker===onlyTicker));
const summary=[];
let consecutiveBlocked=0;

for(const company of selected){
  const attemptId=await attemptStart(company);
  let failureStage="request";
  try{
    const {endpoint,body}=await secJson(company.cik);
    failureStage="normalize";
    const normalizedRows=normalizeCompanyFacts(body,{
      companyId:company.id,ticker:company.ticker,cik:company.cik,observedAt:new Date().toISOString()
    });
    const rows=dedupeFundamentalRows(normalizedRows);
    const duplicateRowsRemoved=normalizedRows.length-rows.length;
    console.log(
      "SEC companyfacts normalized",
      company.ticker,
      "rows="+normalizedRows.length,
      "unique="+rows.length,
      "deduped="+duplicateRowsRemoved
    );
    failureStage="upsert_fundamental_snapshots";
    let written=0;
    for(let i=0;i<rows.length;i+=100){
      const chunk=rows.slice(i,i+100);
      const {error}=await sb.from("fundamental_snapshots").upsert(chunk,{
        onConflict:"company_id,period_end,form,provider"
      });
      if(error)throw error;
      written+=chunk.length;
    }
    const years=[...new Set(rows.map(r=>r.fiscal_year).filter(Boolean))];
    const primaryFields=rows.slice(0,5).map(r=>({
      period_end:r.period_end,
      revenue:r.revenue!=null,
      net_income:r.net_income!=null,
      operating_cash_flow:r.operating_cash_flow!=null,
      free_cash_flow:r.free_cash_flow!=null,
      shares_outstanding:r.shares_outstanding!=null,
      eps_diluted:r.eps_diluted!=null,
      total_debt:r.raw_payload?.balance_sheet?.totalDebt!=null,
      cash:r.raw_payload?.balance_sheet?.cashAndCashEquivalents!=null,
    }));
    await attemptFinish(
      attemptId,
      written>0?"success":"partial",
      written,
      "SEC companyfacts stored "+written+" normalized quarters.",
      {endpoint,fiscal_years:years.length,latest_period:rows[0]?.period_end??null,latest_field_coverage:primaryFields}
    );
    consecutiveBlocked=0;
    summary.push({
      ticker:company.ticker,
      status:written>0?"success":"partial",
      rows:written,
      fiscal_years:years.length,
      latest_period:rows[0]?.period_end??null,
      duplicate_rows_removed:duplicateRowsRemoved,
    });
    console.log("SEC companyfacts",company.ticker,"rows="+written,"years="+years.length);
  }catch(error){
    const diagnostics=errorDetails(error,failureStage);
    const message=diagnostics.message;
    await attemptFinish(attemptId,"failed",0,message,{
      ticker:company.ticker,
      ...diagnostics,
      sec_user_agent_configured:Boolean(configuredUserAgent),
      sec_contact_configured:Boolean(secContact),
    });
    summary.push({ticker:company.ticker,status:"failed",rows:0,error:message,diagnostics});
    console.warn("SEC companyfacts failed",company.ticker,JSON.stringify(diagnostics));
    if(error?.code==="SEC_BLOCKED"){
      consecutiveBlocked+=1;
      if(consecutiveBlocked>=3){
        console.warn("SEC circuit breaker opened after three consecutive 403 responses; provider fallbacks will handle the remaining companies.");
        break;
      }
    }else{
      consecutiveBlocked=0;
    }
  }
  await sleep(250);
}

const artifact={
  generated_at:new Date().toISOString(),
  provider:SEC_PROVIDER,
  companies:selected.length,
  success:summary.filter(x=>x.status==="success").length,
  partial:summary.filter(x=>x.status==="partial").length,
  failed:summary.filter(x=>x.status==="failed").length,
  circuit_breaker_open:consecutiveBlocked>=3,
  rows_written:summary.reduce((a,x)=>a+(x.rows??0),0),
  summary
};
if(outputPath){
  const absolute=path.resolve(outputPath);
  await fs.mkdir(path.dirname(absolute),{recursive:true});
  await fs.writeFile(absolute,JSON.stringify(artifact,null,2)+"\n","utf8");
}
console.log(JSON.stringify(artifact,null,2));
