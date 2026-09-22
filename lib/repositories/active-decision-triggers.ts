import "server-only";
import { databaseConfigured, dbQuery } from "@/lib/db";
import { getSupabase } from "@/lib/supabase";

export async function loadActiveDecisionTriggers(){
  if(databaseConfigured()){
    return dbQuery<any>(`
      select
        d.id,d.company_id,d.research_run_id,d.trigger_key,d.trigger_group,d.label,d.metric_key,
        d.comparator,d.threshold_value,d.threshold_unit,d.current_value,d.current_text,
        d.decision_effect,d.severity,d.evaluation_status,d.rationale,d.last_evaluated_at,
        c.ticker,c.company_name
      from public.decision_triggers d
      left join public.companies c on c.id=d.company_id
      where d.evaluation_status=any($1::text[])
        and d.trigger_group <> 'data_quality'
      order by d.severity desc,d.updated_at desc
      limit 40
    `,[["triggered","needs_review"]]);
  }
  const supabase=getSupabase();
  if(!supabase)return null;
  const {data}=await supabase
    .from("decision_triggers")
    .select("id,company_id,research_run_id,trigger_key,trigger_group,label,metric_key,comparator,threshold_value,threshold_unit,current_value,current_text,decision_effect,severity,evaluation_status,rationale,last_evaluated_at,companies(ticker,company_name)")
    .in("evaluation_status",["triggered","needs_review"])
    .neq("trigger_group","data_quality")
    .order("severity",{ascending:false})
    .order("updated_at",{ascending:false})
    .limit(40);
  return (data??[]).map((row:any)=>{
    const company=Array.isArray(row.companies)?row.companies[0]:row.companies;
    return {...row,ticker:company?.ticker??null,company_name:company?.company_name??null};
  });
}
