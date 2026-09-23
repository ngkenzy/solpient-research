import "server-only";

import { databaseConfigured, dbQuery } from "@/lib/db";
import { getSupabase } from "@/lib/supabase";

function first<T>(rows: T[]) {
  return rows[0] ?? null;
}

async function latestMarketPostgres(ticker: string) {
  return first(
    await dbQuery<any>(
      `
        select price,trading_date,provider,observed_at
        from public.market_snapshots
        where symbol = $1
        order by trading_date desc, observed_at desc nulls last
        limit 1
      `,
      [ticker],
    ),
  );
}

export async function loadCompanyResearchData(
  ticker: string,
  requestedVersion: number | null,
) {
  if (databaseConfigured()) {
    const company = first(
      await dbQuery<any>(
        `select * from public.companies where ticker = $1 limit 1`,
        [ticker],
      ),
    );

    if (!company) {
      return {
        source: "postgres" as const,
        company: null,
        run: null,
        scores: null,
        valuation: null,
        metrics: null,
        thesis: [],
        sources: [],
        history: [],
        changes: [],
        v2: null,
        latestMarket: null,
        baselineComposition: null,
      };
    }

    const run = first(
      await dbQuery<any>(
        requestedVersion == null
          ? `
              select *
              from public.research_runs
              where company_id = $1 and status = 'published'
              order by version desc
              limit 1
            `
          : `
              select *
              from public.research_runs
              where company_id = $1 and status = 'published' and version = $2
              limit 1
            `,
        requestedVersion == null ? [company.id] : [company.id, requestedVersion],
      ),
    );

    if (!run) {
      const latestMarket = await latestMarketPostgres(company.ticker);
      return {
        source: "postgres" as const,
        company,
        run: null,
        scores: null,
        valuation: null,
        metrics: null,
        thesis: [],
        sources: [],
        history: [],
        changes: [],
        v2: null,
        latestMarket,
        baselineComposition: null,
      };
    }

    const frozenAsOf = requestedVersion != null
      ? String(run.data_cutoff_at ?? run.researched_at ?? "")
      : null;
    const frozenDate = frozenAsOf ? frozenAsOf.slice(0, 10) : null;

    const [
      scores,
      valuation,
      metrics,
      thesis,
      sources,
      history,
      changes,
      v2,
      latestMarket,
    ] = await Promise.all([
      dbQuery<any>(
        `select * from public.scores where research_run_id = $1 limit 1`,
        [run.id],
      ).then(first),
      dbQuery<any>(
        `select * from public.valuations where research_run_id = $1 limit 1`,
        [run.id],
      ).then(first),
      dbQuery<any>(
        `select * from public.financial_metrics where research_run_id = $1 limit 1`,
        [run.id],
      ).then(first),
      dbQuery<any>(
        `
          select *
          from public.thesis_variables
          where research_run_id = $1
          order by created_at
        `,
        [run.id],
      ),
      dbQuery<any>(
        `
          select *
          from public.sources
          where research_run_id = $1
          order by retrieved_at desc
        `,
        [run.id],
      ),
      dbQuery<any>(
        `
          select id,version,researched_at,price_at_research,status
          from public.research_runs
          where company_id = $1 and status = 'published'
          order by version desc
        `,
        [company.id],
      ),
      dbQuery<any>(
        `
          select *
          from public.research_changes
          where current_run_id = $1
          order by category, created_at
        `,
        [run.id],
      ),
      dbQuery<any>(
        `select * from public.research_v2_sections where research_run_id = $1 limit 1`,
        [run.id],
      ).then(first),
      frozenAsOf && frozenDate
        ? dbQuery<any>(
            `
              select price,trading_date,provider,observed_at
              from public.market_snapshots
              where symbol = $1
                and trading_date <= $2::date
                and observed_at <= $3::timestamptz
              order by trading_date desc, observed_at desc nulls last
              limit 1
            `,
            [company.ticker, frozenDate, frozenAsOf],
          ).then(first)
        : dbQuery<any>(
            `
              select price,trading_date,provider,observed_at
              from public.market_snapshots
              where symbol = $1
              order by trading_date desc, observed_at desc nulls last
              limit 1
            `,
            [company.ticker],
          ).then(first),
    ]);

    return {
      source: "postgres" as const,
      company,
      run,
      scores,
      valuation,
      metrics,
      thesis,
      sources,
      history,
      changes,
      v2,
      latestMarket,
      baselineComposition: null,
    };
  }

  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("ticker", ticker)
    .maybeSingle();

  if (!company) {
    return {
      source: "supabase" as const,
      company: null,
      run: null,
      scores: null,
      valuation: null,
      metrics: null,
      thesis: [],
      sources: [],
      history: [],
      changes: [],
      v2: null,
      latestMarket: null,
      baselineComposition: null,
    };
  }

  let runQuery = supabase
    .from("research_runs")
    .select("*")
    .eq("company_id", company.id)
    .eq("status", "published");

  if (requestedVersion != null) {
    runQuery = runQuery.eq("version", requestedVersion);
  } else {
    runQuery = runQuery.order("version", { ascending: false }).limit(1);
  }

  const { data: run } = await runQuery.maybeSingle();

  if (!run) {
    const { data: latestMarket } = await supabase
      .from("market_snapshots")
      .select("price,trading_date,provider,observed_at")
      .eq("symbol", company.ticker)
      .order("trading_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      source: "supabase" as const,
      company,
      run: null,
      scores: null,
      valuation: null,
      metrics: null,
      thesis: [],
      sources: [],
      history: [],
      changes: [],
      v2: null,
      latestMarket,
      baselineComposition: null,
    };
  }

  const [
    scoresResult,
    valuationResult,
    metricsResult,
    thesisResult,
    sourcesResult,
    historyResult,
    changesResult,
    v2Result,
  ] = await Promise.all([
    supabase.from("scores").select("*").eq("research_run_id", run.id).maybeSingle(),
    supabase.from("valuations").select("*").eq("research_run_id", run.id).maybeSingle(),
    supabase.from("financial_metrics").select("*").eq("research_run_id", run.id).maybeSingle(),
    supabase.from("thesis_variables").select("*").eq("research_run_id", run.id).order("created_at"),
    supabase.from("sources").select("*").eq("research_run_id", run.id).order("retrieved_at", { ascending: false }),
    supabase
      .from("research_runs")
      .select("id,version,researched_at,price_at_research,status")
      .eq("company_id", company.id)
      .eq("status", "published")
      .order("version", { ascending: false }),
    supabase
      .from("research_changes")
      .select("*")
      .eq("current_run_id", run.id)
      .order("category")
      .order("created_at"),
    supabase
      .from("research_v2_sections")
      .select("*")
      .eq("research_run_id", run.id)
      .maybeSingle(),
  ]);

  const frozenAsOf = requestedVersion != null
    ? String(run.data_cutoff_at ?? run.researched_at ?? "")
    : null;
  const frozenDate = frozenAsOf ? frozenAsOf.slice(0, 10) : null;

  let marketQuery = supabase
    .from("market_snapshots")
    .select("price,trading_date,provider,observed_at")
    .eq("symbol", company.ticker);

  if (frozenAsOf && frozenDate) {
    marketQuery = marketQuery
      .lte("trading_date", frozenDate)
      .lte("observed_at", frozenAsOf);
  }

  const { data: latestMarket } = await marketQuery
    .order("trading_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    source: "supabase" as const,
    company,
    run,
    scores: scoresResult.data,
    valuation: valuationResult.data,
    metrics: metricsResult.data,
    thesis: thesisResult.data ?? [],
    sources: sourcesResult.data ?? [],
    history: historyResult.data ?? [],
    changes: changesResult.data ?? [],
    v2: v2Result.data ?? null,
    latestMarket,
    baselineComposition: null,
  };
}
