-- Capital Intelligence Orchestrator v1
alter table public.capital_activity
  add column if not exists verified_at timestamptz;

update public.capital_activity
set verified_at = created_at
where verified_at is null;

create index if not exists capital_activity_provider_company_idx
  on public.capital_activity(provider, company_id, verified_at desc);

create table if not exists public.capital_provider_health (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  feed_type text not null check (feed_type in ('insider','institutional','political','all')),
  status text not null default 'inactive'
    check (status in ('healthy','degraded','blocked','stale','inactive')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_verified_at timestamptz,
  rows_written integer not null default 0,
  companies_covered integer not null default 0,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(provider, feed_type)
);

create index if not exists capital_provider_health_status_idx
  on public.capital_provider_health(status, updated_at desc);

create table if not exists public.capital_ingest_batches (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  feed_type text not null check (feed_type in ('insider','institutional','political','mixed')),
  status text not null check (status in ('accepted','partial','rejected')),
  records_received integer not null default 0,
  records_accepted integer not null default 0,
  records_rejected integer not null default 0,
  verified_at timestamptz,
  source_run_id text,
  errors jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create index if not exists capital_ingest_batches_received_idx
  on public.capital_ingest_batches(received_at desc);

alter table public.capital_provider_health enable row level security;
alter table public.capital_ingest_batches enable row level security;

drop policy if exists "public read capital provider health" on public.capital_provider_health;
create policy "public read capital provider health"
  on public.capital_provider_health for select
  to anon, authenticated
  using (true);

revoke all on table public.capital_provider_health from anon, authenticated;
grant select on table public.capital_provider_health to anon, authenticated;
grant all on table public.capital_provider_health to service_role;

revoke all on table public.capital_ingest_batches from public, anon, authenticated;
grant all on table public.capital_ingest_batches to service_role;
