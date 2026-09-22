import "server-only";

import { databaseConfigured, dbQuery } from "@/lib/db";
import { getSupabase } from "@/lib/supabase";

export async function loadAdvancedResearchData(companyId:string,researchRunId:string,asOf:string|null){
  const cutoffDate=asOf?asOf.slice(0,10):null;
  const modules=["product_mix","segment_mix","geography_mix","biopharma_pipeline","biopharma_timeline","earnings_surprise","capital_safety"];

  if(databaseConfigured()){
    const [rows,consensus,metrics,v2,annualFcf]=await Promise.all([
      dbQuery<any>(
        asOf&&cutoffDate
          ? `select module,metric_key,label,period_end,fiscal_year,period_type,value_numeric,value_text,unit,source_title,source_url,observed_at
             from public.company_metric_history
             where company_id=$1 and module=any($2::text[]) and observed_at <= $3::timestamptz and period_end <= $4::date
             order by period_end asc`
          : `select module,metric_key,label,period_end,fiscal_year,period_type,value_numeric,value_text,unit,source_title,source_url,observed_at
             from public.company_metric_history
             where company_id=$1 and module=any($2::text[])
             order by period_end asc`,
        asOf&&cutoffDate?[companyId,modules,asOf,cutoffDate]:[companyId,modules],
      ),
      dbQuery<any>(
        asOf
          ? `select observed_at,provider,revenue_next_fy,eps_next_fy,revenue_growth_next_fy,eps_growth_next_fy,analyst_count,raw_payload
             from public.consensus_snapshots where company_id=$1 and observed_at <= $2::timestamptz order by observed_at asc limit 36`
          : `select observed_at,provider,revenue_next_fy,eps_next_fy,revenue_growth_next_fy,eps_growth_next_fy,analyst_count,raw_payload
             from public.consensus_snapshots where company_id=$1 order by observed_at asc limit 36`,
        asOf?[companyId,asOf]:[companyId],
      ),
      dbQuery<any>(`select cash,total_debt,free_cash_flow from public.financial_metrics where research_run_id=$1 limit 1`,[researchRunId]).then(r=>r[0]??null),
      dbQuery<any>(`select valuation_analysis from public.research_v2_sections where research_run_id=$1 limit 1`,[researchRunId]).then(r=>r[0]??null),
      dbQuery<any>(
        asOf&&cutoffDate
          ? `select fiscal_year,value_numeric,period_end,observed_at from public.company_metric_history
             where company_id=$1 and module='universal' and metric_key='free_cash_flow'
               and period_type='fiscal_year' and value_numeric>0
               and observed_at <= $2::timestamptz and period_end <= $3::date
             order by fiscal_year desc limit 1`
          : `select fiscal_year,value_numeric,period_end,observed_at from public.company_metric_history
             where company_id=$1 and module='universal' and metric_key='free_cash_flow'
               and period_type='fiscal_year' and value_numeric>0
             order by fiscal_year desc limit 1`,
        asOf&&cutoffDate?[companyId,asOf,cutoffDate]:[companyId],
      ).then(r=>r[0]??null),
    ]);
    return {source:"postgres" as const,rows,consensus,metrics,v2,annualFcf};
  }

  const supabase=getSupabase();
  if(!supabase)return null;
  let moduleQuery=supabase.from("company_metric_history")
    .select("module,metric_key,label,period_end,fiscal_year,period_type,value_numeric,value_text,unit,source_title,source_url,observed_at")
    .eq("company_id",companyId).in("module",modules);
  let consensusQuery=supabase.from("consensus_snapshots")
    .select("observed_at,provider,revenue_next_fy,eps_next_fy,revenue_growth_next_fy,eps_growth_next_fy,analyst_count,raw_payload")
    .eq("company_id",companyId);
  let annualFcfQuery=supabase.from("company_metric_history")
    .select("fiscal_year,value_numeric,period_end,observed_at")
    .eq("company_id",companyId).eq("module","universal").eq("metric_key","free_cash_flow").eq("period_type","fiscal_year").gt("value_numeric",0);
  if(asOf){
    moduleQuery=moduleQuery.lte("observed_at",asOf);
    consensusQuery=consensusQuery.lte("observed_at",asOf);
    annualFcfQuery=annualFcfQuery.lte("observed_at",asOf);
  }
  if(cutoffDate){
    moduleQuery=moduleQuery.lte("period_end",cutoffDate);
    annualFcfQuery=annualFcfQuery.lte("period_end",cutoffDate);
  }
  const [moduleResult,consensusResult,metricsResult,v2Result,annualFcfResult]=await Promise.all([
    moduleQuery.order("period_end",{ascending:true}),
    consensusQuery.order("observed_at",{ascending:true}).limit(36),
    supabase.from("financial_metrics").select("cash,total_debt,free_cash_flow").eq("research_run_id",researchRunId).maybeSingle(),
    supabase.from("research_v2_sections").select("valuation_analysis").eq("research_run_id",researchRunId).maybeSingle(),
    annualFcfQuery.order("fiscal_year",{ascending:false}).limit(1).maybeSingle(),
  ]);
  return {
    source:"supabase" as const,
    rows:moduleResult.data??[],
    consensus:consensusResult.data??[],
    metrics:metricsResult.data??null,
    v2:v2Result.data??null,
    annualFcf:annualFcfResult.data??null,
  };
}
