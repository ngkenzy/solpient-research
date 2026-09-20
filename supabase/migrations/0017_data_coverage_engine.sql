create table if not exists public.data_coverage_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  engine_version text not null,
  as_of_date date not null,
  status text not null,
  fundamentals_pct numeric not null default 0,
  balance_sheet_pct numeric not null default 0,
  history_pct numeric not null default 0,
  market_history_pct numeric not null default 0,
  industry_pct numeric not null default 0,
  peer_pct numeric not null default 0,
  overall_pct numeric not null default 0,
  normalized_quarters integer not null default 0,
  complete_fiscal_years integer not null default 0,
  market_days integer not null default 0,
  primary_source_quarters integer not null default 0,
  missing_fields jsonb not null default '[]'::jsonb,
  provider_summary jsonb not null default '{}'::jsonb,
  limitations jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,engine_version,as_of_date),
  constraint data_coverage_reports_status_check check (status in ('sufficient','partial','blocked')),
  constraint data_coverage_reports_pct_check check (
    fundamentals_pct between 0 and 100 and balance_sheet_pct between 0 and 100 and
    history_pct between 0 and 100 and market_history_pct between 0 and 100 and
    industry_pct between 0 and 100 and peer_pct between 0 and 100 and overall_pct between 0 and 100
  )
);

create table if not exists public.data_provider_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  provider text not null,
  stage text not null,
  status text not null,
  attempted_at timestamptz not null default now(),
  completed_at timestamptz,
  records_written integer not null default 0,
  message text,
  details jsonb not null default '{}'::jsonb,
  constraint data_provider_attempts_status_check check (status in ('running','success','partial','failed','skipped'))
);

create index if not exists data_coverage_reports_company_date_idx on public.data_coverage_reports(company_id,as_of_date desc);
create index if not exists data_coverage_reports_status_score_idx on public.data_coverage_reports(status,overall_pct);
create index if not exists data_provider_attempts_company_provider_idx on public.data_provider_attempts(company_id,provider,attempted_at desc);

alter table public.data_coverage_reports enable row level security;
alter table public.data_provider_attempts enable row level security;

revoke all on table public.data_coverage_reports from public,anon,authenticated;
revoke all on table public.data_provider_attempts from public,anon,authenticated;
grant all on table public.data_coverage_reports to service_role;
grant all on table public.data_provider_attempts to service_role;

drop policy if exists "service role manages data coverage reports" on public.data_coverage_reports;
create policy "service role manages data coverage reports" on public.data_coverage_reports
  for all to service_role using(true) with check(true);

drop policy if exists "service role manages data provider attempts" on public.data_provider_attempts;
create policy "service role manages data provider attempts" on public.data_provider_attempts
  for all to service_role using(true) with check(true);
