-- SOLPIENT Intelligence Database: immutable point-in-time prediction ledger
-- Predictions are append-only. Realized outcomes are stored separately so the
-- original prediction is never overwritten by hindsight.

create table if not exists public.prediction_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  research_run_id uuid references public.research_runs(id) on delete set null,
  prediction_key text not null unique,
  predicted_at timestamptz not null default now(),
  model_version text not null,
  horizon_months integer not null check (horizon_months > 0),
  benchmark_ticker text not null default 'SPY',
  price_at_prediction numeric,
  benchmark_price_at_prediction numeric,
  confidence numeric check (confidence between 0 and 100),
  thesis_status text check (thesis_status in ('strengthening','intact','watch','deteriorating','broken')),
  rationale text,
  feature_snapshot jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.prediction_outcomes (
  id uuid primary key default gen_random_uuid(),
  prediction_snapshot_id uuid not null references public.prediction_snapshots(id) on delete cascade,
  metric_key text not null,
  label text not null,
  outcome_type text not null check (outcome_type in ('fundamental','valuation','relative_return','risk','thesis')),
  predicted_value numeric,
  predicted_low numeric,
  predicted_high numeric,
  predicted_probability numeric check (predicted_probability is null or (predicted_probability between 0 and 100)),
  predicted_text text,
  unit text,
  target_date date,
  created_at timestamptz not null default now(),
  unique(prediction_snapshot_id, metric_key)
);

create table if not exists public.realized_outcomes (
  id uuid primary key default gen_random_uuid(),
  prediction_outcome_id uuid not null references public.prediction_outcomes(id) on delete cascade,
  observed_at timestamptz not null,
  actual_value numeric,
  actual_text text,
  source_url text,
  source_note text,
  created_at timestamptz not null default now(),
  unique(prediction_outcome_id, observed_at)
);

create table if not exists public.prediction_scores (
  id uuid primary key default gen_random_uuid(),
  prediction_outcome_id uuid not null references public.prediction_outcomes(id) on delete cascade,
  realized_outcome_id uuid references public.realized_outcomes(id) on delete set null,
  scored_at timestamptz not null default now(),
  absolute_error numeric,
  percentage_error numeric,
  direction_correct boolean,
  probability_brier_score numeric,
  benchmark_excess_return numeric,
  notes text,
  unique(prediction_outcome_id, realized_outcome_id)
);

create index if not exists prediction_snapshots_company_date_idx
  on public.prediction_snapshots(company_id, predicted_at desc);
create index if not exists prediction_outcomes_snapshot_idx
  on public.prediction_outcomes(prediction_snapshot_id);
create index if not exists realized_outcomes_prediction_idx
  on public.realized_outcomes(prediction_outcome_id, observed_at desc);

alter table public.prediction_snapshots enable row level security;
alter table public.prediction_outcomes enable row level security;
alter table public.realized_outcomes enable row level security;
alter table public.prediction_scores enable row level security;

create policy "public read prediction snapshots"
  on public.prediction_snapshots for select using (true);
create policy "public read prediction outcomes"
  on public.prediction_outcomes for select using (true);
create policy "public read realized outcomes"
  on public.realized_outcomes for select using (true);
create policy "public read prediction scores"
  on public.prediction_scores for select using (true);

comment on table public.prediction_snapshots is
  'Immutable point-in-time SOLPIENT prediction records. Never update historical predictions; append a new snapshot instead.';
comment on table public.realized_outcomes is
  'Observed future results linked to original predictions without modifying the original prediction.';
