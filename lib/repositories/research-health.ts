import "server-only";
import { databaseConfigured, dbQuery } from "@/lib/db";
import { getSupabase } from "@/lib/supabase";

export async function loadResearchHealthData(){
  if(databaseConfigured()){
    const [companies,coverage,jobs,automationRows]=await Promise.all([
      dbQuery<any>(`select id,ticker,company_name,sector from public.companies order by ticker`),
      dbQuery<any>(`select * from public.data_coverage_reports where engine_version='coverage-v2' order by as_of_date desc,generated_at desc`),
      dbQuery<any>(`select id,company_id,layer,field,repair_type,automation_mode,status,priority,reason,attempt_count,last_error,updated_at from public.research_repair_jobs order by priority desc`),
      dbQuery<any>(`select pipeline,completed_at,status,records_written from public.automation_runs where pipeline='research_repair_center' order by started_at desc limit 1`),
    ]);
    return {source:"postgres" as const,companies,coverage,jobs,latestRepairRun:automationRows[0]??null};
  }
  const supabase=getSupabase();
  if(!supabase)return null;
  const [companiesR,coverageR,jobsR,automationR]=await Promise.all([
    supabase.from("companies").select("id,ticker,company_name,sector").order("ticker"),
    supabase.from("data_coverage_reports").select("*").eq("engine_version","coverage-v2").order("as_of_date",{ascending:false}).order("generated_at",{ascending:false}),
    supabase.from("research_repair_jobs").select("id,company_id,layer,field,repair_type,automation_mode,status,priority,reason,attempt_count,last_error,updated_at").order("priority",{ascending:false}),
    supabase.from("automation_runs").select("pipeline,completed_at,status,records_written").eq("pipeline","research_repair_center").order("started_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  return {
    source:"supabase" as const,
    companies:companiesR.data??[],
    coverage:coverageR.data??[],
    jobs:jobsR.data??[],
    latestRepairRun:automationR.data??null,
  };
}
