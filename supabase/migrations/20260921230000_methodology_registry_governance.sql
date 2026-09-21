-- Methodology Registry / Model Governance V1
-- Internal append-only governance ledger. No public read surface.

create table if not exists public.methodology_definitions (
  id uuid primary key default gen_random_uuid(),
  methodology_key text not null,
  version text not null,
  name text not null,
  category text not null,
  risk_class text not null check (risk_class in ('low','moderate','high','critical')),
  purpose text not null,
  owner text not null,
  source_files jsonb not null default '[]'::jsonb,
  input_contract jsonb not null default '{}'::jsonb,
  output_contract jsonb not null default '{}'::jsonb,
  weights jsonb not null default '{}'::jsonb,
  thresholds jsonb not null default '{}'::jsonb,
  assumptions jsonb not null default '{}'::jsonb,
  dependencies jsonb not null default '[]'::jsonb,
  known_limitations jsonb not null default '[]'::jsonb,
  change_summary text not null,
  predecessor_version text,
  impacts jsonb not null default '{}'::jsonb,
  legacy_bootstrap boolean not null default false,
  registry_version text not null,
  manifest jsonb not null,
  manifest_hash text not null unique,
  registered_at timestamptz not null default now(),
  unique(methodology_key,version),
  constraint methodology_definitions_hash_check check (manifest_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.methodology_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  methodology_definition_id uuid not null references public.methodology_definitions(id) on delete restrict,
  event_type text not null check (
    event_type in ('registered','candidate','validated','active','blocked','deprecated','superseded','retired')
  ),
  effective_at timestamptz not null default now(),
  reason text not null,
  actor text,
  commit_sha text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.methodology_validation_runs (
  id uuid primary key default gen_random_uuid(),
  methodology_definition_id uuid not null references public.methodology_definitions(id) on delete restrict,
  validation_type text not null check (
    validation_type in (
      'unit_tests','build','db_invariant','historical_integrity',
      'manual_review','methodology_regression','backtest','calibration'
    )
  ),
  status text not null check (status in ('pass','fail','waived')),
  validated_at timestamptz not null default now(),
  validator text,
  commit_sha text,
  evidence_ref text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists methodology_definitions_key_idx
  on public.methodology_definitions(methodology_key,registered_at desc);

create index if not exists methodology_lifecycle_definition_idx
  on public.methodology_lifecycle_events(methodology_definition_id,effective_at desc,created_at desc);

create index if not exists methodology_validation_definition_idx
  on public.methodology_validation_runs(methodology_definition_id,validation_type,validated_at desc);

alter table public.methodology_definitions enable row level security;
alter table public.methodology_lifecycle_events enable row level security;
alter table public.methodology_validation_runs enable row level security;

revoke all on table
  public.methodology_definitions,
  public.methodology_lifecycle_events,
  public.methodology_validation_runs
from anon,authenticated;

grant select,insert on table
  public.methodology_definitions,
  public.methodology_lifecycle_events,
  public.methodology_validation_runs
to service_role;

revoke update,delete,truncate on table
  public.methodology_definitions,
  public.methodology_lifecycle_events,
  public.methodology_validation_runs
from service_role;

drop policy if exists "service role reads methodology definitions" on public.methodology_definitions;
create policy "service role reads methodology definitions"
on public.methodology_definitions for select to service_role using (true);

drop policy if exists "service role inserts methodology definitions" on public.methodology_definitions;
create policy "service role inserts methodology definitions"
on public.methodology_definitions for insert to service_role with check (true);

drop policy if exists "service role reads methodology lifecycle" on public.methodology_lifecycle_events;
create policy "service role reads methodology lifecycle"
on public.methodology_lifecycle_events for select to service_role using (true);

drop policy if exists "service role inserts methodology lifecycle" on public.methodology_lifecycle_events;
create policy "service role inserts methodology lifecycle"
on public.methodology_lifecycle_events for insert to service_role with check (true);

drop policy if exists "service role reads methodology validations" on public.methodology_validation_runs;
create policy "service role reads methodology validations"
on public.methodology_validation_runs for select to service_role using (true);

drop policy if exists "service role inserts methodology validations" on public.methodology_validation_runs;
create policy "service role inserts methodology validations"
on public.methodology_validation_runs for insert to service_role with check (true);

drop trigger if exists methodology_definitions_append_only_guard on public.methodology_definitions;
create trigger methodology_definitions_append_only_guard
before update or delete on public.methodology_definitions
for each row execute function private.guard_append_only_history();

drop trigger if exists methodology_lifecycle_append_only_guard on public.methodology_lifecycle_events;
create trigger methodology_lifecycle_append_only_guard
before update or delete on public.methodology_lifecycle_events
for each row execute function private.guard_append_only_history();

drop trigger if exists methodology_validation_append_only_guard on public.methodology_validation_runs;
create trigger methodology_validation_append_only_guard
before update or delete on public.methodology_validation_runs
for each row execute function private.guard_append_only_history();

comment on table public.methodology_definitions is
  'Immutable methodology/version manifests. Material changes require a new methodology version rather than edits.';
comment on table public.methodology_lifecycle_events is
  'Append-only lifecycle state changes for methodology versions. Current state is derived from events.';
comment on table public.methodology_validation_runs is
  'Append-only validation evidence used to determine whether a methodology version is eligible for activation.';
