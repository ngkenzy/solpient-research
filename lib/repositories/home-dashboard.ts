import "server-only";

import { databaseConfigured, dbQuery } from "@/lib/db";
import { loadLatestDecisionRanking } from "@/lib/decision-ranking-read-model";
import { getSupabase } from "@/lib/supabase";
import { loadLatestDecisionRankingFromPostgres } from "@/lib/repositories/decision-ranking";

const result = (data: any[]) => ({ data });

function latestRunIds(runs: any[]) {
  const latest = new Map<string, string>();
  for (const run of runs) {
    if (!latest.has(run.company_id)) latest.set(run.company_id, run.id);
  }
  return Array.from(latest.values());
}

export async function loadHomeDashboardData() {
  if (databaseConfigured()) {
    const [
      companies,
      runs,
      market,
      filings,
      rankingHistory,
      capital,
      events,
      rankingExplanations,
      predictions,
      predictionScores,
      automation,
      phase3Ranking,
    ] = await Promise.all([
      dbQuery<any>(`select id,ticker,company_name,sector,industry from public.companies order by ticker`),
      dbQuery<any>(`
        select id,company_id,version,researched_at,price_at_research,summary
        from public.research_runs
        where status = 'published'
        order by researched_at desc
      `),
      dbQuery<any>(`
        select distinct on (symbol) symbol,price,trading_date,observed_at
        from public.market_snapshots
        order by symbol, trading_date desc, observed_at desc nulls last
      `),
      dbQuery<any>(`
        select id,company_id,form_type,filed_at,title,filing_url,created_at
        from public.filing_events
        order by filed_at desc
        limit 80
      `),
      dbQuery<any>(`
        select company_id,ranked_at,rank,overall_score,price,base_fair_value
        from public.ranking_history
        order by ranked_at desc
        limit 200
      `),
      dbQuery<any>(`
        select id,company_id,activity_type,actor_name,actor_detail,action,shares,price,value,change_pct,
               amount_range,transaction_date,disclosure_date,position_date,source_url,provider,created_at
        from public.capital_activity
        order by created_at desc
        limit 250
      `),
      dbQuery<any>(`
        select id,company_id,source_kind,event_type,occurred_at,disclosed_at,title,summary,materiality,
               review_status,research_run_id,source_url,created_at
        from public.intelligence_events
        order by disclosed_at desc nulls last
        limit 150
      `),
      dbQuery<any>(`
        select company_id,previous_rank,rank_delta,score_delta,price_delta_pct,valuation_gap_delta_pct,
               explanation,created_at
        from public.ranking_explanations
        order by created_at desc
        limit 200
      `),
      dbQuery<any>(`
        select id,company_id,prediction_key,predicted_at,horizon_months,thesis_status,confidence
        from public.prediction_snapshots
        order by predicted_at desc
        limit 50
      `),
      dbQuery<any>(`
        select id,scored_at,direction_correct,absolute_error,percentage_error,benchmark_excess_return
        from public.prediction_scores
        order by scored_at desc
        limit 100
      `),
      dbQuery<any>(`
        select pipeline,started_at,completed_at,status,records_written,message
        from public.automation_runs
        order by started_at desc
        limit 30
      `),
      loadLatestDecisionRankingFromPostgres(),
    ]);

    const runIds = latestRunIds(runs);
    const [scores, valuations] = runIds.length
      ? await Promise.all([
          dbQuery<any>(
            `
              select research_run_id,overall_score,quality_score,valuation_score,thesis_integrity_score
              from public.scores
              where research_run_id = any($1::uuid[])
            `,
            [runIds],
          ),
          dbQuery<any>(
            `
              select research_run_id,base_value,bear_value,bull_value
              from public.valuations
              where research_run_id = any($1::uuid[])
            `,
            [runIds],
          ),
        ])
      : [[], []];

    return {
      source: "postgres" as const,
      companiesResult: result(companies),
      runsResult: result(runs),
      marketResult: result(market),
      filingsResult: result(filings),
      rankingResult: result(rankingHistory),
      capitalResult: result(capital),
      eventsResult: result(events),
      rankingExplanationsResult: result(rankingExplanations),
      predictionsResult: result(predictions),
      predictionScoresResult: result(predictionScores),
      automationResult: result(automation),
      scoresResult: result(scores),
      valuationsResult: result(valuations),
      phase3Ranking,
    };
  }

  const supabase = getSupabase();
  if (!supabase) return null;

  const [
    companiesResult,
    runsResult,
    marketResult,
    filingsResult,
    rankingResult,
    capitalResult,
    eventsResult,
    rankingExplanationsResult,
    predictionsResult,
    predictionScoresResult,
    automationResult,
  ] = await Promise.all([
    supabase.from("companies").select("id,ticker,company_name,sector,industry").order("ticker"),
    supabase
      .from("research_runs")
      .select("id,company_id,version,researched_at,price_at_research,summary")
      .eq("status", "published")
      .order("researched_at", { ascending: false }),
    supabase
      .from("market_snapshots")
      .select("symbol,price,trading_date,observed_at")
      .order("trading_date", { ascending: false }),
    supabase
      .from("filing_events")
      .select("id,company_id,form_type,filed_at,title,filing_url,created_at")
      .order("filed_at", { ascending: false })
      .limit(80),
    supabase
      .from("ranking_history")
      .select("company_id,ranked_at,rank,overall_score,price,base_fair_value")
      .order("ranked_at", { ascending: false })
      .limit(200),
    supabase
      .from("capital_activity")
      .select("id,company_id,activity_type,actor_name,actor_detail,action,shares,price,value,change_pct,amount_range,transaction_date,disclosure_date,position_date,source_url,provider,created_at")
      .order("created_at", { ascending: false })
      .limit(250),
    supabase
      .from("intelligence_events")
      .select("id,company_id,source_kind,event_type,occurred_at,disclosed_at,title,summary,materiality,review_status,research_run_id,source_url,created_at")
      .order("disclosed_at", { ascending: false, nullsFirst: false })
      .limit(150),
    supabase
      .from("ranking_explanations")
      .select("company_id,previous_rank,rank_delta,score_delta,price_delta_pct,valuation_gap_delta_pct,explanation,created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("prediction_snapshots")
      .select("id,company_id,prediction_key,predicted_at,horizon_months,thesis_status,confidence")
      .order("predicted_at", { ascending: false })
      .limit(50),
    supabase
      .from("prediction_scores")
      .select("id,scored_at,direction_correct,absolute_error,percentage_error,benchmark_excess_return")
      .order("scored_at", { ascending: false })
      .limit(100),
    supabase
      .from("automation_runs")
      .select("pipeline,started_at,completed_at,status,records_written,message")
      .order("started_at", { ascending: false })
      .limit(30),
  ]);

  const runs = runsResult.data ?? [];
  const runIds = latestRunIds(runs);
  const [scoresResult, valuationsResult] = runIds.length
    ? await Promise.all([
        supabase
          .from("scores")
          .select("research_run_id,overall_score,quality_score,valuation_score,thesis_integrity_score")
          .in("research_run_id", runIds),
        supabase
          .from("valuations")
          .select("research_run_id,base_value,bear_value,bull_value")
          .in("research_run_id", runIds),
      ])
    : [result([]), result([])];

  const phase3Ranking = await loadLatestDecisionRanking(supabase);

  return {
    source: "supabase" as const,
    companiesResult,
    runsResult,
    marketResult,
    filingsResult,
    rankingResult,
    capitalResult,
    eventsResult,
    rankingExplanationsResult,
    predictionsResult,
    predictionScoresResult,
    automationResult,
    scoresResult,
    valuationsResult,
    phase3Ranking,
  };
}
