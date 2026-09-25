import fs from "node:fs/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY?.trim()||process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");

const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const state=JSON.parse(await fs.readFile(new URL("../data/monitor/sec-state.json",import.meta.url),"utf8"));
const eventFile=JSON.parse(await fs.readFile(new URL("../data/monitor/sec-events.json",import.meta.url),"utf8"));
const events=Array.isArray(eventFile.events)?eventFile.events:[];

const {data:companies,error:companyError}=await sb
  .from("companies")
  .select("id,ticker,company_name")
  .order("ticker");
if(companyError)throw companyError;

const byTicker=new Map((companies??[]).map((row)=>[String(row.ticker).toUpperCase(),row]));
const summary=[];

for(const [tickerRaw,monitorState] of Object.entries(state.companies??{})){
  const ticker=String(tickerRaw).toUpperCase();
  const company=byTicker.get(ticker);
  if(!company){
    summary.push({ticker,status:"skipped",reason:"Ticker is not in canonical companies."});
    continue;
  }

  const checkedAt=monitorState?.checked_at??null;
  if(!checkedAt){
    summary.push({ticker,status:"skipped",reason:"No successful SEC check timestamp."});
    continue;
  }

  const companyEvents=events.filter((event)=>String(event.ticker??"").toUpperCase()===ticker);
  const filingEvents=companyEvents.filter((event)=>
    ["10-K","10-K/A","10-Q","10-Q/A","8-K","8-K/A"].includes(String(event.form??"").toUpperCase())
  );
  const ownershipEvents=companyEvents.filter((event)=>
    ["4","13F-HR","13F-HR/A"].includes(String(event.form??"").toUpperCase())
  );

  const filingRows=filingEvents
    .filter((event)=>event.filing_date&&event.accession_number)
    .map((event)=>({
      company_id:company.id,
      provider:"sec-direct-monitor",
      form_type:String(event.form).toUpperCase(),
      filed_at:event.filing_date,
      accepted_at:null,
      accession_number:event.accession_number,
      filing_url:event.source_url??null,
      period_end:event.report_date??null,
      title:event.label??null,
      raw_payload:{
        detected_at:event.detected_at??null,
        category:event.category??null,
        severity:event.severity??null,
        queue:event.queue??null,
        monitor_event_id:event.id??null,
      },
    }));

  if(filingRows.length){
    const {error}=await sb.from("filing_events").upsert(filingRows,{
      onConflict:"company_id,provider,form_type,filed_at,accession_number",
      ignoreDuplicates:false,
    });
    if(error)throw error;
  }

  const latestFilingEvidence=filingEvents
    .map((event)=>event.detected_at??(event.filing_date?event.filing_date+"T00:00:00.000Z":null))
    .filter(Boolean)
    .sort()
    .at(-1)??null;

  const latestOwnershipEvidence=ownershipEvents
    .map((event)=>event.detected_at??(event.filing_date?event.filing_date+"T00:00:00.000Z":null))
    .filter(Boolean)
    .sort()
    .at(-1)??null;

  const {error:secFreshnessError}=await sb.rpc("record_research_component_check_v1",{
    p_company_id:company.id,
    p_component_key:"sec_filings",
    p_last_checked_at:checkedAt,
    p_latest_evidence_at:latestFilingEvidence,
    p_supported:true,
    p_as_of:checkedAt,
  });
  if(secFreshnessError)throw secFreshnessError;

  const ownershipSupported=Array.isArray(monitorState?.ownership_seen_accessions);
  if(ownershipSupported){
    const {error:ownershipError}=await sb.rpc("record_research_component_check_v1",{
      p_company_id:company.id,
      p_component_key:"ownership",
      p_last_checked_at:checkedAt,
      p_latest_evidence_at:latestOwnershipEvidence,
      p_supported:true,
      p_as_of:checkedAt,
    });
    if(ownershipError)throw ownershipError;
  }

  const {error:refreshError}=await sb.rpc("refresh_research_foundation_state_v1",{
    p_company_id:company.id,
    p_as_of:checkedAt,
  });
  if(refreshError)throw refreshError;

  const {data:queued,error:queueError}=await sb.rpc("enqueue_due_research_maintenance_v1",{
    p_company_id:company.id,
    p_as_of:checkedAt,
  });
  if(queueError)throw queueError;

  summary.push({
    ticker,
    status:"success",
    checked_at:checkedAt,
    filing_events_upserted:filingRows.length,
    maintenance_items_queued:Number(queued??0),
  });
}

console.log(JSON.stringify({
  synchronized_at:new Date().toISOString(),
  source:"data/monitor/sec-state.json + sec-events.json",
  summary,
},null,2));
