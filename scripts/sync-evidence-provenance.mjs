import process from "node:process";
// Main-push provenance workflow runs this synchronizer idempotently.
import { randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  sourceQualityClass,
  buildNormalizedFact,
  derivedFormulaForMetric,
} from "../lib/evidence-provenance.mjs";
import { sanitizeSourceUrl } from "../lib/baseline-factory.mjs";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY?.trim()||process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const onlyTicker=(process.env.COVERAGE_TICKER??process.argv.find((x)=>x.startsWith("--ticker="))?.split("=")[1]??"").toUpperCase()||null;

function hash(value){return createHash("sha256").update(String(value)).digest("hex");}
function uuidFromKey(value){
  const h=hash(value);
  const chars=h.slice(0,32).split("");
  chars[12]="5";
  chars[16]=((parseInt(chars[16],16)&3)|8).toString(16);
  const s=chars.join("");
  return [s.slice(0,8),s.slice(8,12),s.slice(12,16),s.slice(16,20),s.slice(20,32)].join("-");
}
function iso(value,fallback=null){
  if(!value)return fallback;
  const raw=String(value);
  const d=new Date(raw.length===10?raw+"T00:00:00.000Z":raw);
  return Number.isFinite(d.getTime())?d.toISOString():fallback;
}
function valueText(value){return value==null?null:String(value);}
function n(value){const x=Number(value);return Number.isFinite(x)?x:null;}

async function fetchAll(table,configure){
  const out=[];const size=1000;
  for(let page=0;page<100;page++){
    let q=sb.from(table).select("*").range(page*size,page*size+size-1);
    q=configure?q=configure(q):q;
    const {data,error}=await q;if(error)throw error;
    out.push(...(data??[]));
    if((data??[]).length<size)break;
  }
  return out;
}

function sourceRecord({companyId,provider,sourceType,title,url:sourceUrl,accessionNumber=null,formType=null,publicationAt=null,retrievedAt,documentIdentifier=null,sourceVersion=null,basis="reported",metadata={}}){
  const url=sanitizeSourceUrl(sourceUrl);
  const source_key=hash(JSON.stringify({
    origin:"canonical_sync_v1",
    companyId,provider,sourceType,title,url,accessionNumber,formType,publicationAt,retrievedAt,documentIdentifier,sourceVersion
  }));
  return {
    id:uuidFromKey("source:"+source_key),company_id:companyId,source_key,provider,source_type:sourceType,
    title:title??null,source_url:url,accession_number:accessionNumber,form_type:formType,
    publication_at:publicationAt,retrieved_at:retrievedAt,document_identifier:documentIdentifier,
    source_version:sourceVersion,source_quality_class:sourceQualityClass({provider,sourceType,url,basis}),
    visibility:"internal",metadata,created_at:retrievedAt
  };
}

function observationRecord({source,companyId,module="universal",metricKey,numeric=null,text=null,unit=null,periodStart=null,periodEnd=null,periodType=null,knownAt,provider,basis="reported",rawPayload={},sourceLocator={}}){
  const observation_key=hash(JSON.stringify({
    source_key:source.source_key,companyId,module,metricKey,numeric,text,unit,periodStart,periodEnd,periodType,knownAt,provider,basis
  }));
  return {
    id:uuidFromKey("observation:"+observation_key),source_id:source.id,company_id:companyId,
    observation_key,module,metric_key:metricKey,raw_value_numeric:numeric,raw_value_text:text,unit,
    economic_period_start:periodStart,economic_period_end:periodEnd,economic_period_type:periodType,
    observation_at:knownAt,known_at:knownAt,provider,basis,source_locator:sourceLocator,
    raw_payload:rawPayload,visibility:"internal",created_at:knownAt,
    source_quality_class:source.source_quality_class
  };
}

function pushMetric({sources,observations,companyId,provider,sourceType,title,url,accessionNumber=null,formType=null,publicationAt=null,retrievedAt,documentIdentifier=null,sourceVersion=null,module="universal",metricKey,numeric=null,text=null,unit=null,periodStart=null,periodEnd=null,periodType=null,basis="reported",rawPayload={},metadata={}}){
  if(numeric==null&&text==null)return;
  const source=sourceRecord({companyId,provider,sourceType,title,url,accessionNumber,formType,publicationAt,retrievedAt,documentIdentifier,sourceVersion,basis,metadata});
  if(!sources.has(source.source_key))sources.set(source.source_key,source);
  const obs=observationRecord({source:sources.get(source.source_key),companyId,module,metricKey,numeric,text,unit,periodStart,periodEnd,periodType,knownAt:retrievedAt,provider,basis,rawPayload,sourceLocator:{source_url:sanitizeSourceUrl(url),title}});
  observations.set(obs.observation_key,obs);
}

const {data:companies,error:companyError}=await sb.from("companies").select("id,ticker").order("ticker");
if(companyError)throw companyError;
const selected=(companies??[]).filter((c)=>!onlyTicker||c.ticker===onlyTicker);
const selectedIds=new Set(selected.map((c)=>c.id));
const sourceMap=new Map(),observationMap=new Map();

const [fundamentals,history,valuations,peers,consensus,capital,activity,events]=await Promise.all([
  fetchAll("fundamental_snapshots",(q)=>selected.length===1?q.eq("company_id",selected[0].id):q),
  fetchAll("company_metric_history",(q)=>selected.length===1?q.eq("company_id",selected[0].id):q),
  fetchAll("valuation_history",(q)=>selected.length===1?q.eq("company_id",selected[0].id):q),
  fetchAll("peer_metric_snapshots",(q)=>selected.length===1?q.eq("company_id",selected[0].id):q),
  fetchAll("consensus_snapshots",(q)=>selected.length===1?q.eq("company_id",selected[0].id):q),
  fetchAll("capital_allocation_history",(q)=>selected.length===1?q.eq("company_id",selected[0].id):q),
  fetchAll("capital_activity",(q)=>selected.length===1?q.eq("company_id",selected[0].id):q),
  fetchAll("intelligence_events",(q)=>selected.length===1?q.eq("company_id",selected[0].id):q),
]);

for(const row of fundamentals.filter((x)=>selectedIds.has(x.company_id))){
  const known=iso(row.observed_at,row.created_at),pub=row.filed_at?iso(row.filed_at):null;
  const common={sources:sourceMap,observations:observationMap,companyId:row.company_id,provider:row.provider??"unknown",sourceType:row.form??"Fundamental snapshot",title:[row.provider,row.form,row.fiscal_period,row.fiscal_year].filter(Boolean).join(" · "),url:row.source_url,formType:row.form,publicationAt:pub,retrievedAt:known,documentIdentifier:row.raw_payload?.accession_number??row.source_url??row.id,sourceVersion:known,periodEnd:row.period_end,periodType:String(row.fiscal_period??row.form??"period").toLowerCase(),rawPayload:{snapshot_id:row.id}};
  for(const [metricKey,unit] of [["revenue","USD"],["net_income","USD"],["operating_cash_flow","USD"],["capital_expenditure","USD"],["free_cash_flow","USD"],["shares_outstanding","shares"],["eps_diluted","USD/share"]]){
    pushMetric({...common,metricKey,numeric:n(row[metricKey]),unit,basis:"reported"});
  }
  const raw=row.raw_payload??{};
  const extra=[
    ["gross_profit",raw.income?.grossProfit,"USD"],
    ["operating_income",raw.income?.operatingIncome,"USD"],
    ["stock_based_compensation",raw.cash_flow?.stockBasedCompensation,"USD"],
    ["cash",raw.balance_sheet?.cashAndCashEquivalents??raw.cash_flow?.cashAtEndOfPeriod,"USD"],
    ["total_debt",raw.balance_sheet?.totalDebt,"USD"],
  ];
  for(const [metricKey,value,unit] of extra)pushMetric({...common,metricKey,numeric:n(value),unit,basis:"reported"});
}

for(const row of history.filter((x)=>selectedIds.has(x.company_id))){
  const known=iso(row.observed_at,row.created_at);
  pushMetric({
    sources:sourceMap,observations:observationMap,companyId:row.company_id,
    provider:"solpient_context_projection",sourceType:row.source_type??(row.basis==="derived"?"Solpient calculation":"Normalized history projection"),
    title:row.source_title??row.label,url:row.source_url,retrievedAt:known,documentIdentifier:"company_metric_history:"+row.id,sourceVersion:known,
    module:row.module??"universal",metricKey:row.metric_key,numeric:n(row.value_numeric),text:row.value_text??null,unit:row.unit,
    periodEnd:row.period_end,periodType:row.period_type,basis:row.basis??"reported",
    rawPayload:{projection_table:"company_metric_history",projection_id:row.id},
  });
}

for(const row of valuations.filter((x)=>selectedIds.has(x.company_id))){
  const known=iso(row.observed_at,row.created_at),common={
    sources:sourceMap,observations:observationMap,companyId:row.company_id,provider:row.provider??"market_provider",
    sourceType:"Point-in-time valuation projection",title:"Valuation snapshot "+row.trading_date,url:row.source_url,
    retrievedAt:known,documentIdentifier:"valuation_history:"+row.id,sourceVersion:known,module:"valuation_history",
    periodEnd:row.trading_date,periodType:"trading_day",basis:"derived",rawPayload:{projection_id:row.id}
  };
  for(const [metricKey,unit] of [["pe","x"],["forward_pe","x"],["ev_to_ebitda","x"],["price_to_fcf","x"],["fcf_yield","percent"],["market_cap","USD"],["enterprise_value","USD"]])
    pushMetric({...common,metricKey,numeric:n(row[metricKey]),unit});
}

for(const row of peers.filter((x)=>selectedIds.has(x.company_id))){
  const known=iso(row.observed_at,row.created_at);
  pushMetric({
    sources:sourceMap,observations:observationMap,companyId:row.company_id,provider:row.provider??"solpient_peer_context",
    sourceType:"Peer metric snapshot",title:row.peer_ticker+" "+row.metric_key,url:row.source_url,
    retrievedAt:known,documentIdentifier:"peer_metric_snapshot:"+row.id,sourceVersion:known,
    module:"peer:"+row.peer_ticker,metricKey:row.metric_key,numeric:n(row.value_numeric),text:row.value_text??null,
    unit:row.unit,periodEnd:row.as_of_date,periodType:"as_of",basis:"derived",rawPayload:{projection_id:row.id,peer_ticker:row.peer_ticker}
  });
}

for(const row of consensus.filter((x)=>selectedIds.has(x.company_id))){
  const known=iso(row.observed_at,row.created_at),common={
    sources:sourceMap,observations:observationMap,companyId:row.company_id,provider:row.provider??"consensus_provider",
    sourceType:"Consensus estimate snapshot",title:"Consensus snapshot",url:null,retrievedAt:known,
    documentIdentifier:"consensus_snapshot:"+row.id,sourceVersion:known,module:"consensus",periodType:"forward_estimate",
    basis:"estimated",rawPayload:{snapshot_id:row.id}
  };
  for(const [metricKey,unit] of [["revenue_next_fy","USD"],["eps_next_fy","USD/share"],["revenue_growth_next_fy","percent"],["eps_growth_next_fy","percent"],["analyst_count","count"]])
    pushMetric({...common,metricKey,numeric:n(row[metricKey]),unit});
}

for(const row of capital.filter((x)=>selectedIds.has(x.company_id))){
  const known=iso(row.observed_at,row.created_at),common={
    sources:sourceMap,observations:observationMap,companyId:row.company_id,provider:"solpient_capital_projection",
    sourceType:"Capital allocation history",title:row.source_title??"Capital allocation "+row.period_end,url:row.source_url,
    retrievedAt:known,documentIdentifier:"capital_allocation_history:"+row.id,sourceVersion:known,module:"capital_allocation",
    periodEnd:row.period_end,periodType:"fiscal_period",basis:"derived",rawPayload:{projection_id:row.id}
  };
  for(const [metricKey,unit] of [["dividends_paid","USD"],["buybacks","USD"],["stock_based_compensation","USD"],["acquisitions","USD"],["debt_issued","USD"],["debt_repaid","USD"],["ending_share_count","shares"],["retained_earnings","USD"]])
    pushMetric({...common,metricKey,numeric:n(row[metricKey]),unit});
}

for(const row of activity.filter((x)=>selectedIds.has(x.company_id))){
  const known=iso(row.verified_at??row.created_at,row.created_at);
  pushMetric({
    sources:sourceMap,observations:observationMap,companyId:row.company_id,provider:row.provider??"capital_activity_provider",
    sourceType:"Ownership/capital disclosure",title:[row.activity_type,row.actor_name,row.action].filter(Boolean).join(" · "),url:row.source_url,
    publicationAt:row.disclosure_date?iso(row.disclosure_date):null,retrievedAt:known,documentIdentifier:row.source_key??row.id,sourceVersion:known,
    module:"capital_activity",metricKey:[row.activity_type,row.actor_name].filter(Boolean).join(":").slice(0,180),
    numeric:n(row.value??row.shares),text:row.amount_range??row.action??null,unit:row.value!=null?"USD":row.shares!=null?"shares":null,
    periodEnd:row.transaction_date??row.position_date??row.disclosure_date??null,periodType:"event",basis:"reported",
    rawPayload:{activity_id:row.id,action:row.action,shares:row.shares,value:row.value,change_pct:row.change_pct}
  });
}

for(const row of events.filter((x)=>selectedIds.has(x.company_id))){
  const known=iso(row.disclosed_at??row.created_at,row.created_at);
  pushMetric({
    sources:sourceMap,observations:observationMap,companyId:row.company_id,provider:String(row.source_kind??"intelligence"),
    sourceType:"Intelligence event",title:row.title,url:row.source_url,publicationAt:row.disclosed_at?iso(row.disclosed_at):null,
    retrievedAt:known,documentIdentifier:row.source_id??row.id,sourceVersion:known,module:"intelligence_event",
    metricKey:String(row.event_type??"event"),text:row.summary??row.title,periodEnd:row.occurred_at??null,periodType:"event",basis:"reported",
    rawPayload:{event_id:row.id,materiality:row.materiality,metadata:row.metadata}
  });
}

const sources=[...sourceMap.values()];
const observations=[...observationMap.values()].map(({source_quality_class,...row})=>row);
for(let i=0;i<Math.max(sources.length,observations.length);i+=400){
  const sourceChunk=sources.slice(i,i+400),obsChunk=observations.slice(i,i+400);
  if(!sourceChunk.length&&!obsChunk.length)continue;
  const {error}=await sb.rpc("ingest_evidence_batch_v1",{
    p_sources:sourceChunk,p_observations:obsChunk,p_facts:[],p_fact_observations:[],p_fact_inputs:[]
  });
  if(error)throw error;
}

// Re-read canonical observations so conflict detection includes all historical provider versions.
const allObs=[];
for(const company of selected){
  const rows=await fetchAll("evidence_observations",(q)=>q.eq("company_id",company.id).order("known_at",{ascending:true}));
  if(!rows.length)continue;
  const sourceIds=[...new Set(rows.map((r)=>r.source_id))];
  const sourceRows=[];
  for(let i=0;i<sourceIds.length;i+=500){
    const {data,error}=await sb.from("evidence_sources").select("id,source_quality_class").in("id",sourceIds.slice(i,i+500));
    if(error)throw error;sourceRows.push(...(data??[]));
  }
  const quality=new Map(sourceRows.map((r)=>[r.id,r.source_quality_class]));
  allObs.push(...rows.map((r)=>({...r,source_quality_class:quality.get(r.source_id)??"verified_secondary"})));
}

const groups=new Map();
for(const row of allObs){
  const key=[row.company_id,row.module,row.metric_key,row.economic_period_start??"",row.economic_period_end??"",row.economic_period_type??""].join("|");
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(row);
}

const existingFactsRaw=await fetchAll("normalized_facts",(q)=>q.select("id,fact_key,company_id,module,metric_key,value_numeric,unit,economic_period_end,economic_period_type,known_at,source_confidence_class,conflict_state,supersedes_fact_id,formula_identifier,derivation_basis"));
const factByKey=new Map(existingFactsRaw.map((r)=>[r.fact_key,r]));
let factsPrepared=0;
let observationLinksPrepared=0;
let factBuffer=[];
let observationLinkBuffer=[];

async function flushFactBuffers(){
  if(!factBuffer.length&&!observationLinkBuffer.length)return;
  const {error}=await sb.rpc("ingest_evidence_batch_v1",{
    p_sources:[],p_observations:[],p_facts:factBuffer,
    p_fact_observations:observationLinkBuffer,p_fact_inputs:[]
  });
  if(error)throw error;
  factBuffer=[];
  observationLinkBuffer=[];
}

for(const rows of groups.values()){
  const sample=rows[0];
  const eventTimes=[...new Set(rows.map((row)=>row.known_at).filter(Boolean))].sort();
  let previousFactId=null;

  for(const eventTime of eventTimes){
    const eligible=rows.filter((row)=>String(row.known_at)<=String(eventTime));
    const built=buildNormalizedFact({
      companyId:sample.company_id,module:sample.module,metricKey:sample.metric_key,unit:sample.unit,
      economicPeriodStart:sample.economic_period_start,economicPeriodEnd:sample.economic_period_end,
      economicPeriodType:sample.economic_period_type,observations:eligible,
      derivationBasis:sample.basis==="derived"?"Canonicalized from Solpient/provider projection.":null,
      formulaIdentifier:derivedFormulaForMetric(sample.metric_key)?.formula_identifier??null,
      calculationEngineVersion:sample.basis==="derived"?"evidence-provenance-v1":null,
      calculatedAt:sample.basis==="derived"?eventTime:null,
      supersedesFactId:previousFactId,
      supersessionReason:previousFactId?"New source evidence became known at "+eventTime+".":null,
    });
    if(!built)continue;
    const existing=factByKey.get(built.fact.fact_key);
    const factId=existing?.id??built.fact.id;
    if(!existing){
      factBuffer.push(built.fact);
      factByKey.set(built.fact.fact_key,{...built.fact,id:factId});
      factsPrepared+=1;
    }
    for(const link of built.observationLinks){
      observationLinkBuffer.push({...link,normalized_fact_id:factId});
      observationLinksPrepared+=1;
    }
    previousFactId=factId;

    if(factBuffer.length>=250||observationLinkBuffer.length>=750){
      await flushFactBuffers();
    }
  }
}
await flushFactBuffers();

// Re-read facts after streaming so derived lineage and frozen legacy history use
// exactly what is now present in the canonical ledger.
const facts=await fetchAll("normalized_facts",(q)=>q
  .select("id,company_id,module,metric_key,value_numeric,unit,economic_period_end,economic_period_type,known_at,source_confidence_class,conflict_state,supersedes_fact_id,formula_identifier,derivation_basis")
  .order("known_at",{ascending:true})
);

const factsByMetric=new Map();
const factsByCompany=new Map();
for(const fact of facts){
  const metricKey=[fact.company_id,fact.module,fact.metric_key].join("|");
  const metricRows=factsByMetric.get(metricKey)??[];
  metricRows.push(fact);
  factsByMetric.set(metricKey,metricRows);

  const companyRows=factsByCompany.get(fact.company_id)??[];
  companyRows.push(fact);
  factsByCompany.set(fact.company_id,companyRows);
}
for(const rows of factsByMetric.values()){
  rows.sort((a,b)=>
    String(b.economic_period_end??"").localeCompare(String(a.economic_period_end??"")) ||
    String(b.known_at??"").localeCompare(String(a.known_at??""))
  );
}

// Derived facts link to the latest eligible input facts known at the same time.
// Use a metric index instead of repeatedly scanning the full fact universe.
let derivedInputLinksPrepared=0;
let inputLinkBuffer=[];
async function flushInputLinks(){
  if(!inputLinkBuffer.length)return;
  const {error}=await sb.rpc("ingest_evidence_batch_v1",{
    p_sources:[],p_observations:[],p_facts:[],p_fact_observations:[],p_fact_inputs:inputLinkBuffer
  });
  if(error)throw error;
  inputLinkBuffer=[];
}

for(const fact of facts){
  const formula=derivedFormulaForMetric(fact.metric_key);
  if(!formula||!fact.derivation_basis)continue;
  const used=new Set();
  for(const [index,inputMetric] of formula.inputs.entries()){
    const universal=factsByMetric.get([fact.company_id,"universal",inputMetric].join("|"))??[];
    const valuation=factsByMetric.get([fact.company_id,"valuation_history",inputMetric].join("|"))??[];
    const candidates=universal.length?universal:valuation;
    const chosen=candidates.find((candidate)=>
      candidate.id!==fact.id &&
      String(candidate.known_at)<=String(fact.known_at) &&
      (!fact.economic_period_end||!candidate.economic_period_end||String(candidate.economic_period_end)<=String(fact.economic_period_end)) &&
      !used.has(candidate.id)
    );
    if(chosen){
      used.add(chosen.id);
      inputLinkBuffer.push({
        normalized_fact_id:fact.id,input_fact_id:chosen.id,
        input_role:"formula_input",input_order:index,created_at:fact.known_at
      });
      derivedInputLinksPrepared+=1;
      if(inputLinkBuffer.length>=500)await flushInputLinks();
    }
  }
}
await flushInputLinks();

const PUBLIC_HISTORY_METRICS={
  universal:new Set([
    "revenue","free_cash_flow","gross_margin","operating_margin","fcf_margin",
    "eps_diluted","fcf_per_share","shares_outstanding","dividends_paid","buybacks",
    "stock_based_compensation","acquisitions","debt_issued","debt_repaid"
  ]),
  valuation_history:new Set(["pe","forward_pe","price_to_fcf","fcf_yield"]),
  capital_allocation:new Set([
    "dividends_paid","buybacks","stock_based_compensation","acquisitions",
    "debt_issued","debt_repaid","ending_share_count"
  ]),
  peer:new Set(["revenue_growth_yoy","fcf_margin","price_to_fcf","fcf_yield"]),
};
function publicHistoryAllowed(fact){
  if(fact.module==="universal")return PUBLIC_HISTORY_METRICS.universal.has(fact.metric_key);
  if(fact.module==="valuation_history")return PUBLIC_HISTORY_METRICS.valuation_history.has(fact.metric_key);
  if(fact.module==="capital_allocation")return PUBLIC_HISTORY_METRICS.capital_allocation.has(fact.metric_key);
  if(String(fact.module??"").startsWith("peer:"))return PUBLIC_HISTORY_METRICS.peer.has(fact.metric_key);
  return false;
}

// Existing Phase 1/legacy publications predate the Phase 2 freeze trigger.
// Freeze a sanitized as-of history snapshot without fabricating a research-input manifest.
const publishedRuns=await fetchAll("research_runs",(q)=>q
  .select("id,company_id,data_cutoff_at,researched_at,published_at,status")
  .eq("status","published")
);
let publicHistoryPrepared=0;
for(const run of publishedRuns){
  const cutoff=iso(run.data_cutoff_at??run.researched_at);
  if(!cutoff)continue;
  const eligible=(factsByCompany.get(run.company_id)??[]).filter((fact)=>
    fact.known_at&&String(fact.known_at)<=cutoff&&
    fact.conflict_state!=="superseded"&&publicHistoryAllowed(fact)
  );
  const supersededAsOf=new Set(
    eligible.map((fact)=>fact.supersedes_fact_id).filter(Boolean)
  );
  const rows=eligible
    .filter((fact)=>!supersededAsOf.has(fact.id))
    .map((fact)=>({
      research_run_id:run.id,
      company_id:run.company_id,
      module:fact.module,
      metric_key:fact.metric_key,
      value_numeric:fact.value_numeric??null,
      unit:fact.unit??null,
      economic_period_end:fact.economic_period_end??null,
      economic_period_type:fact.economic_period_type??null,
      known_at:fact.known_at,
      source_confidence_class:fact.source_confidence_class??null,
      conflict_state:fact.conflict_state??null,
      created_at:run.published_at??run.researched_at??new Date().toISOString(),
    }));
  for(let i=0;i<rows.length;i+=500){
    const chunk=rows.slice(i,i+500);
    const {error}=await sb.from("research_public_history_items").upsert(chunk,{
      onConflict:"research_run_id,module,metric_key,economic_period_end,economic_period_type,known_at",
      ignoreDuplicates:true,
    });
    if(error)throw error;
    publicHistoryPrepared+=chunk.length;
  }
}

const completedAt=new Date().toISOString();
const recordsWritten=factsPrepared+observationLinksPrepared+derivedInputLinksPrepared+publicHistoryPrepared;
const {error:automationError}=await sb.from("automation_runs").insert({
  pipeline:"evidence_provenance",
  started_at:completedAt,
  completed_at:completedAt,
  status:"success",
  records_written:recordsWritten,
  message:"Canonical provenance sync completed; facts and frozen legacy history are current."
});
if(automationError)throw automationError;

console.log(JSON.stringify({
  provenance_version:"evidence-provenance-v1",
  companies:selected.length,
  sources_prepared:sources.length,
  observations_prepared:observations.length,
  facts_prepared:factsPrepared,
  observation_links_prepared:observationLinksPrepared,
  derived_input_links_prepared:derivedInputLinksPrepared,
  public_history_rows_prepared:publicHistoryPrepared,
  ticker:onlyTicker
},null,2));
