import "server-only";
import { databaseConfigured, dbQuery } from "@/lib/db";
import { getSupabase } from "@/lib/supabase";

export async function loadResearchCoverage(companyId:string,asOf:string|null){
  if(databaseConfigured()){
    return dbQuery<any>(
      asOf
        ? `select * from public.data_coverage_reports
           where company_id=$1 and as_of_date <= $2::date and generated_at <= $3::timestamptz
           order by as_of_date desc,generated_at desc limit 10`
        : `select * from public.data_coverage_reports
           where company_id=$1 order by as_of_date desc,generated_at desc limit 10`,
      asOf?[companyId,asOf.slice(0,10),asOf]:[companyId],
    );
  }
  const supabase=getSupabase();
  if(!supabase)return null;
  let q=supabase.from("data_coverage_reports").select("*").eq("company_id",companyId);
  if(asOf)q=q.lte("as_of_date",asOf.slice(0,10)).lte("generated_at",asOf);
  const {data}=await q.order("as_of_date",{ascending:false}).order("generated_at",{ascending:false}).limit(10);
  return data??[];
}
