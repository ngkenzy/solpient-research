import "server-only";
import { databaseConfigured, dbQuery } from "@/lib/db";
import { getSupabase } from "@/lib/supabase";

export async function loadCompanyChanges(companyId:string,researchRunId:string,asOf:string|null){
  if(databaseConfigured()){
    return dbQuery<any>(
      asOf
        ? `select * from public.company_change_events
           where company_id=$1 and research_run_id=$2 and created_at <= $3::timestamptz
           order by occurred_at desc,created_at desc limit 16`
        : `select * from public.company_change_events
           where company_id=$1 and research_run_id=$2
           order by occurred_at desc,created_at desc limit 16`,
      asOf?[companyId,researchRunId,asOf]:[companyId,researchRunId],
    );
  }
  const supabase=getSupabase();
  if(!supabase)return null;
  let q=supabase.from("company_change_events").select("*").eq("company_id",companyId).eq("research_run_id",researchRunId);
  if(asOf)q=q.lte("created_at",asOf);
  const {data}=await q.order("occurred_at",{ascending:false}).order("created_at",{ascending:false}).limit(16);
  return data??[];
}
