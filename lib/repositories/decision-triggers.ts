import "server-only";
import { databaseConfigured, dbQuery } from "@/lib/db";
import { getSupabase } from "@/lib/supabase";

export async function loadDecisionTriggers(companyId:string,researchRunId:string,asOf:string|null){
  if(databaseConfigured()){
    return dbQuery<any>(
      asOf
        ? `select * from public.decision_triggers
           where company_id=$1 and research_run_id=$2
             and created_at <= $3::timestamptz and last_evaluated_at <= $3::timestamptz
           order by trigger_group,severity desc,label`
        : `select * from public.decision_triggers
           where company_id=$1 and research_run_id=$2
           order by trigger_group,severity desc,label`,
      asOf?[companyId,researchRunId,asOf]:[companyId,researchRunId],
    );
  }
  const supabase=getSupabase();
  if(!supabase)return null;
  let q=supabase.from("decision_triggers").select("*").eq("company_id",companyId).eq("research_run_id",researchRunId);
  if(asOf)q=q.lte("created_at",asOf).lte("last_evaluated_at",asOf);
  const {data}=await q.order("trigger_group").order("severity",{ascending:false}).order("label");
  return data??[];
}
