alter table public.research_runs
  add column if not exists standard_version text,
  add column if not exists standard_status text not null default 'legacy',
  add column if not exists data_cutoff_at timestamptz,
  add column if not exists benchmark_ticker text not null default 'SPY',
  add column if not exists completeness_pct numeric,
  add column if not exists validation_notes jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'research_runs_standard_status_check'
  ) then
    alter table public.research_runs
      add constraint research_runs_standard_status_check
      check (standard_status in ('legacy','partial','complete'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'research_runs_completeness_check'
  ) then
    alter table public.research_runs
      add constraint research_runs_completeness_check
      check (completeness_pct is null or (completeness_pct >= 0 and completeness_pct <= 100));
  end if;
end $$;

alter table public.thesis_variables
  add column if not exists metric_key text,
  add column if not exists comparator text,
  add column if not exists threshold_value numeric,
  add column if not exists threshold_unit text,
  add column if not exists review_frequency text,
  add column if not exists breaker_condition text;

create table if not exists public.business_assessments (
  id uuid primary key default gen_random_uuid(),
  research_run_id uuid not null unique references public.research_runs(id) on delete cascade,
  business_quality_rating text not null,
  moat_rating text not null,
  pricing_power text,
  revenue_model text,
  recurring_revenue_pct numeric,
  customer_concentration text,
  geographic_exposure text,
  market_position text,
  growth_runway text,
  cyclicality text,
  capital_intensity text,
  ai_opportunity text,
  ai_threat text,
  management_quality text,
  capital_allocation_assessment text,
  bull_thesis text,
  bear_thesis text,
  capital_allocation_test text,
  biggest_unknown text,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.metric_observations (
  id uuid primary key default gen_random_uuid(),
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  module text not null default 'universal',
  metric_key text not null,
  label text not null,
  value_numeric numeric,
  value_text text,
  unit text,
  period_start date,
  period_end date,
  period_type text,
  basis text not null default 'reported',
  status text not null default 'available',
  source_title text,
  source_url text,
  calculation_method text,
  notes text,
  created_at timestamptz not null default now(),
  unique(research_run_id, module, metric_key)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'metric_observations_basis_check'
  ) then
    alter table public.metric_observations
      add constraint metric_observations_basis_check
      check (basis in ('reported','derived','estimate','assumption','assessment'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'metric_observations_status_check'
  ) then
    alter table public.metric_observations
      add constraint metric_observations_status_check
      check (status in ('available','not_available','not_applicable'));
  end if;
end $$;

create table if not exists public.risk_register (
  id uuid primary key default gen_random_uuid(),
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  risk_key text not null,
  category text not null,
  title text not null,
  description text,
  probability text not null,
  severity text not null,
  leading_indicators text,
  thesis_breaker text,
  evidence text,
  source_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(research_run_id, risk_key)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'risk_register_probability_check'
  ) then
    alter table public.risk_register
      add constraint risk_register_probability_check
      check (probability in ('low','medium','high'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'risk_register_severity_check'
  ) then
    alter table public.risk_register
      add constraint risk_register_severity_check
      check (severity in ('low','medium','high'));
  end if;
end $$;

create table if not exists public.expected_return_scenarios (
  id uuid primary key default gen_random_uuid(),
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  scenario text not null,
  horizon_years integer not null,
  starting_fcf_yield numeric,
  fcf_growth_assumption numeric,
  revenue_growth_assumption numeric,
  margin_change_contribution numeric,
  share_count_contribution numeric,
  dividend_contribution numeric,
  multiple_change_contribution numeric,
  exit_multiple numeric,
  expected_cagr numeric,
  estimated_terminal_value_per_share numeric,
  methodology text not null,
  assumptions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(research_run_id, scenario, horizon_years)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'expected_return_scenario_check'
  ) then
    alter table public.expected_return_scenarios
      add constraint expected_return_scenario_check
      check (scenario in ('bear','base','bull'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'expected_return_horizon_check'
  ) then
    alter table public.expected_return_scenarios
      add constraint expected_return_horizon_check
      check (horizon_years in (3,5,10));
  end if;
end $$;

create index if not exists metric_observations_run_idx
  on public.metric_observations(research_run_id, module);
create index if not exists risk_register_run_idx
  on public.risk_register(research_run_id);
create index if not exists expected_return_run_idx
  on public.expected_return_scenarios(research_run_id, horizon_years);
create index if not exists thesis_variables_metric_idx
  on public.thesis_variables(research_run_id, metric_key);

alter table public.business_assessments enable row level security;
alter table public.metric_observations enable row level security;
alter table public.risk_register enable row level security;
alter table public.expected_return_scenarios enable row level security;

drop policy if exists "public read business assessments" on public.business_assessments;
create policy "public read business assessments"
  on public.business_assessments for select to anon, authenticated using (true);

drop policy if exists "public read metric observations" on public.metric_observations;
create policy "public read metric observations"
  on public.metric_observations for select to anon, authenticated using (true);

drop policy if exists "public read risk register" on public.risk_register;
create policy "public read risk register"
  on public.risk_register for select to anon, authenticated using (true);

drop policy if exists "public read expected return scenarios" on public.expected_return_scenarios;
create policy "public read expected return scenarios"
  on public.expected_return_scenarios for select to anon, authenticated using (true);

revoke all on table public.business_assessments from anon, authenticated;
revoke all on table public.metric_observations from anon, authenticated;
revoke all on table public.risk_register from anon, authenticated;
revoke all on table public.expected_return_scenarios from anon, authenticated;

grant select on table public.business_assessments to anon, authenticated;
grant select on table public.metric_observations to anon, authenticated;
grant select on table public.risk_register to anon, authenticated;
grant select on table public.expected_return_scenarios to anon, authenticated;

grant all on table public.business_assessments to service_role;
grant all on table public.metric_observations to service_role;
grant all on table public.risk_register to service_role;
grant all on table public.expected_return_scenarios to service_role;
