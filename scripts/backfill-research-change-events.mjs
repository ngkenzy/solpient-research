import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { buildResearchChanges } from "../lib/research-changes.mjs";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const now=new Date().toISOString();

function impact(change){
  const key=String(change.metric_key??"");
  const direction=change.direction;
  if(change.category==="valuation"||change.category==="score")return direction==="up"?"improving":direction==="down"?"weakening":"neutral";
  if(change.category==="market")return direction==="down"?"improving":direction==="up"?"weakening":"neutral";
  if(change.category==="financial"){
    if(["debt_to_equity","total_debt"].includes(key))return direction==="down"?"improving":direction==="up"?"weakening":"neutral";
    if(["revenue_growth_1y","revenue_cagr_5y","gross_margin","operating_margin","net_margin","fcf_margin","roe","roic","roa","eps_growth_1y"].includes(key))
      return direction==="up"?"improving":direction==="down"?"weakening":"neutral";
    return"neutral";
  }
  if(change.category==="thesis"){
    if(direction==="strengthened")return"improving";
    if(direction==="weakened")return"weakening";
    return"monitor";
  }
  return"neutral";
}
function title(ticker,change,decisionImpact){
  if(decisionImpact==="improving")return ticker+": "+change.label+" improved";
  if(decisionImpact==="weakening")return ticker+": "+change.label+" weakened";
  return ticker+": "+change.label+" changed";
}

const {data:companies,error:companyError}=await sb.from("companies").select("id,ticker").order("ticker");
if(companyError)throw companyError;
let written=0;

for(const company of companies??[]){
  const {data:runs,error:runError}=await sb
    .from("research_runs")
    .select("id,version,researched_at,price_at_research")
    .eq("company_id",company.id)
    .eq("status","published")
    .order("version",{ascending:true});
  if(runError)throw runError;
  if((runs??[]).length<2)continue;

  for(let i=1;i<runs.length;i++){
    const previousRun=runs[i-1],currentRun=runs[i];
    const [prevMetricsR,currMetricsR,prevScoresR,currScoresR,prevValR,currValR,prevThesisR,currThesisR]=await Promise.all([
      sb.from("financial_metrics").select("*").eq("research_run_id",previousRun.id).maybeSingle(),
      sb.from("financial_metrics").select("*").eq("research_run_id",currentRun.id).maybeSingle(),
      sb.from("scores").select("*").eq("research_run_id",previousRun.id).maybeSingle(),
      sb.from("scores").select("*").eq("research_run_id",currentRun.id).maybeSingle(),
      sb.from("valuations").select("*").eq("research_run_id",previousRun.id).maybeSingle(),
      sb.from("valuations").select("*").eq("research_run_id",currentRun.id).maybeSingle(),
      sb.from("thesis_variables").select("*").eq("research_run_id",previousRun.id),
      sb.from("thesis_variables").select("*").eq("research_run_id",currentRun.id),
    ]);
    for(const q of [prevMetricsR,currMetricsR,prevScoresR,currScoresR,prevValR,currValR,prevThesisR,currThesisR])if(q.error)throw q.error;

    const changes=buildResearchChanges({
      companyId:company.id,
      currentRunId:currentRun.id,
      previousRun,
      payload:{
        research:{price_at_research:currentRun.price_at_research},
        financial_metrics:currMetricsR.data??{},
        scores:currScoresR.data??{},
        valuations:currValR.data??{},
        thesis_variables:currThesisR.data??[],
      },
      previousMetrics:prevMetricsR.data,
      previousScores:prevScoresR.data,
      previousValuation:prevValR.data,
      previousThesis:prevThesisR.data??[],
    });
    if(!changes.length)continue;

    const occurredAt=String(currentRun.researched_at??now).slice(0,10);
    const rows=changes.map(change=>({
      company_id:company.id,
      current_snapshot_id:null,
      previous_snapshot_id:null,
      research_run_id:currentRun.id,
      event_key:"researchdiff:"+currentRun.id+":"+change.metric_key+":"+change.change_type,
      category:change.category,
      metric_key:change.metric_key,
      label:change.label,
      old_value:change.old_value??null,
      new_value:change.new_value??null,
      delta_value:change.delta_value??null,
      delta_percent:change.delta_percent??null,
      old_text:change.old_text??null,
      new_text:change.new_text??null,
      direction:change.direction??"changed",
      materiality:change.materiality==="material"?"material":change.materiality??"notable",
      decision_impact:impact(change),
      summary:change.summary,
      source_kind:"research_version",
      source_id:currentRun.id,
      source_url:null,
      occurred_at:occurredAt,
      updated_at:now,
    }));
    const {data:stored,error}=await sb.from("company_change_events")
      .upsert(rows,{onConflict:"company_id,event_key,occurred_at"})
      .select("*");
    if(error)throw error;
    written+=(stored??[]).length;

    for(const event of stored??[]){
      if(!["high","material"].includes(event.materiality))continue;
      const decisionImpact=event.decision_impact;
      const {error:intelligenceError}=await sb.from("intelligence_events").upsert({
        company_id:company.id,
        source_kind:"research_change",
        source_id:event.id,
        event_type:event.category,
        occurred_at:event.occurred_at,
        disclosed_at:currentRun.researched_at??now,
        title:title(company.ticker,event,decisionImpact),
        summary:event.summary,
        materiality:event.materiality==="high"?"high":"review",
        review_status:["weakening","monitor"].includes(decisionImpact)?"open":"incorporated",
        research_run_id:currentRun.id,
        source_url:null,
        metadata:{
          event_key:event.event_key,
          metric_key:event.metric_key,
          decision_impact:decisionImpact,
          direction:event.direction,
          historical_backfill:true,
        },
        updated_at:now,
      },{onConflict:"source_kind,source_id"});
      if(intelligenceError)throw intelligenceError;
    }
  }
}

console.log(JSON.stringify({backfilled_change_events:written},null,2));
