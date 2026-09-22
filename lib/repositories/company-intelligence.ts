import "server-only";

import { databaseConfigured, dbQuery } from "@/lib/db";
import { getSupabase } from "@/lib/supabase";

export async function loadCompanyIntelligenceData(ticker:string, asOf:string|null){
  if(databaseConfigured()){
    const [company]=await dbQuery<any>(
      `select id,ticker from public.companies where ticker=$1 limit 1`,
      [ticker.toUpperCase()],
    );
    if(!company)return null;
    const [rows,coverageChecks,providerHealth]=await Promise.all([
      dbQuery<any>(
        asOf
          ? `select id,activity_type,actor_name,actor_detail,action,shares,price,value,change_pct,amount_range,
                    transaction_date,disclosure_date,position_date,source_url,provider,verified_at,created_at
             from public.capital_activity
             where company_id=$1 and created_at <= $2::timestamptz
             order by created_at desc limit 100`
          : `select id,activity_type,actor_name,actor_detail,action,shares,price,value,change_pct,amount_range,
                    transaction_date,disclosure_date,position_date,source_url,provider,verified_at,created_at
             from public.capital_activity
             where company_id=$1
             order by created_at desc limit 100`,
        asOf?[company.id,asOf]:[company.id],
      ),
      dbQuery<any>(
        asOf
          ? `select activity_type,status,provider,window_start,window_end,verified_at,record_count,source_url,notes
             from public.capital_coverage_checks
             where company_id=$1 and verified_at <= $2::timestamptz`
          : `select activity_type,status,provider,window_start,window_end,verified_at,record_count,source_url,notes
             from public.capital_coverage_checks where company_id=$1`,
        asOf?[company.id,asOf]:[company.id],
      ),
      asOf
        ? Promise.resolve([])
        : dbQuery<any>(
            `select provider,feed_type,status,last_success_at,last_verified_at,last_error,metadata
             from public.capital_provider_health
             where feed_type='all'
             order by updated_at desc`,
          ),
    ]);
    return {source:"postgres" as const,company,rows,coverageChecks,providerHealth};
  }

  const supabase=getSupabase();
  if(!supabase)return null;
  const {data:company}=await supabase.from("companies").select("id,ticker").eq("ticker",ticker.toUpperCase()).maybeSingle();
  if(!company)return null;
  let activityQuery=supabase.from("capital_activity")
    .select("id,activity_type,actor_name,actor_detail,action,shares,price,value,change_pct,amount_range,transaction_date,disclosure_date,position_date,source_url,provider,verified_at,created_at")
    .eq("company_id",company.id);
  if(asOf)activityQuery=activityQuery.lte("created_at",asOf);
  const {data,error}=await activityQuery.order("created_at",{ascending:false}).limit(100);
  if(error)return null;
  let coverageQuery=supabase.from("capital_coverage_checks")
    .select("activity_type,status,provider,window_start,window_end,verified_at,record_count,source_url,notes")
    .eq("company_id",company.id);
  if(asOf)coverageQuery=coverageQuery.lte("verified_at",asOf);
  const {data:coverageChecks}=await coverageQuery;
  let providerHealth:any[]=[];
  if(!asOf){
    const {data:health}=await supabase.from("capital_provider_health")
      .select("provider,feed_type,status,last_success_at,last_verified_at,last_error,metadata")
      .eq("feed_type","all").order("updated_at",{ascending:false});
    providerHealth=health??[];
  }
  return {source:"supabase" as const,company,rows:data??[],coverageChecks:coverageChecks??[],providerHealth};
}
