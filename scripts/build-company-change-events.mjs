import { createHash } from "node:crypto";
import process from "node:process";
import { createPostgresCompatClient } from "../lib/pg-supabase-compat.mjs";
import { buildCompanyChangeEvents, summarizeDecisionImpact, COMPANY_STATE_VERSION } from "../lib/company-change-engine.mjs";

if(!process.env.SOLPIENT_DATABASE_URL && typeof process.loadEnvFile==="function"){
  try{process.loadEnvFile(".env.local");}catch{}
}
if(!process.env.SOLPIENT_DATABASE_URL)throw new Error("Missing SOLPIENT_DATABASE_URL.");
const sb=createPostgresCompatClient();
const onlyTicker=process.env.CHANGE_TICKER?String(process.env.CHANGE_TICKER).toUpperCase():null;
const now=new Date().toISOString();
const today=now.slice(0,10);

function n(value){const x=Number(value);return Number.isFinite(x)?x:null;}
function stableHash(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
function discountToFair(price,fair){return price!=null&&fair!=null&&fair!==0?(fair-price)/fair*100:null;}
function latestByObserved(rows=[]){
  return [...rows].sort((a,b)=>String(b.observed_at??b.created_at??"").localeCompare(String(a.observed_at??a.created_at??"")))[0]??null;
}
function eventTitle(ticker,event){
  if(event.category==="filing")return ticker+": "+event.label;
  if(event.decision_impact==="improving")return ticker+": "+event.label+" improved";
  if(event.decision_impact==="weakening")return ticker+": "+event.label+" weakened";
  return ticker+": "+event.label+" changed";
}

const {data:companies,error:companiesError}=await sb
  .from("companies")
  .select("id,ticker,company_name")
  .order("ticker");
if(companiesError)throw companiesError;

const runStart=await sb.from("automation_runs").insert({
  pipeline:"company_change_engine",
  started_at:now,
  status:"running",
  records_written:0,
  message:"Capturing company states and detecting material changes.",
  details:{state_version:COMPANY_STATE_VERSION,ticker:onlyTicker}
}).select("id").single();
if(runStart.error)throw runStart.error;

let snapshotsWritten=0,eventsWritten=0,unchanged=0,failures=0;
const summary=[];

for(const company of (companies??[]).filter(c=>!onlyTicker||c.ticker===onlyTicker)){
  try{
    const {data:run,error:runError}=await sb
      .from("research_runs")
      .select("id,version,researched_at,price_at_research,summary")
      .eq("company_id",company.id)
      .eq("status","published")
      .order("version",{ascending:false})
      .limit(1)
      .maybeSingle();
    if(runError)throw runError;

    const queries=[
      sb.from("market_snapshots").select("price,trading_date,provider").eq("company_id",company.id).order("trading_date",{ascending:false}).limit(1).maybeSingle(),
      run?.id?sb.from("valuations").select("*").eq("research_run_id",run.id).maybeSingle():Promise.resolve({data:null,error:null}),
      run?.id?sb.from("financial_metrics").select("*").eq("research_run_id",run.id).maybeSingle():Promise.resolve({data:null,error:null}),
      run?.id?sb.from("scores").select("*").eq("research_run_id",run.id).maybeSingle():Promise.resolve({data:null,error:null}),
      run?.id?sb.from("thesis_variables").select("variable_name,status,observed_value,expectation").eq("research_run_id",run.id):Promise.resolve({data:[],error:null}),
      run?.id?sb.from("expected_return_scenarios").select("scenario,horizon_years,expected_cagr").eq("research_run_id",run.id):Promise.resolve({data:[],error:null}),
      sb.from("valuation_history").select("trading_date,price_to_fcf,fcf_yield").eq("company_id",company.id).order("trading_date",{ascending:false}).limit(1).maybeSingle(),
      sb.from("consensus_snapshots").select("*").eq("company_id",company.id).order("observed_at",{ascending:false}).limit(1).maybeSingle(),
      sb.from("data_coverage_reports").select("decision_readiness_pct,overall_pct,as_of_date").eq("company_id",company.id).eq("engine_version","coverage-v2").order("as_of_date",{ascending:false}).order("generated_at",{ascending:false}).limit(1).maybeSingle(),
      sb.from("filing_events").select("accession_number,form_type,filed_at,filing_url,title").eq("company_id",company.id).in("form_type",["10-K","10-Q","8-K"]).order("filed_at",{ascending:false}).limit(1).maybeSingle(),
      sb.from("company_state_snapshots").select("*").eq("company_id",company.id).eq("state_version",COMPANY_STATE_VERSION).order("observed_at",{ascending:false}).limit(1).maybeSingle(),
    ];
    const [marketR,valR,metricsR,scoresR,thesisR,returnsR,valHistR,consensusR,coverageR,filingR,prevR]=await Promise.all(queries);
    for(const q of [marketR,valR,metricsR,scoresR,thesisR,returnsR,valHistR,consensusR,coverageR,filingR,prevR])if(q.error)throw q.error;

    const marketPrice=n(marketR.data?.price)??n(run?.price_at_research);
    const baseValue=n(valR.data?.base_value);
    const baseReturn=(returnsR.data??[]).find(x=>x.scenario==="base"&&Number(x.horizon_years)===5);
    const state={
      research:{
        run_id:run?.id??null,
        version:run?.version??null,
        researched_at:run?.researched_at??null,
      },
      market:{
        price:marketPrice,
        trading_date:marketR.data?.trading_date??null,
        provider:marketR.data?.provider??null,
      },
      valuation:{
        base_value:baseValue,
        bear_value:n(valR.data?.bear_value),
        bull_value:n(valR.data?.bull_value),
        mos_25_price:n(valR.data?.mos_25_price),
        mos_35_price:n(valR.data?.mos_35_price),
        discount_to_fair_value:discountToFair(marketPrice,baseValue),
        price_to_fcf:n(valHistR.data?.price_to_fcf)??n(metricsR.data?.price_to_fcf),
        fcf_yield:n(valHistR.data?.fcf_yield)??n(metricsR.data?.fcf_yield),
        valuation_date:valHistR.data?.trading_date??marketR.data?.trading_date??null,
      },
      returns:{
        base_5y_cagr:n(baseReturn?.expected_cagr),
      },
      consensus:{
        observed_at:consensusR.data?.observed_at??null,
        provider:consensusR.data?.provider??null,
        eps_next_fy:n(consensusR.data?.eps_next_fy),
        revenue_next_fy:n(consensusR.data?.revenue_next_fy),
        eps_growth_next_fy:n(consensusR.data?.eps_growth_next_fy),
        revenue_growth_next_fy:n(consensusR.data?.revenue_growth_next_fy),
        analyst_count:n(consensusR.data?.analyst_count),
      },
      financial:{
        revenue_growth_1y:n(metricsR.data?.revenue_growth_1y),
        fcf_margin:n(metricsR.data?.fcf_margin),
        debt_to_equity:n(metricsR.data?.debt_to_equity),
        total_debt:n(metricsR.data?.total_debt),
      },
      scores:{
        overall_score:n(scoresR.data?.overall_score),
        thesis_integrity_score:n(scoresR.data?.thesis_integrity_score),
      },
      coverage:{
        decision_readiness_pct:n(coverageR.data?.decision_readiness_pct)??n(coverageR.data?.overall_pct),
        as_of_date:coverageR.data?.as_of_date??null,
      },
      thesis:(thesisR.data??[]).map(x=>({
        variable_name:x.variable_name,
        status:x.status,
        observed_value:x.observed_value,
        expectation:x.expectation,
      })),
      filing:filingR.data??null,
    };
    const hash=stableHash(state);
    const previous=prevR.data??null;
    if(previous?.state_hash===hash){
      unchanged+=1;
      summary.push({ticker:company.ticker,status:"unchanged",events:0});
      continue;
    }

    const {data:snapshot,error:snapshotError}=await sb
      .from("company_state_snapshots")
      .upsert({
        company_id:company.id,
        research_run_id:run?.id??null,
        state_version:COMPANY_STATE_VERSION,
        snapshot_date:today,
        observed_at:now,
        state_hash:hash,
        state_payload:state,
        updated_at:now,
      },{onConflict:"company_id,state_version,state_hash"})
      .select("id,observed_at,state_payload")
      .single();
    if(snapshotError)throw snapshotError;
    snapshotsWritten+=1;

    const events=buildCompanyChangeEvents({
      companyId:company.id,
      currentSnapshotId:snapshot.id,
      previousSnapshotId:previous?.id??null,
      researchRunId:run?.id??null,
      current:state,
      previous:previous?.state_payload??null,
      occurredAt:today,
    });

    let stored=[];
    if(events.length){
      const {data,error}=await sb
        .from("company_change_events")
        .upsert(events,{onConflict:"company_id,event_key,occurred_at"})
        .select("*");
      if(error)throw error;
      stored=data??[];
      eventsWritten+=stored.length;
    }

    for(const event of stored.filter(e=>["high","material"].includes(e.materiality))){
      const intelligence={
        company_id:company.id,
        source_kind:"research_change",
        source_id:event.id,
        event_type:event.category,
        occurred_at:event.occurred_at,
        disclosed_at:now,
        title:eventTitle(company.ticker,event),
        summary:event.summary,
        materiality:event.materiality==="high"?"high":"review",
        review_status:["weakening","monitor"].includes(event.decision_impact)?"open":"incorporated",
        research_run_id:run?.id??null,
        source_url:event.source_url??null,
        metadata:{
          event_key:event.event_key,
          metric_key:event.metric_key,
          decision_impact:event.decision_impact,
          direction:event.direction,
          old_value:event.old_value,
          new_value:event.new_value,
          delta_percent:event.delta_percent,
        },
        updated_at:now,
      };
      const {error}=await sb.from("intelligence_events").upsert(intelligence,{onConflict:"source_kind,source_id"});
      if(error)throw error;
    }

    summary.push({ticker:company.ticker,status:previous?"changed":"baseline",events:stored.length,impact:summarizeDecisionImpact(stored)});
  }catch(error){
    failures+=1;
    summary.push({ticker:company.ticker,status:"failed",error:error instanceof Error?error.message:String(error)});
  }
}

const finalStatus=failures?"partial":"success";
const completedAt=new Date().toISOString();
await sb.from("automation_runs").update({
  status:finalStatus,
  completed_at:completedAt,
  records_written:eventsWritten,
  message:"Company change engine captured "+snapshotsWritten+" state snapshot(s) and "+eventsWritten+" material event(s).",
  details:{state_version:COMPANY_STATE_VERSION,snapshots:snapshotsWritten,events:eventsWritten,unchanged,failures,summary},
}).eq("id",runStart.data.id);

console.log(JSON.stringify({generated_at:completedAt,state_version:COMPANY_STATE_VERSION,snapshots:snapshotsWritten,events:eventsWritten,unchanged,failures,summary},null,2));
