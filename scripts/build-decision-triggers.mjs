import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { buildDecisionTriggers, summarizeDecisionTriggers, DECISION_TRIGGER_VERSION } from "../lib/decision-trigger-engine.mjs";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const onlyTicker=process.env.DECISION_TRIGGER_TICKER?String(process.env.DECISION_TRIGGER_TICKER).toUpperCase():null;
const now=new Date().toISOString();

const runStart=await sb.from("automation_runs").insert({
  pipeline:"decision_trigger_engine",
  started_at:now,
  status:"running",
  records_written:0,
  message:"Evaluating company decision triggers.",
  details:{trigger_version:DECISION_TRIGGER_VERSION,ticker:onlyTicker}
}).select("id").single();
if(runStart.error)throw runStart.error;

const {data:companies,error:companyError}=await sb
  .from("companies")
  .select("id,ticker,company_name")
  .order("ticker");
if(companyError)throw companyError;

let written=0,transitionEvents=0,failures=0;
const summary=[];

for(const company of (companies??[]).filter(c=>!onlyTicker||c.ticker===onlyTicker)){
  try{
    const {data:run,error:runError}=await sb
      .from("research_runs")
      .select("id,version")
      .eq("company_id",company.id)
      .eq("status","published")
      .order("version",{ascending:false})
      .limit(1)
      .maybeSingle();
    if(runError)throw runError;
    if(!run){
      summary.push({ticker:company.ticker,status:"no_published_research"});
      continue;
    }

    const [marketR,valuationR,returnsR,thesisR,metricsR,obsR,coverageR,existingR]=await Promise.all([
      sb.from("market_snapshots").select("price,trading_date").eq("company_id",company.id).order("trading_date",{ascending:false}).limit(1).maybeSingle(),
      sb.from("valuations").select("*").eq("research_run_id",run.id).maybeSingle(),
      sb.from("expected_return_scenarios").select("*").eq("research_run_id",run.id),
      sb.from("thesis_variables").select("*").eq("research_run_id",run.id),
      sb.from("financial_metrics").select("*").eq("research_run_id",run.id).maybeSingle(),
      sb.from("metric_observations").select("id,module,metric_key,label,value_numeric,unit,period_end,status").eq("research_run_id",run.id),
      sb.from("data_coverage_reports").select("decision_readiness_pct,overall_pct,as_of_date").eq("company_id",company.id).eq("engine_version","coverage-v2").order("as_of_date",{ascending:false}).order("generated_at",{ascending:false}).limit(1).maybeSingle(),
      sb.from("decision_triggers").select("*").eq("research_run_id",run.id),
    ]);
    for(const r of [marketR,valuationR,returnsR,thesisR,metricsR,obsR,coverageR,existingR])if(r.error)throw r.error;

    const triggers=buildDecisionTriggers({
      currentPrice:marketR.data?.price??null,
      valuation:valuationR.data??{},
      expectedReturns:returnsR.data??[],
      thesisVariables:thesisR.data??[],
      metricObservations:obsR.data??[],
      financialMetrics:metricsR.data??{},
      coverage:coverageR.data??null,
    });

    const existingByKey=new Map((existingR.data??[]).map(row=>[row.trigger_key,row]));
    const activeKeys=new Set(triggers.map(t=>t.trigger_key));

    for(const trigger of triggers){
      const existing=existingByKey.get(trigger.trigger_key);
      const transitioned=trigger.evaluation_status==="triggered"&&existing?.evaluation_status!=="triggered";
      const firstTriggeredAt=trigger.evaluation_status==="triggered"
        ? existing?.first_triggered_at??now
        : null;
      const {data:stored,error}=await sb.from("decision_triggers").upsert({
        company_id:company.id,
        research_run_id:run.id,
        ...trigger,
        first_triggered_at:firstTriggeredAt,
        last_evaluated_at:now,
        updated_at:now,
      },{onConflict:"research_run_id,trigger_key"}).select("*").single();
      if(error)throw error;
      written+=1;

      if(transitioned&&stored){
        const effect=stored.decision_effect;
        const {error:intelError}=await sb.from("intelligence_events").upsert({
          company_id:company.id,
          source_kind:"research_change",
          source_id:"decision-trigger:"+stored.id,
          event_type:"decision_trigger",
          occurred_at:now.slice(0,10),
          disclosed_at:now,
          title:company.ticker+": "+stored.label,
          summary:stored.rationale,
          materiality:stored.severity==="high"?"high":"review",
          review_status:effect==="more_attractive"?"incorporated":"open",
          research_run_id:run.id,
          source_url:null,
          metadata:{
            decision_trigger_id:stored.id,
            trigger_key:stored.trigger_key,
            trigger_group:stored.trigger_group,
            decision_effect:effect,
            comparator:stored.comparator,
            threshold_value:stored.threshold_value,
            current_value:stored.current_value,
            trigger_version:DECISION_TRIGGER_VERSION,
          },
          updated_at:now,
        },{onConflict:"source_kind,source_id"});
        if(intelError)throw intelError;
        transitionEvents+=1;
      }
    }

    for(const old of existingR.data??[]){
      if(activeKeys.has(old.trigger_key))continue;
      const {error}=await sb.from("decision_triggers").delete().eq("id",old.id);
      if(error)throw error;
    }

    summary.push({
      ticker:company.ticker,
      research_version:run.version,
      triggers:triggers.length,
      ...summarizeDecisionTriggers(triggers),
    });
  }catch(error){
    failures+=1;
    summary.push({ticker:company.ticker,status:"failed",error:error instanceof Error?error.message:String(error)});
  }
}

const completedAt=new Date().toISOString();
await sb.from("automation_runs").update({
  status:failures?"partial":"success",
  completed_at:completedAt,
  records_written:written,
  message:"Decision trigger engine evaluated "+written+" trigger rows and created "+transitionEvents+" new transition event(s).",
  details:{trigger_version:DECISION_TRIGGER_VERSION,written,transition_events:transitionEvents,failures,summary},
}).eq("id",runStart.data.id);

console.log(JSON.stringify({generated_at:completedAt,trigger_version:DECISION_TRIGGER_VERSION,written,transition_events:transitionEvents,failures,summary},null,2));
