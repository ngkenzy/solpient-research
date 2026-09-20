import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { normalizeCompanyFacts, SEC_PROVIDER } from "../lib/sec-companyfacts.mjs";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");

const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const secContact=process.env.SEC_CONTACT??"ngkenzy@users.noreply.github.com";
const userAgent=process.env.SEC_USER_AGENT??("SOLPIENT Research "+secContact);
const outputFlag=process.argv.indexOf("--output");
const outputPath=outputFlag>=0?process.argv[outputFlag+1]:null;
const onlyTicker=process.env.COVERAGE_TICKER?String(process.env.COVERAGE_TICKER).toUpperCase():null;

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

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
        const error=new Error("SEC companyfacts HTTP 403");
        error.code="SEC_BLOCKED";
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
  try{
    const {endpoint,body}=await secJson(company.cik);
    const rows=normalizeCompanyFacts(body,{
      companyId:company.id,ticker:company.ticker,cik:company.cik,observedAt:new Date().toISOString()
    });
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
    summary.push({ticker:company.ticker,status:written>0?"success":"partial",rows:written,fiscal_years:years.length,latest_period:rows[0]?.period_end??null});
    console.log("SEC companyfacts",company.ticker,"rows="+written,"years="+years.length);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    await attemptFinish(attemptId,"failed",0,message,{ticker:company.ticker});
    summary.push({ticker:company.ticker,status:"failed",rows:0,error:message});
    console.warn("SEC companyfacts failed",company.ticker,message);
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
