import {
  pgMaybeOne,
  pgQuery,
  postgresConfigured,
} from "./postgres-node.mjs";

export async function loadLatestSolpient100BaselineStates({
  ticker = null,
} = {}) {
  if (!postgresConfigured()) {
    throw new Error("SOLPIENT_DATABASE_URL is not configured.");
  }

  const candidateRun = await pgMaybeOne(
    `select id,candidate_count,evaluation_as_of,input_hash,created_at
     from public.research_candidate_pipeline_runs
     order by evaluation_as_of desc nulls last, created_at desc
     limit 1`,
  );
  if (!candidateRun) {
    throw new Error("No Research Candidate Pipeline run exists.");
  }
  if (Number(candidateRun.candidate_count) !== 100) {
    throw new Error(
      "Solpient 100 Baseline Factory requires the latest governed candidate run to contain exactly 100 members.",
    );
  }

  const factoryRun = await pgMaybeOne(
    `select *
     from public.research_factory_runs
     where source_pipeline_run_id=$1
       and factory_version='research-factory-v1'
     order by created_at desc
     limit 1`,
    [candidateRun.id],
  );

  const values = [candidateRun.id];
  let tickerSql = "";
  if (ticker) {
    values.push(String(ticker).toUpperCase());
    tickerSql = " and upper(i.ticker)=$2";
  }

  const members = await pgQuery(
    `select
       i.id as source_pipeline_item_id,
       i.ticker,
       i.company_id as pipeline_company_id,
       i.stage as candidate_stage,
       i.readiness_state as candidate_readiness_state,
       u.id as source_screen_result_id,
       u.shortlist_rank,
       u.universe_rank,
       u.company_name as screen_company_name,
       u.sector as screen_sector,
       u.industry as screen_industry
     from public.research_candidate_pipeline_items i
     join public.universe_screen_results u
       on u.id=i.universe_screen_result_id
     where i.research_candidate_pipeline_run_id=$1
       ${tickerSql}
     order by u.shortlist_rank asc nulls last, i.ticker asc`,
    values,
  );

  if (!ticker && members.length !== 100) {
    throw new Error(
      `Latest governed Solpient 100 snapshot is incomplete: expected 100, found ${members.length}.`,
    );
  }

  const tickers = members.map((row) => String(row.ticker).toUpperCase());
  if (!tickers.length) {
    return {
      candidateRun,
      factoryRun,
      states: [],
    };
  }

  const companies = await pgQuery(
    `select *
     from public.companies
     where upper(ticker)=any($1::text[])`,
    [tickers],
  );
  const companyByTicker = new Map(
    companies.map((row) => [String(row.ticker).toUpperCase(), row]),
  );
  const companyIds = companies.map((row) => row.id);

  const factoryItems = factoryRun
    ? await pgQuery(
        `select *
         from public.research_factory_items
         where research_factory_run_id=$1
           and upper(ticker)=any($2::text[])`,
        [factoryRun.id, tickers],
      )
    : [];
  const factoryByTicker = new Map(
    factoryItems.map((row) => [String(row.ticker).toUpperCase(), row]),
  );

  const [
    industryAssignments,
    fundamentalStats,
    marketStats,
    contexts,
    baselines,
    coverages,
    valuationDrafts,
    compositions,
    reviews,
    researchRuns,
  ] = companyIds.length
    ? await Promise.all([
        pgQuery(
          `select distinct on (company_id)
             id,company_id,research_factory_item_id,ticker,module,status,confidence,
             policy_version,decision_hash,created_at
           from public.research_factory_industry_assignments
           where company_id=any($1::uuid[])
             and status='applied'
           order by company_id,created_at desc`,
          [companyIds],
        ),
        pgQuery(
          `select
             company_id,
             count(*)::int as fundamental_rows,
             count(*) filter (
               where provider='sec_companyfacts'
                  or provider='sec'
                  or provider ilike '%edgar%'
                  or coalesce(source_url,'') ilike '%sec.gov%'
             )::int as sec_fundamental_rows,
             max(observed_at) as latest_fundamental_observed_at,
             max(period_end) as latest_fundamental_period
           from public.fundamental_snapshots
           where company_id=any($1::uuid[])
           group by company_id`,
          [companyIds],
        ),
        pgQuery(
          `select
             company_id,
             count(distinct trading_date)::int as market_days,
             max(observed_at) as latest_market_observed_at,
             max(trading_date) as latest_market_date
           from public.market_snapshots
           where company_id=any($1::uuid[])
             and price>0
           group by company_id`,
          [companyIds],
        ),
        pgQuery(
          `select distinct on (company_id)
             id,company_id,context_version,as_of_date,knowledge_cutoff_at,
             generated_at,updated_at
           from public.research_context_packs
           where company_id=any($1::uuid[])
           order by company_id,as_of_date desc,generated_at desc`,
          [companyIds],
        ),
        pgQuery(
          `select distinct on (company_id)
             id,company_id,generation_version,generated_at,source_cutoff_at,
             industry_module,status,evidence_completeness_pct,standard_valid,
             standard_status
           from public.baseline_drafts
           where company_id=any($1::uuid[])
           order by company_id,generated_at desc,created_at desc`,
          [companyIds],
        ),
        pgQuery(
          `select distinct on (company_id)
             id,company_id,engine_version,as_of_date,status,overall_pct,
             decision_readiness_pct,generated_at,updated_at
           from public.data_coverage_reports
           where company_id=any($1::uuid[])
             and engine_version='coverage-v2'
           order by company_id,as_of_date desc,generated_at desc`,
          [companyIds],
        ),
        pgQuery(
          `select distinct on (company_id)
             id,company_id,research_factory_item_id,ticker,industry_module,
             status,input_hash,created_at
           from public.research_factory_valuation_drafts
           where company_id=any($1::uuid[])
             and status='draft'
           order by company_id,created_at desc`,
          [companyIds],
        ),
        pgQuery(
          `select distinct on (company_id)
             id,draft_id,company_id,engine_version,status,composition_payload,
             validation_result,generated_at,updated_at
           from public.research_compositions
           where company_id=any($1::uuid[])
             and engine_version='composer-v2'
             and status in ('generated','applied')
           order by company_id,generated_at desc,updated_at desc`,
          [companyIds],
        ),
        pgQuery(
          `select distinct on (d.company_id)
             r.id,r.draft_id,d.company_id,r.status,r.promotion_readiness,
             r.reviewed_at,r.prepared_at,r.preparation_source,
             r.human_verified_at,r.human_verified_by,
             r.human_verified_payload_hash,r.attestation_version,
             r.published_run_id,r.updated_at
           from public.baseline_reviews r
           join public.baseline_drafts d on d.id=r.draft_id
           where d.company_id=any($1::uuid[])
           order by d.company_id,r.updated_at desc,r.prepared_at desc nulls last`,
          [companyIds],
        ),
        pgQuery(
          `select distinct on (company_id)
             id,company_id,version,status,standard_status,researched_at
           from public.research_runs
           where company_id=any($1::uuid[])
             and status='published'
           order by company_id,version desc,researched_at desc`,
          [companyIds],
        ),
      ])
    : [[], [], [], [], [], [], [], [], [], []];

  function mapByCompany(rows) {
    return new Map(rows.map((row) => [row.company_id, row]));
  }

  const industryByCompany = mapByCompany(industryAssignments);
  const fundamentalByCompany = mapByCompany(fundamentalStats);
  const marketByCompany = mapByCompany(marketStats);
  const contextByCompany = mapByCompany(contexts);
  const baselineByCompany = mapByCompany(baselines);
  const coverageByCompany = mapByCompany(coverages);
  const valuationByCompany = mapByCompany(valuationDrafts);
  const compositionByCompany = mapByCompany(compositions);
  const reviewByCompany = mapByCompany(reviews);
  const researchByCompany = mapByCompany(researchRuns);

  const states = members.map((member, index) => {
    const symbol = String(member.ticker).toUpperCase();
    const company =
      companyByTicker.get(symbol) ??
      (member.pipeline_company_id
        ? companies.find((row) => row.id === member.pipeline_company_id) ?? null
        : null);
    const companyId = company?.id ?? member.pipeline_company_id ?? null;
    const factoryItem = factoryByTicker.get(symbol) ?? null;
    const industry = companyId ? industryByCompany.get(companyId) ?? null : null;
    const fundamentals = companyId
      ? fundamentalByCompany.get(companyId) ?? null
      : null;
    const market = companyId ? marketByCompany.get(companyId) ?? null : null;
    const context = companyId ? contextByCompany.get(companyId) ?? null : null;
    const baseline = companyId ? baselineByCompany.get(companyId) ?? null : null;
    const coverage = companyId ? coverageByCompany.get(companyId) ?? null : null;
    const valuation = companyId ? valuationByCompany.get(companyId) ?? null : null;
    const composition = companyId
      ? compositionByCompany.get(companyId) ?? null
      : null;
    const review = companyId ? reviewByCompany.get(companyId) ?? null : null;
    const research = companyId ? researchByCompany.get(companyId) ?? null : null;
    const validation =
      composition?.validation_result &&
      typeof composition.validation_result === "object"
        ? composition.validation_result
        : {};

    return {
      ticker: symbol,
      ordinal: Number(member.shortlist_rank ?? index + 1),
      candidate_stage: member.candidate_stage ?? null,
      candidate_readiness_state: member.candidate_readiness_state ?? null,
      source_pipeline_item_id: member.source_pipeline_item_id,
      source_screen_result_id: member.source_screen_result_id,
      company_id: companyId,
      company_name: company?.company_name ?? member.screen_company_name ?? symbol,
      sector: company?.sector ?? member.screen_sector ?? null,
      industry: company?.industry ?? member.screen_industry ?? null,
      factory_run_id: factoryRun?.id ?? null,
      factory_item_id: factoryItem?.id ?? null,
      factory_stage: factoryItem?.stage ?? null,
      factory_status: factoryItem?.status ?? null,
      industry_assignment_id: industry?.id ?? null,
      industry_module: industry?.module ?? null,
      industry_assignment_confidence:
        industry?.confidence == null ? null : Number(industry.confidence),
      industry_assignment_created_at: industry?.created_at ?? null,
      fundamental_rows: Number(fundamentals?.fundamental_rows ?? 0),
      sec_fundamental_rows: Number(fundamentals?.sec_fundamental_rows ?? 0),
      latest_fundamental_observed_at:
        fundamentals?.latest_fundamental_observed_at ?? null,
      latest_fundamental_period:
        fundamentals?.latest_fundamental_period ?? null,
      market_days: Number(market?.market_days ?? 0),
      latest_market_observed_at: market?.latest_market_observed_at ?? null,
      latest_market_date: market?.latest_market_date ?? null,
      context_pack_id: context?.id ?? null,
      context_generated_at: context?.generated_at ?? null,
      context_knowledge_cutoff_at: context?.knowledge_cutoff_at ?? null,
      baseline_draft_id: baseline?.id ?? null,
      baseline_generated_at: baseline?.generated_at ?? null,
      baseline_source_cutoff_at: baseline?.source_cutoff_at ?? null,
      baseline_industry_module: baseline?.industry_module ?? null,
      baseline_evidence_completeness_pct:
        baseline?.evidence_completeness_pct == null
          ? null
          : Number(baseline.evidence_completeness_pct),
      coverage_report_id: coverage?.id ?? null,
      coverage_generated_at: coverage?.generated_at ?? null,
      coverage_status: coverage?.status ?? null,
      coverage_overall_pct:
        coverage?.overall_pct == null ? null : Number(coverage.overall_pct),
      decision_readiness_pct:
        coverage?.decision_readiness_pct == null
          ? null
          : Number(coverage.decision_readiness_pct),
      valuation_draft_id: valuation?.id ?? null,
      valuation_created_at: valuation?.created_at ?? null,
      composition_id: composition?.id ?? null,
      composition_draft_id: composition?.draft_id ?? null,
      composition_generated_at: composition?.generated_at ?? null,
      composition_valid: validation?.valid === true,
      composition_public_ready: validation?.decisionGradeReady === true,
      review_id: review?.id ?? null,
      review_draft_id: review?.draft_id ?? null,
      review_status: review?.status ?? null,
      review_promotion_ready: review?.promotion_readiness?.ready === true,
      review_human_verified_at: review?.human_verified_at ?? null,
      review_published_run_id: review?.published_run_id ?? null,
      published_research_run_id: research?.id ?? null,
      published_research_version: research?.version ?? null,
    };
  });

  return {
    candidateRun,
    factoryRun,
    states,
  };
}
