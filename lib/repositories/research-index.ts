import "server-only";

import { databaseConfigured, dbQuery } from "@/lib/db";
import { loadLatestDecisionRanking } from "@/lib/decision-ranking-read-model";
import { getSupabase } from "@/lib/supabase";
import { loadLatestDecisionRankingFromPostgres } from "@/lib/repositories/decision-ranking";

function latestRunIds(runs: any[]) {
  const latest = new Map<string, string>();
  for (const run of runs) {
    if (!latest.has(run.company_id)) latest.set(run.company_id, run.id);
  }
  return Array.from(latest.values());
}

export async function loadResearchIndexData() {
  if (databaseConfigured()) {
    const [companies, publishedRuns, phase3Ranking] = await Promise.all([
      dbQuery<any>(`select id,ticker,company_name,sector,industry from public.companies order by ticker`),
      dbQuery<any>(`
        select id,company_id,version,researched_at,price_at_research,summary
        from public.research_runs
        where status = 'published'
        order by version desc
      `),
      loadLatestDecisionRankingFromPostgres(),
    ]);

    const runIds = latestRunIds(publishedRuns);
    const symbols = companies.map((company) => company.ticker);

    const [scores, valuations, market] = await Promise.all([
      runIds.length
        ? dbQuery<any>(
            `
              select research_run_id,overall_score,quality_score,growth_score,valuation_score,
                     financial_strength_score,moat_score,thesis_integrity_score
              from public.scores
              where research_run_id = any($1::uuid[])
            `,
            [runIds],
          )
        : Promise.resolve([]),
      runIds.length
        ? dbQuery<any>(
            `
              select research_run_id,base_value,bear_value,bull_value
              from public.valuations
              where research_run_id = any($1::uuid[])
            `,
            [runIds],
          )
        : Promise.resolve([]),
      symbols.length
        ? dbQuery<any>(
            `
              select distinct on (symbol) symbol,price,trading_date
              from public.market_snapshots
              where symbol = any($1::text[])
              order by symbol, trading_date desc, observed_at desc nulls last
            `,
            [symbols],
          )
        : Promise.resolve([]),
    ]);

    return {
      source: "postgres" as const,
      companies,
      publishedRuns,
      scores,
      valuations,
      market,
      phase3Ranking,
      error: null as Error | null,
    };
  }

  const supabase = getSupabase();
  if (!supabase) return null;

  const [{ data: companies, error: companyError }, { data: publishedRuns, error: runError }] =
    await Promise.all([
      supabase
        .from("companies")
        .select("id,ticker,company_name,sector,industry")
        .order("ticker"),
      supabase
        .from("research_runs")
        .select("id,company_id,version,researched_at,price_at_research,summary")
        .eq("status", "published")
        .order("version", { ascending: false }),
    ]);

  const error = companyError ?? runError;
  if (error) {
    return {
      source: "supabase" as const,
      companies: companies ?? [],
      publishedRuns: publishedRuns ?? [],
      scores: [],
      valuations: [],
      market: [],
      phase3Ranking: { available: false, rankedAt: null, rows: [], error: error.message },
      error: new Error(error.message),
    };
  }

  const phase3Ranking = await loadLatestDecisionRanking(supabase);
  const runs = publishedRuns ?? [];
  const runIds = latestRunIds(runs);
  const symbols = (companies ?? []).map((company) => company.ticker);

  const [scoresResult, valuationsResult, marketResult] = await Promise.all([
    runIds.length
      ? supabase
          .from("scores")
          .select("research_run_id,overall_score,quality_score,growth_score,valuation_score,financial_strength_score,moat_score,thesis_integrity_score")
          .in("research_run_id", runIds)
      : Promise.resolve({ data: [] as any[] }),
    runIds.length
      ? supabase
          .from("valuations")
          .select("research_run_id,base_value,bear_value,bull_value")
          .in("research_run_id", runIds)
      : Promise.resolve({ data: [] as any[] }),
    symbols.length
      ? supabase
          .from("market_snapshots")
          .select("symbol,price,trading_date")
          .in("symbol", symbols)
          .order("trading_date", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
  ]);

  return {
    source: "supabase" as const,
    companies: companies ?? [],
    publishedRuns: runs,
    scores: scoresResult.data ?? [],
    valuations: valuationsResult.data ?? [],
    market: marketResult.data ?? [],
    phase3Ranking,
    error: null as Error | null,
  };
}
