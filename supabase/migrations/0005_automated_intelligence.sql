-- SOLPIENT automated intelligence ingestion
-- Raw observations are append-only inputs for later research, valuation and prediction runs.

create table if not exists public.market_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  symbol text not null,
  observed_at timestamptz not null,
  trading_date date not null,
  price numeric not null,
  previous_close numeric,
  volume numeric,
  market_cap numeric,
  provider text not null,
  source_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(symbol, trading_date, provider)
);

create table if not exists public.fundamental_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  observed_at timestamptz not null default now(),
  period_end date not null,
  fiscal_year integer,
  fiscal_period text,
  form text,
  filed_at date,
  revenue numeric,
  net_income numeric,
  operating_cash_flow numeric,
  capital_expenditure numeric,
  free_cash_flow numeric,
  shares_outstanding numeric,
  eps_diluted numeric,
  source_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id, period_end, form)
);

create table if not exists public.consensus_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  observed_at timestamptz not null default now(),
  provider text not null,
  revenue_next_fy numeric,
  eps_next_fy numeric,
  revenue_growth_next_fy numeric,
  eps_growth_next_fy numeric,
  analyst_count integer,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id, observed_at, provider)
);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  pipeline text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running'
    check (status in ('running','success','partial','failed','skipped')),
  records_written integer not null default 0,
  message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists market_snapshots_symbol_date_idx
  on public.market_snapshots(symbol, trading_date desc);
create index if not exists fundamental_snapshots_company_period_idx
  on public.fundamental_snapshots(company_id, period_end desc);
create index if not exists consensus_snapshots_company_date_idx
  on public.consensus_snapshots(company_id, observed_at desc);
create index if not exists automation_runs_pipeline_date_idx
  on public.automation_runs(pipeline, started_at desc);

alter table public.market_snapshots enable row level security;
alter table public.fundamental_snapshots enable row level security;
alter table public.consensus_snapshots enable row level security;
alter table public.automation_runs enable row level security;

create policy "public read market snapshots"
  on public.market_snapshots for select using (true);
create policy "public read fundamental snapshots"
  on public.fundamental_snapshots for select using (true);
create policy "public read consensus snapshots"
  on public.consensus_snapshots for select using (true);
create policy "public read automation runs"
  on public.automation_runs for select using (true);

comment on table public.market_snapshots is
  'Append-only end-of-day market observations used by ranking and prediction evaluation.';
comment on table public.fundamental_snapshots is
  'Point-in-time SEC-derived operating observations. Research versions are created separately.';
comment on table public.consensus_snapshots is
  'Point-in-time third-party consensus observations. Provider credentials are optional and configured separately.';
