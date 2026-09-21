create table if not exists public.company_state_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  research_run_id uuid references public.research_runs(id) on delete set null,
  state_version text not null default 'company-state-v1',
  snapshot_date date not null,
  observed_at timestamptz not null default now(),
  state_hash text not null,
  state_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.company_state_snapshots
  drop constraint if exists company_state_snapshots_company_id_state_version_snapshot_date_key;

create unique index if not exists company_state_snapshots_company_version_hash_key
  on public.company_state_snapshots(company_id,state_version,state_hash);
create index if not exists company_state_snapshots_company_date_idx
  on public.company_state_snapshots(company_id,snapshot_date desc);

create table if not exists public.company_change_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  current_snapshot_id uuid references public.company_state_snapshots(id) on delete cascade,
  previous_snapshot_id uuid references public.company_state_snapshots(id) on delete set null,
  research_run_id uuid references public.research_runs(id) on delete set null,
  event_key text not null,
  category text not null,
  metric_key text,
  label text not null,
  old_value numeric,
  new_value numeric,
  delta_value numeric,
  delta_percent numeric,
  old_text text,
  new_text text,
  direction text not null,
  materiality text not null,
  decision_impact text not null,
  summary text not null,
  source_kind text,
  source_id text,
  source_url text,
  occurred_at date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,event_key,occurred_at)
);

create index if not exists company_change_events_company_date_idx
  on public.company_change_events(company_id,occurred_at desc,materiality);
create index if not exists company_change_events_impact_idx
  on public.company_change_events(decision_impact,occurred_at desc);

alter table public.company_state_snapshots enable row level security;
alter table public.company_change_events enable row level security;

grant select on public.company_state_snapshots, public.company_change_events to anon, authenticated;
grant select,insert,update,delete on public.company_state_snapshots, public.company_change_events to service_role;

drop policy if exists "public read company state snapshots" on public.company_state_snapshots;
create policy "public read company state snapshots"
on public.company_state_snapshots for select
to anon,authenticated using (true);

drop policy if exists "service role manages company state snapshots" on public.company_state_snapshots;
create policy "service role manages company state snapshots"
on public.company_state_snapshots for all
to service_role using (true) with check (true);

drop policy if exists "public read company change events" on public.company_change_events;
create policy "public read company change events"
on public.company_change_events for select
to anon,authenticated using (true);

drop policy if exists "service role manages company change events" on public.company_change_events;
create policy "service role manages company change events"
on public.company_change_events for all
to service_role using (true) with check (true);
