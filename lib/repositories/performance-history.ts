import "server-only";

import { databaseConfigured, dbQuery } from "@/lib/db";
import { getSupabase } from "@/lib/supabase";

export async function loadPerformanceHistoryData({
  companyId,
  ticker,
  benchmarkTicker,
  researchRunId,
  asOf,
}:{
  companyId:string;
  ticker:string;
  benchmarkTicker:string;
  researchRunId:string|null;
  asOf:string|null;
}){
  const cutoffDate=asOf?asOf.slice(0,10):null;
  const metricKeys=["revenue","free_cash_flow","gross_margin","operating_margin","fcf_margin","eps_diluted","fcf_per_share","shares_outstanding"];
  const capitalKeys=["dividends_paid","buybacks","stock_based_compensation","acquisitions","debt_issued","debt_repaid"];
  const peerKeys=["revenue_growth_yoy","fcf_margin","price_to_fcf","fcf_yield"];

  if(databaseConfigured()){
    const [
      marketRows,
      benchmarkRows,
      metricsRows,
      valuationRows,
      capitalRows,
      peerRows,
      run,
      historicalFacts,
    ]=await Promise.all([
      dbQuery<any>(
        asOf
          ? `select trading_date,price,observed_at from public.market_snapshots
             where symbol=$1 and company_id=$2 and trading_date <= $3::date and observed_at <= $4::timestamptz
             order by trading_date asc limit 4000`
          : `select trading_date,price,observed_at from public.market_snapshots
             where symbol=$1 and company_id=$2 order by trading_date asc limit 4000`,
        asOf?[ticker,companyId,cutoffDate,asOf]:[ticker,companyId],
      ),
      dbQuery<any>(
        asOf
          ? `select trading_date,price,observed_at from public.market_snapshots
             where symbol=$1 and trading_date <= $2::date and observed_at <= $3::timestamptz
             order by trading_date asc limit 4000`
          : `select trading_date,price,observed_at from public.market_snapshots
             where symbol=$1 order by trading_date asc limit 4000`,
        asOf?[benchmarkTicker,cutoffDate,asOf]:[benchmarkTicker],
      ),
      dbQuery<any>(
        asOf&&cutoffDate
          ? `select metric_key,period_end,fiscal_year,period_type,value_numeric,unit,observed_at
             from public.company_metric_history
             where company_id=$1 and period_type='fiscal_year' and metric_key=any($2::text[])
               and observed_at <= $3::timestamptz and period_end <= $4::date
             order by fiscal_year asc`
          : `select metric_key,period_end,fiscal_year,period_type,value_numeric,unit,observed_at
             from public.company_metric_history
             where company_id=$1 and period_type='fiscal_year' and metric_key=any($2::text[])
             order by fiscal_year asc`,
        asOf&&cutoffDate?[companyId,metricKeys,asOf,cutoffDate]:[companyId,metricKeys],
      ),
      dbQuery<any>(
        asOf&&cutoffDate
          ? `select trading_date,price_to_fcf,fcf_yield,pe,forward_pe,observed_at
             from public.valuation_history
             where company_id=$1 and observed_at <= $2::timestamptz and trading_date <= $3::date
             order by trading_date asc limit 2000`
          : `select trading_date,price_to_fcf,fcf_yield,pe,forward_pe,observed_at
             from public.valuation_history where company_id=$1 order by trading_date asc limit 2000`,
        asOf&&cutoffDate?[companyId,asOf,cutoffDate]:[companyId],
      ),
      dbQuery<any>(
        asOf&&cutoffDate
          ? `select module,metric_key,period_end,fiscal_year,period_type,value_numeric,observed_at
             from public.company_metric_history
             where company_id=$1 and metric_key=any($2::text[])
               and observed_at <= $3::timestamptz and period_end <= $4::date
             order by period_end asc`
          : `select module,metric_key,period_end,fiscal_year,period_type,value_numeric,observed_at
             from public.company_metric_history
             where company_id=$1 and metric_key=any($2::text[])
             order by period_end asc`,
        asOf&&cutoffDate?[companyId,capitalKeys,asOf,cutoffDate]:[companyId,capitalKeys],
      ),
      dbQuery<any>(
        asOf&&cutoffDate
          ? `select peer_ticker,metric_key,as_of_date,value_numeric,observed_at
             from public.peer_metric_snapshots
             where company_id=$1 and metric_key=any($2::text[])
               and observed_at <= $3::timestamptz and as_of_date <= $4::date
             order by as_of_date desc`
          : `select peer_ticker,metric_key,as_of_date,value_numeric,observed_at
             from public.peer_metric_snapshots
             where company_id=$1 and metric_key=any($2::text[])
             order by as_of_date desc`,
        asOf&&cutoffDate?[companyId,peerKeys,asOf,cutoffDate]:[companyId,peerKeys],
      ),
      researchRunId
        ? dbQuery<any>(`select id from public.research_runs where id=$1 limit 1`,[researchRunId]).then(r=>r[0]??null)
        : dbQuery<any>(`select id from public.research_runs where company_id=$1 and status='published' order by version desc limit 1`,[companyId]).then(r=>r[0]??null),
      asOf&&researchRunId
        ? dbQuery<any>(
            `select module,metric_key,value_numeric,unit,economic_period_end,economic_period_type,known_at,source_confidence_class,conflict_state
             from public.research_public_history_items
             where research_run_id=$1
             order by module,metric_key,economic_period_end asc`,
            [researchRunId],
          )
        : Promise.resolve([]),
    ]);

    const selfMetrics=run?.id
      ? await dbQuery<any>(`select revenue_growth_1y,fcf_margin from public.financial_metrics where research_run_id=$1 limit 1`,[run.id]).then(r=>r[0]??null)
      : null;

    return {
      source:"postgres" as const,
      marketRows,benchmarkRows,metricsRows,valuationRows,capitalRows,peerRows,run,historicalFacts,selfMetrics,
    };
  }

  const supabase=getSupabase();
  if(!supabase)return null;

  async function fetchMarket(symbol:string,company:string|null){
    const pageSize=1000;
    const rows:any[]=[];
    for(let page=0;page<4;page++){
      let query=supabase.from("market_snapshots").select("trading_date,price,observed_at")
        .eq("symbol",symbol).order("trading_date",{ascending:true}).range(page*pageSize,page*pageSize+pageSize-1);
      if(company)query=query.eq("company_id",company);
      if(asOf)query=query.lte("trading_date",cutoffDate).lte("observed_at",asOf);
      const {data,error}=await query;
      if(error)break;
      const batch=data??[];
      rows.push(...batch);
      if(batch.length<pageSize)break;
    }
    return rows;
  }

  let metricsQuery=supabase.from("company_metric_history").select("metric_key,period_end,fiscal_year,period_type,value_numeric,unit,observed_at")
    .eq("company_id",companyId).eq("period_type","fiscal_year").in("metric_key",metricKeys);
  let valuationQuery=supabase.from("valuation_history").select("trading_date,price_to_fcf,fcf_yield,pe,forward_pe,observed_at").eq("company_id",companyId);
  let capitalQuery=supabase.from("company_metric_history").select("module,metric_key,period_end,fiscal_year,period_type,value_numeric,observed_at")
    .eq("company_id",companyId).in("metric_key",capitalKeys);
  let peerQuery=supabase.from("peer_metric_snapshots").select("peer_ticker,metric_key,as_of_date,value_numeric,observed_at")
    .eq("company_id",companyId).in("metric_key",peerKeys);
  if(asOf){
    metricsQuery=metricsQuery.lte("observed_at",asOf);
    valuationQuery=valuationQuery.lte("observed_at",asOf);
    capitalQuery=capitalQuery.lte("observed_at",asOf);
    peerQuery=peerQuery.lte("observed_at",asOf);
  }
  if(cutoffDate){
    metricsQuery=metricsQuery.lte("period_end",cutoffDate);
    valuationQuery=valuationQuery.lte("trading_date",cutoffDate);
    capitalQuery=capitalQuery.lte("period_end",cutoffDate);
    peerQuery=peerQuery.lte("as_of_date",cutoffDate);
  }

  const [marketRows,benchmarkRows,metricsResult,valuationResult,capitalResult,peerResult,runResult,historicalResult]=await Promise.all([
    fetchMarket(ticker,companyId),
    fetchMarket(benchmarkTicker,null),
    metricsQuery.order("fiscal_year",{ascending:true}),
    valuationQuery.order("trading_date",{ascending:true}).limit(2000),
    capitalQuery.order("period_end",{ascending:true}),
    peerQuery.order("as_of_date",{ascending:false}),
    researchRunId
      ? supabase.from("research_runs").select("id").eq("id",researchRunId).maybeSingle()
      : supabase.from("research_runs").select("id").eq("company_id",companyId).eq("status","published").order("version",{ascending:false}).limit(1).maybeSingle(),
    asOf&&researchRunId
      ? supabase.from("research_public_history_items")
          .select("module,metric_key,value_numeric,unit,economic_period_end,economic_period_type,known_at,source_confidence_class,conflict_state")
          .eq("research_run_id",researchRunId).order("module").order("metric_key").order("economic_period_end",{ascending:true})
      : Promise.resolve({data:[] as any[],error:null}),
  ]);

  let selfMetrics:any=null;
  if(runResult.data?.id){
    const {data}=await supabase.from("financial_metrics").select("revenue_growth_1y,fcf_margin").eq("research_run_id",runResult.data.id).maybeSingle();
    selfMetrics=data;
  }

  return {
    source:"supabase" as const,
    marketRows,
    benchmarkRows,
    metricsRows:metricsResult.data??[],
    valuationRows:valuationResult.data??[],
    capitalRows:capitalResult.data??[],
    peerRows:peerResult.data??[],
    run:runResult.data??null,
    historicalFacts:historicalResult.data??[],
    selfMetrics,
  };
}
