-- Verified Track Record / Calibration Engine
-- Internal append-only aggregate ledger derived from locked predictions and realized outcomes.

create table if not exists public.track_record_runs (
  id uuid primary key default gen_random_uuid(),
  as_of_at timestamptz not null,
  evaluated_at timestamptz not null default now(),
  methodology_version text not null,
  calibration_bucket_version text not null,
  input_hash text not null unique,
  forecast_row_count integer not null default 0 check (forecast_row_count >= 0),
  verified_row_count integer not null default 0 check (verified_row_count >= 0),
  unresolved_row_count integer not null default 0 check (unresolved_row_count >= 0),
  weak_lineage_row_count integer not null default 0 check (weak_lineage_row_count >= 0),
  unverified_snapshot_row_count integer not null default 0 check (unverified_snapshot_row_count >= 0),
  source_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint track_record_runs_hash_check check (input_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.track_record_scope_snapshots (
  id uuid primary key default gen_random_uuid(),
  track_record_run_id uuid not null references public.track_record_runs(id) on delete restrict,
  scope_type text not null check (scope_type in ('global','company','model','horizon','outcome_type','metric')),
  scope_key text not null,
  label text not null,
  sample_grade text not null check (sample_grade in ('insufficient','emerging','meaningful','robust')),
  total_forecast_rows integer not null default 0 check (total_forecast_rows >= 0),
  verified_sample_size integer not null default 0 check (verified_sample_size >= 0),
  unresolved_count integer not null default 0 check (unresolved_count >= 0),
  weak_lineage_count integer not null default 0 check (weak_lineage_count >= 0),
  unverified_snapshot_count integer not null default 0 check (unverified_snapshot_count >= 0),
  numeric_metrics jsonb not null default '{}'::jsonb,
  direction_metrics jsonb not null default '{}'::jsonb,
  probability_metrics jsonb not null default '{}'::jsonb,
  confidence_calibration_metrics jsonb not null default '{}'::jsonb,
  benchmark_relative_metrics jsonb not null default '{}'::jsonb,
  caveat text not null,
  snapshot_hash text not null,
  created_at timestamptz not null default now(),
  unique(track_record_run_id,scope_type,scope_key),
  constraint track_record_scope_snapshot_hash_check check (snapshot_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.track_record_calibration_buckets (
  id uuid primary key default gen_random_uuid(),
  track_record_scope_snapshot_id uuid not null references public.track_record_scope_snapshots(id) on delete restrict,
  calibration_type text not null check (calibration_type in ('probability','confidence')),
  lower_bound numeric not null check (lower_bound >= 0 and lower_bound <= 100),
  upper_bound numeric not null check (upper_bound >= 0 and upper_bound <= 100 and upper_bound > lower_bound),
  sample_size integer not null check (sample_size > 0),
  mean_forecast_probability numeric,
  observed_rate numeric,
  calibration_gap numeric,
  absolute_calibration_gap numeric,
  brier_score numeric,
  created_at timestamptz not null default now(),
  unique(track_record_scope_snapshot_id,calibration_type,lower_bound,upper_bound)
);

create index if not exists track_record_runs_as_of_idx
  on public.track_record_runs(as_of_at desc,evaluated_at desc);

create index if not exists track_record_scope_latest_idx
  on public.track_record_scope_snapshots(scope_type,scope_key,created_at desc);

create index if not exists track_record_calibration_scope_idx
  on public.track_record_calibration_buckets(track_record_scope_snapshot_id,calibration_type,lower_bound);

alter table public.track_record_runs enable row level security;
alter table public.track_record_scope_snapshots enable row level security;
alter table public.track_record_calibration_buckets enable row level security;

revoke all on table
  public.track_record_runs,
  public.track_record_scope_snapshots,
  public.track_record_calibration_buckets
from anon,authenticated;

grant select,insert on table
  public.track_record_runs,
  public.track_record_scope_snapshots,
  public.track_record_calibration_buckets
to service_role;

revoke update,delete,truncate on table
  public.track_record_runs,
  public.track_record_scope_snapshots,
  public.track_record_calibration_buckets
from service_role;

drop policy if exists "service role reads track record runs" on public.track_record_runs;
create policy "service role reads track record runs"
on public.track_record_runs for select to service_role using (true);

drop policy if exists "service role inserts track record runs" on public.track_record_runs;
create policy "service role inserts track record runs"
on public.track_record_runs for insert to service_role with check (true);

drop policy if exists "service role reads track record snapshots" on public.track_record_scope_snapshots;
create policy "service role reads track record snapshots"
on public.track_record_scope_snapshots for select to service_role using (true);

drop policy if exists "service role inserts track record snapshots" on public.track_record_scope_snapshots;
create policy "service role inserts track record snapshots"
on public.track_record_scope_snapshots for insert to service_role with check (true);

drop policy if exists "service role reads track record buckets" on public.track_record_calibration_buckets;
create policy "service role reads track record buckets"
on public.track_record_calibration_buckets for select to service_role using (true);

drop policy if exists "service role inserts track record buckets" on public.track_record_calibration_buckets;
create policy "service role inserts track record buckets"
on public.track_record_calibration_buckets for insert to service_role with check (true);

drop trigger if exists track_record_runs_append_only_guard on public.track_record_runs;
create trigger track_record_runs_append_only_guard
before update or delete on public.track_record_runs
for each row execute function private.guard_append_only_history();

drop trigger if exists track_record_scope_snapshots_append_only_guard on public.track_record_scope_snapshots;
create trigger track_record_scope_snapshots_append_only_guard
before update or delete on public.track_record_scope_snapshots
for each row execute function private.guard_append_only_history();

drop trigger if exists track_record_calibration_buckets_append_only_guard on public.track_record_calibration_buckets;
create trigger track_record_calibration_buckets_append_only_guard
before update or delete on public.track_record_calibration_buckets
for each row execute function private.guard_append_only_history();

comment on table public.track_record_runs is
  'Immutable evaluation batches over locked predictions and authoritative realized outcomes. Identical input hashes are not re-materialized.';
comment on table public.track_record_scope_snapshots is
  'Immutable calibration/track-record aggregates by global, company, model, horizon, outcome type, or metric scope.';
comment on table public.track_record_calibration_buckets is
  'Immutable reliability buckets for explicit probability forecasts and snapshot-confidence calibration.';
