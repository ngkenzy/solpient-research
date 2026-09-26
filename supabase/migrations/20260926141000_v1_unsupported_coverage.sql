-- V1 quick wins: UNSUPPORTED coverage level (PRD section 12).
-- Additive only. Widen the coverage_level check constraints on
-- research_coverage_states and research_coverage_history to admit the new
-- UNSUPPORTED level, and teach the deterministic evaluator so the
-- research_coverage_state_guard trigger can persist it.
-- Existing constraint names (from 20260925090000_group_a_research_foundation_schema.sql):
--   research_coverage_states_level_check
--   research_coverage_history_from_check
--   research_coverage_history_to_check

alter table public.research_coverage_states
  drop constraint if exists research_coverage_states_level_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='research_coverage_states_level_check_v1'
  ) then
    alter table public.research_coverage_states
      add constraint research_coverage_states_level_check_v1
      check (coverage_level in ('MONITORED','RESEARCHED','DEEP_COVERAGE','UNSUPPORTED'));
  end if;
end $$;

alter table public.research_coverage_history
  drop constraint if exists research_coverage_history_from_check,
  drop constraint if exists research_coverage_history_to_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='research_coverage_history_from_check_v1'
  ) then
    alter table public.research_coverage_history
      add constraint research_coverage_history_from_check_v1
      check (from_level is null or from_level in ('MONITORED','RESEARCHED','DEEP_COVERAGE','UNSUPPORTED'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname='research_coverage_history_to_check_v1'
  ) then
    alter table public.research_coverage_history
      add constraint research_coverage_history_to_check_v1
      check (to_level in ('MONITORED','RESEARCHED','DEEP_COVERAGE','UNSUPPORTED'));
  end if;
end $$;

-- Deterministic evaluator: derive UNSUPPORTED when the company has no usable
-- evidence base (no market data AND no fundamentals AND no SEC filings),
-- mirroring deriveCoverageLevel() in lib/research-foundation.mjs.
-- Any one of the three evidence sources keeps the company at least MONITORED.
create or replace function public.evaluate_research_coverage_v1(
  p_company_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path=''
as $$
declare
  v_ticker text;
  v_run_id uuid;
  v_published_at timestamptz;
  v_published_count integer := 0;
  v_business_count integer := 0;
  v_thesis_count integer := 0;
  v_valuation_count integer := 0;
  v_risk_count integer := 0;
  v_manifest_count integer := 0;
  v_prediction_count integer := 0;
  v_valuation_history_count integer := 0;
  v_capital_years integer := 0;
  v_required_fresh integer := 0;
  v_required_total integer := 0;
  v_researched boolean := false;
  v_deep boolean := false;
  v_has_market boolean := false;
  v_has_fundamentals boolean := false;
  v_has_filings boolean := false;
  v_level text := 'MONITORED';
  v_reason text;
begin
  select c.ticker into v_ticker from public.companies c where c.id=p_company_id;
  if v_ticker is null then
    raise exception 'Unknown company %.',p_company_id;
  end if;

  select rr.id,coalesce(rr.published_at,rr.researched_at)
    into v_run_id,v_published_at
  from public.research_runs rr
  where rr.company_id=p_company_id
    and rr.status='published'
    and coalesce(rr.published_at,rr.researched_at)<=p_as_of
  order by rr.version desc
  limit 1;

  select count(*) into v_published_count
  from public.research_runs rr
  where rr.company_id=p_company_id
    and rr.status='published'
    and coalesce(rr.published_at,rr.researched_at)<=p_as_of;

  if v_run_id is not null then
    select count(*) into v_business_count from public.business_assessments where research_run_id=v_run_id;
    select count(*) into v_thesis_count from public.thesis_variables where research_run_id=v_run_id;
    select count(*) into v_valuation_count from public.valuations where research_run_id=v_run_id;
    select count(*) into v_risk_count from public.risk_register where research_run_id=v_run_id;
    select count(*) into v_manifest_count from public.research_input_manifests where research_run_id=v_run_id;
  end if;

  v_researched :=
    v_run_id is not null
    and v_business_count>0
    and v_thesis_count>0
    and v_valuation_count>0
    and v_risk_count>0
    and v_manifest_count>0;

  select count(*) into v_prediction_count
  from public.prediction_snapshots ps
  where ps.company_id=p_company_id
    and ps.locked_at is not null
    and ps.predicted_at<=p_as_of;

  select count(*) into v_valuation_history_count
  from public.valuation_history vh
  where vh.company_id=p_company_id
    and vh.trading_date<=p_as_of::date;

  select count(distinct cah.fiscal_year) into v_capital_years
  from public.capital_allocation_history cah
  where cah.company_id=p_company_id
    and cah.fiscal_year is not null
    and cah.period_end<=p_as_of::date;

  select count(*) into v_required_total
  from public.research_freshness_policies p
  where p.methodology_version='research-freshness-v1'
    and p.required_for_deep_coverage;

  select count(*) into v_required_fresh
  from public.research_freshness_policies p
  join public.research_component_freshness f
    on f.company_id=p_company_id and f.component_key=p.component_key
  where p.methodology_version='research-freshness-v1'
    and p.required_for_deep_coverage
    and f.status='CURRENT';

  select exists(
    select 1 from public.market_snapshots ms
    where ms.company_id=p_company_id or ms.symbol=v_ticker
  ) into v_has_market;

  select exists(
    select 1 from public.fundamental_snapshots fs
    where fs.company_id=p_company_id
  ) into v_has_fundamentals;

  select exists(
    select 1 from public.filing_events fe
    where fe.company_id=p_company_id
  ) into v_has_filings;

  v_deep :=
    v_researched
    and v_published_count>=2
    and v_prediction_count>=1
    and v_valuation_history_count>=12
    and v_capital_years>=3
    and v_required_total>0
    and v_required_fresh=v_required_total;

  if not v_has_market and not v_has_fundamentals and not v_has_filings then
    v_level:='UNSUPPORTED';
    v_reason:='Insufficient data or security type not currently supported: no market data, no fundamentals, and no SEC filings observed.';
  elsif v_deep then
    v_level:='DEEP_COVERAGE';
    v_reason:='Reviewed Research plus historical depth, locked prediction history, capital allocation, valuation history, and all required freshness components are current.';
  elsif v_researched then
    v_level:='RESEARCHED';
    v_reason:='Latest published Research contains reviewed business assessment, thesis variables, valuation, risks, and frozen evidence manifest.';
  else
    v_level:='MONITORED';
    v_reason:='Canonical company is monitorable, but deterministic reviewed-Research prerequisites are not all satisfied.';
  end if;

  return jsonb_build_object(
    'coverage_level',v_level,
    'methodology_version','research-coverage-v1',
    'reason',v_reason,
    'latest_research_run_id',v_run_id,
    'latest_published_at',v_published_at,
    'prerequisites',jsonb_build_object(
      'published_research_versions',v_published_count,
      'business_assessment',v_business_count>0,
      'thesis_variables',v_thesis_count,
      'valuation',v_valuation_count>0,
      'risks',v_risk_count,
      'frozen_input_manifest',v_manifest_count>0,
      'locked_predictions',v_prediction_count,
      'valuation_history_observations',v_valuation_history_count,
      'capital_allocation_years',v_capital_years,
      'required_fresh_components',v_required_fresh,
      'required_fresh_components_total',v_required_total,
      'has_market_data',v_has_market,
      'has_fundamentals',v_has_fundamentals,
      'has_sec_filings',v_has_filings
    )
  );
end $$;
