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

function sortSolpient100(rows: any[]) {
  return [...rows].sort((a, b) => {
    const ar = Number(a.shortlist_rank ?? Number.MAX_SAFE_INTEGER);
    const br = Number(b.shortlist_rank ?? Number.MAX_SAFE_INTEGER);
    if (ar !== br) return ar - br;
    return String(a.ticker ?? "").localeCompare(String(b.ticker ?? ""));
  });
}

async function loadPostgresSolpient100() {
  const runs = await dbQuery<any>(`
    select id,universe_screen_run_id,pipeline_version,evaluation_as_of,input_hash,
           candidate_count,decision_ready_count,research_ready_count,building_count,created_at
    from public.research_candidate_pipeline_runs
    order by evaluation_as_of desc nulls last, created_at desc
    limit 1
  `);

  const run = runs[0] ?? null;
  if (!run) return { run: null, members: [] as any[], complete: false };

  const members = await dbQuery<any>(
    `
      select
        i.ticker,
        i.company_id,
        i.stage,
        i.readiness_state,
        i.decision_score as pipeline_decision_score,
        i.evidence_confidence as pipeline_evidence_confidence,
        u.company_name,
        u.sector,
        u.industry,
        u.shortlist_rank,
        u.universe_rank,
        u.screen_score,
        u.quality_core_score,
        u.evidence_coverage_pct
      from public.research_candidate_pipeline_items i
      join public.universe_screen_results u
        on u.id = i.universe_screen_result_id
      where i.research_candidate_pipeline_run_id = $1
      order by u.shortlist_rank asc nulls last, i.ticker asc
    `,
    [run.id],
  );

  const expected = Number(run.candidate_count);
  return {
    run,
    members: sortSolpient100(members),
    complete: expected === 100 && members.length === 100,
  };
}

async function loadSupabaseSolpient100(supabase: any) {
  const { data: runs, error: runError } = await supabase
    .from("research_candidate_pipeline_runs")
    .select("id,universe_screen_run_id,pipeline_version,evaluation_as_of,input_hash,candidate_count,decision_ready_count,research_ready_count,building_count,created_at")
    .order("evaluation_as_of", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (runError) throw runError;
  const run = runs?.[0] ?? null;
  if (!run) return { run: null, members: [] as any[], complete: false };

  const { data: items, error: itemsError } = await supabase
    .from("research_candidate_pipeline_items")
    .select("ticker,company_id,stage,readiness_state,decision_score,evidence_confidence,universe_screen_result_id")
    .eq("research_candidate_pipeline_run_id", run.id);

  if (itemsError) throw itemsError;

  const screenIds = [...new Set((items ?? []).map((item: any) => item.universe_screen_result_id).filter(Boolean))];
  const screenResult = screenIds.length
    ? await supabase
        .from("universe_screen_results")
        .select("id,company_name,sector,industry,shortlist_rank,universe_rank,screen_score,quality_core_score,evidence_coverage_pct")
        .in("id", screenIds)
    : { data: [] as any[], error: null };

  if (screenResult.error) throw screenResult.error;
  const screenById = new Map((screenResult.data ?? []).map((row: any) => [row.id, row]));

  const members = (items ?? []).map((item: any) => {
    const screen: any = screenById.get(item.universe_screen_result_id) ?? {};
    return {
      ticker: item.ticker,
      company_id: item.company_id,
      stage: item.stage,
      readiness_state: item.readiness_state,
      pipeline_decision_score: item.decision_score,
      pipeline_evidence_confidence: item.evidence_confidence,
      company_name: screen.company_name ?? item.ticker,
      sector: screen.sector ?? null,
      industry: screen.industry ?? null,
      shortlist_rank: screen.shortlist_rank ?? null,
      universe_rank: screen.universe_rank ?? null,
      screen_score: screen.screen_score ?? null,
      quality_core_score: screen.quality_core_score ?? null,
      evidence_coverage_pct: screen.evidence_coverage_pct ?? null,
    };
  });

  const expected = Number(run.candidate_count);
  return {
    run,
    members: sortSolpient100(members),
    complete: expected === 100 && members.length === 100,
  };
}

export async function loadResearchIndexData() {
  if (databaseConfigured()) {
    const membership = await loadPostgresSolpient100();
    const symbols = membership.members.map((member: any) => String(member.ticker).toUpperCase());
    const memberCompanyIds = membership.members
      .map((member: any) => member.company_id)
      .filter(Boolean);

    const [companies, publishedRuns, phase3Ranking] = await Promise.all([
      symbols.length
        ? dbQuery<any>(
            `
              select id,ticker,company_name,sector,industry
              from public.companies
              where ticker = any($1::text[])
              order by ticker
            `,
            [symbols],
          )
        : Promise.resolve([]),
      memberCompanyIds.length
        ? dbQuery<any>(
            `
              select id,company_id,version,researched_at,price_at_research,summary
              from public.research_runs
              where status = 'published'
                and company_id = any($1::uuid[])
              order by version desc
            `,
            [memberCompanyIds],
          )
        : Promise.resolve([]),
      loadLatestDecisionRankingFromPostgres(),
    ]);

    const runIds = latestRunIds(publishedRuns);

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
      solpient100: membership.members,
      solpient100Run: membership.run,
      solpient100Complete: membership.complete,
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

  try {
    const membership = await loadSupabaseSolpient100(supabase);
    const symbols = membership.members.map((member: any) => String(member.ticker).toUpperCase());

    const companyResult = symbols.length
      ? await supabase
          .from("companies")
          .select("id,ticker,company_name,sector,industry")
          .in("ticker", symbols)
          .order("ticker")
      : { data: [] as any[], error: null };

    if (companyResult.error) throw companyResult.error;
    const companies = companyResult.data ?? [];
    const companyIds = companies.map((company: any) => company.id);

    const runResult = companyIds.length
      ? await supabase
          .from("research_runs")
          .select("id,company_id,version,researched_at,price_at_research,summary")
          .eq("status", "published")
          .in("company_id", companyIds)
          .order("version", { ascending: false })
      : { data: [] as any[], error: null };

    if (runResult.error) throw runResult.error;

    const phase3Ranking = await loadLatestDecisionRanking(supabase);
    const runs = runResult.data ?? [];
    const runIds = latestRunIds(runs);

    const [scoresResult, valuationsResult, marketResult] = await Promise.all([
      runIds.length
        ? supabase
            .from("scores")
            .select("research_run_id,overall_score,quality_score,growth_score,valuation_score,financial_strength_score,moat_score,thesis_integrity_score")
            .in("research_run_id", runIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      runIds.length
        ? supabase
            .from("valuations")
            .select("research_run_id,base_value,bear_value,bull_value")
            .in("research_run_id", runIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      symbols.length
        ? supabase
            .from("market_snapshots")
            .select("symbol,price,trading_date")
            .in("symbol", symbols)
            .order("trading_date", { ascending: false })
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    const childError = scoresResult.error ?? valuationsResult.error ?? marketResult.error;
    if (childError) throw childError;

    return {
      source: "supabase" as const,
      solpient100: membership.members,
      solpient100Run: membership.run,
      solpient100Complete: membership.complete,
      companies,
      publishedRuns: runs,
      scores: scoresResult.data ?? [],
      valuations: valuationsResult.data ?? [],
      market: marketResult.data ?? [],
      phase3Ranking,
      error: null as Error | null,
    };
  } catch (error) {
    return {
      source: "supabase" as const,
      solpient100: [] as any[],
      solpient100Run: null,
      solpient100Complete: false,
      companies: [] as any[],
      publishedRuns: [] as any[],
      scores: [] as any[],
      valuations: [] as any[],
      market: [] as any[],
      phase3Ranking: { available: false, rankedAt: null, rows: [], error: error instanceof Error ? error.message : String(error) },
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
