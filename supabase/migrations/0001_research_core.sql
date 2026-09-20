-- SOLPIENT Research: core point-in-time research schema
-- Principle: research history is append-only at the application layer.

create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  ticker text not null unique,
  company_name text not null,
  cik text,
  exchange text,
  sector text,
  industry text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.research_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  version integer not null check (version > 0),
  researched_at timestamptz not null default now(),
  price_at_research numeric,
  market_cap numeric,
  source_period text,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  summary text,
  full_report text,
  created_at timestamptz not null default now(),
  unique(company_id, version)
);

create table if not exists public.financial_metrics (
  id uuid primary key default gen_random_uuid(),
  research_run_id uuid not null unique references public.research_runs(id) on delete cascade,
  revenue numeric,
  revenue_growth_1y numeric,
  revenue_cagr_5y numeric,
  gross_margin numeric,
  operating_margin numeric,
  net_margin numeric,
  operating_cash_flow numeric,
  free_cash_flow numeric,
  fcf_growth numeric,
  fcf_margin numeric,
  cash numeric,
  total_debt numeric,
  long_term_debt numeric,
  current_ratio numeric,
  quick_ratio numeric,
  debt_to_equity numeric,
  roe numeric,
  roic numeric,
  roa numeric,
  eps numeric,
  eps_growth_1y numeric,
  eps_cagr_5y numeric,
  shares_outstanding numeric,
  pe numeric,
  forward_pe numeric,
  peg numeric,
  price_to_fcf numeric,
  fcf_yield numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  research_run_id uuid not null unique references public.research_runs(id) on delete cascade,
  quality_score numeric check (quality_score between 0 and 100),
  growth_score numeric check (growth_score between 0 and 100),
  valuation_score numeric check (valuation_score between 0 and 100),
  financial_strength_score numeric check (financial_strength_score between 0 and 100),
  moat_score numeric check (moat_score between 0 and 100),
  thesis_integrity_score numeric check (thesis_integrity_score between 0 and 100),
  overall_score numeric check (overall_score between 0 and 100),
  created_at timestamptz not null default now()
);

create table if not exists public.valuations (
  id uuid primary key default gen_random_uuid(),
  research_run_id uuid not null unique references public.research_runs(id) on delete cascade,
  dcf_value numeric,
  owner_earnings_value numeric,
  earnings_multiple_value numeric,
  historical_multiple_value numeric,
  peer_value numeric,
  bear_value numeric,
  base_value numeric,
  bull_value numeric,
  mos_25_price numeric,
  mos_35_price numeric,
  mos_50_price numeric,
  discount_rate numeric,
  terminal_growth numeric,
  revenue_growth_assumption numeric,
  margin_assumption numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.thesis_variables (
  id uuid primary key default gen_random_uuid(),
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  variable_name text not null,
  expectation text,
  observed_value text,
  status text check (status in ('strengthened','unchanged','weakened','unknown')),
  evidence text,
  created_at timestamptz not null default now()
);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  source_type text not null,
  title text not null,
  url text,
  filing_date date,
  accession_number text,
  retrieved_at timestamptz not null default now()
);

create table if not exists public.ranking_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  research_run_id uuid references public.research_runs(id) on delete set null,
  ranked_at timestamptz not null default now(),
  rank integer check (rank > 0),
  overall_score numeric,
  price numeric,
  base_fair_value numeric,
  created_at timestamptz not null default now()
);

create index if not exists research_runs_company_date_idx on public.research_runs(company_id, researched_at desc);
create index if not exists ranking_history_company_date_idx on public.ranking_history(company_id, ranked_at desc);
create index if not exists thesis_variables_run_idx on public.thesis_variables(research_run_id);
create index if not exists sources_run_idx on public.sources(research_run_id);

alter table public.companies enable row level security;
alter table public.research_runs enable row level security;
alter table public.financial_metrics enable row level security;
alter table public.scores enable row level security;
alter table public.valuations enable row level security;
alter table public.thesis_variables enable row level security;
alter table public.sources enable row level security;
alter table public.ranking_history enable row level security;

-- Public can read published research only. Admin write policies will be added with auth.
create policy "public read companies" on public.companies for select using (true);
create policy "public read published research" on public.research_runs for select using (status = 'published');
create policy "public read published metrics" on public.financial_metrics for select using (
  exists (select 1 from public.research_runs r where r.id = research_run_id and r.status = 'published')
);
create policy "public read published scores" on public.scores for select using (
  exists (select 1 from public.research_runs r where r.id = research_run_id and r.status = 'published')
);
create policy "public read published valuations" on public.valuations for select using (
  exists (select 1 from public.research_runs r where r.id = research_run_id and r.status = 'published')
);
create policy "public read published thesis variables" on public.thesis_variables for select using (
  exists (select 1 from public.research_runs r where r.id = research_run_id and r.status = 'published')
);
create policy "public read published sources" on public.sources for select using (
  exists (select 1 from public.research_runs r where r.id = research_run_id and r.status = 'published')
);
create policy "public read ranking history" on public.ranking_history for select using (true);
