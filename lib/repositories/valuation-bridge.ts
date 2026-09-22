import "server-only";

import { databaseConfigured, dbQuery } from "@/lib/db";
import { getSupabase } from "@/lib/supabase";

export async function loadValuationBridgeData(companyId:string,researchRunId:string){
  if(databaseConfigured()){
    const [run,valuation,metrics,v2,returns]=await Promise.all([
      dbQuery<any>(`select data_cutoff_at,researched_at from public.research_runs where id=$1 limit 1`,[researchRunId]).then(r=>r[0]??null),
      dbQuery<any>(`select * from public.valuations where research_run_id=$1 limit 1`,[researchRunId]).then(r=>r[0]??null),
      dbQuery<any>(`select * from public.financial_metrics where research_run_id=$1 limit 1`,[researchRunId]).then(r=>r[0]??null),
      dbQuery<any>(`select valuation_analysis from public.research_v2_sections where research_run_id=$1 limit 1`,[researchRunId]).then(r=>r[0]??null),
      dbQuery<any>(`select scenario,horizon_years,expected_cagr from public.expected_return_scenarios where research_run_id=$1`,[researchRunId]),
    ]);
    const cutoffIso=String(run?.data_cutoff_at??run?.researched_at??"");
    const cutoff=cutoffIso.slice(0,10);
    const peers=await dbQuery<any>(
      cutoff&&cutoffIso
        ? `select peer_ticker,as_of_date,value_numeric,observed_at
           from public.peer_metric_snapshots
           where company_id=$1 and metric_key='price_to_fcf'
             and as_of_date <= $2::date and observed_at <= $3::timestamptz
           order by as_of_date desc limit 200`
        : `select peer_ticker,as_of_date,value_numeric,observed_at
           from public.peer_metric_snapshots
           where company_id=$1 and metric_key='price_to_fcf'
           order by as_of_date desc limit 200`,
      cutoff&&cutoffIso?[companyId,cutoff,cutoffIso]:[companyId],
    );
    return {source:"postgres" as const,run,valuation,metrics,v2,returns,peers};
  }

  const supabase=getSupabase();
  if(!supabase)return null;
  const [runR,valuationR,metricsR,v2R,returnsR]=await Promise.all([
    supabase.from("research_runs").select("data_cutoff_at,researched_at").eq("id",researchRunId).maybeSingle(),
    supabase.from("valuations").select("*").eq("research_run_id",researchRunId).maybeSingle(),
    supabase.from("financial_metrics").select("*").eq("research_run_id",researchRunId).maybeSingle(),
    supabase.from("research_v2_sections").select("valuation_analysis").eq("research_run_id",researchRunId).maybeSingle(),
    supabase.from("expected_return_scenarios").select("scenario,horizon_years,expected_cagr").eq("research_run_id",researchRunId),
  ]);
  const run=runR.data??null;
  const cutoffIso=String(run?.data_cutoff_at??run?.researched_at??"");
  const cutoff=cutoffIso.slice(0,10);
  let peerQuery=supabase.from("peer_metric_snapshots")
    .select("peer_ticker,as_of_date,value_numeric,observed_at")
    .eq("company_id",companyId).eq("metric_key","price_to_fcf").order("as_of_date",{ascending:false});
  if(cutoff)peerQuery=peerQuery.lte("as_of_date",cutoff);
  if(cutoffIso)peerQuery=peerQuery.lte("observed_at",cutoffIso);
  const peerR=await peerQuery.limit(200);
  return {
    source:"supabase" as const,
    run,
    valuation:valuationR.data??null,
    metrics:metricsR.data??null,
    v2:v2R.data??null,
    returns:returnsR.data??[],
    peers:peerR.data??[],
  };
}
