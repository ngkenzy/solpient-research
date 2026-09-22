import "server-only";

import { databaseConfigured, dbQuery } from "@/lib/db";
import { getSupabase } from "@/lib/supabase";
import { getResearchTemporalContext } from "@/lib/research-temporal";

async function loadTemporalPostgres(researchRunId:string){
  const [run]=await dbQuery<any>(
    `select id,company_id,version,data_cutoff_at,researched_at,source_context_pack_id
     from public.research_runs where id=$1 limit 1`,
    [researchRunId],
  );
  if(!run)return null;
  const raw=run.data_cutoff_at??run.researched_at??null;
  const parsed=raw?new Date(raw):null;
  const iso=parsed&&Number.isFinite(parsed.getTime())?parsed.toISOString():null;
  const date=iso?iso.slice(0,10):null;
  let contextPack:any=null;
  if(run.source_context_pack_id){
    [contextPack]=await dbQuery<any>(`select * from public.research_context_packs where id=$1 limit 1`,[run.source_context_pack_id]);
  }else if(iso&&date){
    [contextPack]=await dbQuery<any>(
      `select * from public.research_context_packs
       where company_id=$1 and as_of_date <= $2::date and generated_at <= $3::timestamptz
       order by as_of_date desc,generated_at desc limit 1`,
      [run.company_id,date,iso],
    );
    const knowledge=contextPack?.knowledge_cutoff_at??contextPack?.generated_at;
    if(knowledge&&new Date(knowledge).getTime()>new Date(iso).getTime())contextPack=null;
  }
  return {run,contextPack};
}

export async function loadResearchStandardV1Data(researchRunId:string){
  if(databaseConfigured()){
    const [run,business,metrics,risks,returns,thesis]=await Promise.all([
      dbQuery<any>(`select standard_version,standard_status,data_cutoff_at,benchmark_ticker,completeness_pct,validation_notes from public.research_runs where id=$1 limit 1`,[researchRunId]).then(r=>r[0]??null),
      dbQuery<any>(`select * from public.business_assessments where research_run_id=$1 limit 1`,[researchRunId]).then(r=>r[0]??null),
      dbQuery<any>(`select * from public.metric_observations where research_run_id=$1 order by metric_key`,[researchRunId]),
      dbQuery<any>(`select * from public.risk_register where research_run_id=$1`,[researchRunId]),
      dbQuery<any>(`select * from public.expected_return_scenarios where research_run_id=$1 order by horizon_years`,[researchRunId]),
      dbQuery<any>(`select id,variable_name,expectation,observed_value,status,metric_key,threshold_value,threshold_unit,review_frequency,breaker_condition from public.thesis_variables where research_run_id=$1 order by created_at`,[researchRunId]),
    ]);
    return {source:"postgres" as const,run,business,metrics,risks,returns,thesis};
  }
  const supabase=getSupabase();
  if(!supabase)return null;
  const [runResult,businessResult,metricResult,riskResult,returnResult,thesisResult]=await Promise.all([
    supabase.from("research_runs").select("standard_version,standard_status,data_cutoff_at,benchmark_ticker,completeness_pct,validation_notes").eq("id",researchRunId).maybeSingle(),
    supabase.from("business_assessments").select("*").eq("research_run_id",researchRunId).maybeSingle(),
    supabase.from("metric_observations").select("*").eq("research_run_id",researchRunId).order("metric_key"),
    supabase.from("risk_register").select("*").eq("research_run_id",researchRunId).order("severity",{ascending:false}),
    supabase.from("expected_return_scenarios").select("*").eq("research_run_id",researchRunId).order("horizon_years"),
    supabase.from("thesis_variables").select("id,variable_name,expectation,observed_value,status,metric_key,threshold_value,threshold_unit,review_frequency,breaker_condition").eq("research_run_id",researchRunId).order("created_at"),
  ]);
  return {source:"supabase" as const,run:runResult.data??null,business:businessResult.data??null,metrics:metricResult.data??[],risks:riskResult.data??[],returns:returnResult.data??[],thesis:thesisResult.data??[]};
}

export async function loadResearchStandardV2Data(researchRunId:string){
  if(databaseConfigured()){
    const [run,section,business,returns,risks,valuation,metrics,temporal]=await Promise.all([
      dbQuery<any>(`select company_id,standard_version,standard_status,completeness_pct,benchmark_ticker from public.research_runs where id=$1 limit 1`,[researchRunId]).then(r=>r[0]??null),
      dbQuery<any>(`select * from public.research_v2_sections where research_run_id=$1 limit 1`,[researchRunId]).then(r=>r[0]??null),
      dbQuery<any>(`select * from public.business_assessments where research_run_id=$1 limit 1`,[researchRunId]).then(r=>r[0]??null),
      dbQuery<any>(`select * from public.expected_return_scenarios where research_run_id=$1 order by horizon_years`,[researchRunId]),
      dbQuery<any>(`select * from public.risk_register where research_run_id=$1`,[researchRunId]),
      dbQuery<any>(`select * from public.valuations where research_run_id=$1 limit 1`,[researchRunId]).then(r=>r[0]??null),
      dbQuery<any>(`select * from public.financial_metrics where research_run_id=$1 limit 1`,[researchRunId]).then(r=>r[0]??null),
      loadTemporalPostgres(researchRunId),
    ]);
    return {source:"postgres" as const,run,section,business,returns,risks,valuation,metrics,contextPack:temporal?.contextPack??null};
  }

  const supabase=getSupabase();
  if(!supabase)return null;
  const [runResult,sectionResult,businessResult,returnResult,riskResult,valuationResult,metricsResult]=await Promise.all([
    supabase.from("research_runs").select("company_id,standard_version,standard_status,completeness_pct,benchmark_ticker").eq("id",researchRunId).maybeSingle(),
    supabase.from("research_v2_sections").select("*").eq("research_run_id",researchRunId).maybeSingle(),
    supabase.from("business_assessments").select("*").eq("research_run_id",researchRunId).maybeSingle(),
    supabase.from("expected_return_scenarios").select("*").eq("research_run_id",researchRunId).order("horizon_years"),
    supabase.from("risk_register").select("*").eq("research_run_id",researchRunId),
    supabase.from("valuations").select("*").eq("research_run_id",researchRunId).maybeSingle(),
    supabase.from("financial_metrics").select("*").eq("research_run_id",researchRunId).maybeSingle(),
  ]);
  const temporal=await getResearchTemporalContext(supabase,researchRunId);
  return {
    source:"supabase" as const,
    run:runResult.data??null,
    section:sectionResult.data??null,
    business:businessResult.data??null,
    returns:returnResult.data??[],
    risks:riskResult.data??[],
    valuation:valuationResult.data??null,
    metrics:metricsResult.data??null,
    contextPack:temporal?.contextPack??null,
  };
}
