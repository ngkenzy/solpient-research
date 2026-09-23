import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  closePostgresPool,
  pgMaybeOne,
  pgQuery,
  postgresConfigured,
  upsertObjects,
} from "../lib/postgres-node.mjs";

export const SEC_SUBMISSIONS_PROVIDER="sec_submissions";

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
    )value=value.slice(1,-1);
    return value||null;
  }
  return null;
}

function sleep(ms){
  return new Promise((resolve)=>setTimeout(resolve,ms));
}

function baseForm(value){
  return String(value??"").toUpperCase().replace(/\/A$/,"");
}

function isMaterialForm(value){
  return ["10-K","10-Q","8-K"].includes(baseForm(value));
}

function accessionPath(accession){
  return String(accession??"").replaceAll("-","");
}

function filingUrl(cik,accession,primaryDocument){
  if(!cik||!accession||!primaryDocument)return null;
  const cikNumber=String(Number(String(cik).replace(/\D/g,"")));
  if(!cikNumber||cikNumber==="NaN")return null;
  return "https://www.sec.gov/Archives/edgar/data/"+
    cikNumber+"/"+accessionPath(accession)+"/"+primaryDocument;
}

function rowsFromRecent(company,body){
  const recent=body?.filings?.recent??{};
  const accessions=Array.isArray(recent.accessionNumber)?recent.accessionNumber:[];
  const forms=Array.isArray(recent.form)?recent.form:[];
  const filed=Array.isArray(recent.filingDate)?recent.filingDate:[];
  const accepted=Array.isArray(recent.acceptanceDateTime)?recent.acceptanceDateTime:[];
  const report=Array.isArray(recent.reportDate)?recent.reportDate:[];
  const primaryDocs=Array.isArray(recent.primaryDocument)?recent.primaryDocument:[];
  const descriptions=Array.isArray(recent.primaryDocDescription)?recent.primaryDocDescription:[];

  const rows=[];
  for(let i=0;i<accessions.length;i+=1){
    const form=forms[i]??null;
    if(!isMaterialForm(form))continue;
    const accession=accessions[i]??null;
    if(!accession)continue;
    rows.push({
      company_id:company.id,
      provider:SEC_SUBMISSIONS_PROVIDER,
      form_type:form,
      filed_at:filed[i]??null,
      accepted_at:accepted[i]??null,
      accession_number:accession,
      filing_url:filingUrl(company.cik,accession,primaryDocs[i]),
      period_end:report[i]||null,
      title:descriptions[i]||baseForm(form)+" filing",
      raw_payload:{
        provider:SEC_SUBMISSIONS_PROVIDER,
        primary_document:primaryDocs[i]??null,
        base_form:baseForm(form),
      },
    });
  }
  return rows.filter((row)=>row.filed_at);
}

async function secSubmissions(company,userAgent,secContact){
  const cik=String(company.cik??"").replace(/\D/g,"").padStart(10,"0");
  const endpoint="https://data.sec.gov/submissions/CIK"+cik+".json";
  let lastError=null;
  for(let attempt=1;attempt<=3;attempt+=1){
    try{
      const response=await fetch(endpoint,{
        headers:{
          "User-Agent":userAgent,
          From:secContact,
          Accept:"application/json",
          "Accept-Encoding":"gzip, deflate",
        },
      });
      if(response.status===403){
        const error=new Error("SEC submissions HTTP 403 for "+company.ticker+".");
        error.code="SEC_BLOCKED";
        throw error;
      }
      if(response.status===429||response.status===503){
        await sleep(attempt*1500);
        continue;
      }
      if(!response.ok)throw new Error("SEC submissions HTTP "+response.status);
      return await response.json();
    }catch(error){
      lastError=error;
      if(error?.code==="SEC_BLOCKED")throw error;
      if(attempt<3)await sleep(attempt*1000);
    }
  }
  throw lastError??new Error("SEC submissions request failed.");
}

if(!postgresConfigured()){
  throw new Error("SOLPIENT_DATABASE_URL is not configured.");
}

const secContact=String(
  localEnvValue("SEC_CONTACT")??process.env.SEC_CONTACT??""
).trim();
const configuredUserAgent=String(
  localEnvValue("SEC_USER_AGENT")??process.env.SEC_USER_AGENT??""
).trim();
if(!secContact){
  throw new Error("Missing SEC_CONTACT in .env.local.");
}
const userAgent=configuredUserAgent||("Solpient Research "+secContact);

let automationRunId=null;

try{
  const candidateRun=await pgMaybeOne(
    "select id,candidate_count from public.research_candidate_pipeline_runs "+
      "order by evaluation_as_of desc nulls last,created_at desc limit 1"
  );
  if(!candidateRun||Number(candidateRun.candidate_count)!==100){
    throw new Error("SEC filing refresh requires a complete governed Solpient 100.");
  }

  const members=await pgQuery(
    "select upper(ticker) as ticker from public.research_candidate_pipeline_items "+
      "where research_candidate_pipeline_run_id=$1",
    [candidateRun.id],
  );
  const tickers=members.map((row)=>row.ticker);
  if(tickers.length!==100){
    throw new Error("SEC filing refresh found "+tickers.length+" governed tickers.");
  }

  const companies=await pgQuery(
    "select id,ticker,company_name,cik from public.companies "+
      "where upper(ticker)=any($1::text[]) order by ticker",
    [tickers],
  );

  const started=await pgQuery(
    "insert into public.automation_runs(pipeline,status,details) "+
      "values('sec_filings_solpient_100_v1','running',$1::jsonb) returning id",
    [JSON.stringify({
      provider:SEC_SUBMISSIONS_PROVIDER,
      candidate_pipeline_run_id:candidateRun.id,
      companies:companies.length,
    })],
  );
  automationRunId=started[0]?.id??null;

  const summary=[];
  let consecutiveBlocked=0;
  let inserted=0;

  for(const company of companies){
    if(!company.cik){
      summary.push({ticker:company.ticker,status:"skipped",reason:"missing_cik",new_filings:0});
      continue;
    }

    try{
      const body=await secSubmissions(company,userAgent,secContact);
      const rows=rowsFromRecent(company,body);

      const existing=await pgQuery(
        "select accession_number from public.filing_events "+
          "where company_id=$1 and provider=$2",
        [company.id,SEC_SUBMISSIONS_PROVIDER],
      );
      const seen=new Set(existing.map((row)=>row.accession_number).filter(Boolean));
      const fresh=rows.filter((row)=>!seen.has(row.accession_number));

      if(fresh.length){
        await upsertObjects(
          "filing_events",
          fresh,
          {
            conflict:[
              "company_id","provider","form_type","filed_at","accession_number"
            ],
            ignoreDuplicates:true,
          },
        );
      }

      inserted+=fresh.length;
      summary.push({
        ticker:company.ticker,
        status:"success",
        material_filings_seen:rows.length,
        new_filings:fresh.length,
        latest_filed_at:rows[0]?.filed_at??null,
      });
      consecutiveBlocked=0;
    }catch(error){
      summary.push({
        ticker:company.ticker,
        status:"failed",
        new_filings:0,
        error:error instanceof Error?error.message:String(error),
      });
      if(error?.code==="SEC_BLOCKED"){
        consecutiveBlocked+=1;
        if(consecutiveBlocked>=3)break;
      }else{
        consecutiveBlocked=0;
      }
    }

    await sleep(250);
  }

  const failures=summary.filter((row)=>row.status==="failed").length;
  const status=failures?"partial":"success";
  const details={
    provider:SEC_SUBMISSIONS_PROVIDER,
    candidate_pipeline_run_id:candidateRun.id,
    companies:companies.length,
    new_filings:inserted,
    failures,
    circuit_breaker_open:consecutiveBlocked>=3,
    summary,
  };

  if(automationRunId){
    await pgQuery(
      "update public.automation_runs "+
        "set status=$2,records_written=$3,message=$4,details=$5::jsonb,completed_at=now() "+
        "where id=$1",
      [
        automationRunId,status,inserted,
        inserted
          ? "Stored "+inserted+" new material SEC filing event(s)."
          : "No new material SEC filings detected.",
        JSON.stringify(details),
      ],
    );
  }

  console.log(JSON.stringify(details,null,2));
}catch(error){
  if(automationRunId){
    await pgQuery(
      "update public.automation_runs "+
        "set status='failed',message=$2,completed_at=now() where id=$1",
      [automationRunId,error instanceof Error?error.message:String(error)],
    ).catch(()=>{});
  }
  throw error;
}finally{
  await closePostgresPool();
}
