-- Solpient 100 -> Valuation V3 -> Readiness V1 integration.
-- Internal, append-only research-candidate pipeline.

create table if not exists public.candidate_valuation_input_packs (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  company_id uuid references public.companies(id) on delete restrict,
  universe_screen_result_id uuid references public.universe_screen_results(id) on delete restrict,
  valuation_methodology_version text not null default 'solpient-valuation-methodology-v3',
  industry_module text not null,
  status text not null check (status in ('draft','reviewed','rejected')),
  valuation_input jsonb not null,
  input_hash text not null,
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  constraint candidate_valuation_pack_hash_check check (input_hash ~ '^[0-9a-f]{64}$'),
  constraint candidate_valuation_pack_review_check check (
    (status='reviewed' and reviewed_at is not null and reviewed_by is not null)
    or status in ('draft','rejected')
  ),
  unique(ticker,input_hash)
);

create table if not exists public.research_candidate_pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  universe_screen_run_id uuid not null references public.universe_screen_runs(id) on delete restrict,
  pipeline_version text not null,
  valuation_methodology_version text not null,
  readiness_methodology_version text not null,
  input_hash text not null unique,
  candidate_count integer not null default 0 check (candidate_count >= 0),
  decision_ready_count integer not null default 0 check (decision_ready_count >= 0),
  research_ready_count integer not null default 0 check (research_ready_count >= 0),
  building_count integer not null default 0 check (building_count >= 0),
  onboarding_count integer not null default 0 check (onboarding_count >= 0),
  valuation_building_count integer not null default 0 check (valuation_building_count >= 0),
  created_at timestamptz not null default now(),
  constraint research_candidate_pipeline_hash_check check (input_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.research_candidate_pipeline_items (
  id uuid primary key default gen_random_uuid(),
  research_candidate_pipeline_run_id uuid not null references public.research_candidate_pipeline_runs(id) on delete restrict,
  universe_screen_result_id uuid not null references public.universe_screen_results(id) on delete restrict,
  ticker text not null,
  company_id uuid references public.companies(id) on delete restrict,
  research_run_id uuid references public.research_runs(id) on delete restrict,
  valuation_input_pack_id uuid references public.candidate_valuation_input_packs(id) on delete restrict,
  stage text not null check (
    stage in ('not_selected','onboarding','valuation_building','research_building','research_ready','decision_ready')
  ),
  readiness_state text not null check (readiness_state in ('building','research_ready','decision_ready')),
  valuation_preflight_complete boolean not null default false,
  valuation_base_fair_value numeric,
  valuation_confidence numeric,
  valuation_confidence_band text,
  base_5y_cagr numeric,
  decision_score numeric,
  evidence_confidence numeric,
  next_actions jsonb not null default '[]'::jsonb,
  pipeline_output jsonb not null,
  item_hash text not null,
  created_at timestamptz not null default now(),
  constraint research_candidate_pipeline_item_hash_check check (item_hash ~ '^[0-9a-f]{64}$'),
  unique(research_candidate_pipeline_run_id,ticker)
);

create index if not exists candidate_valuation_packs_ticker_idx
  on public.candidate_valuation_input_packs(ticker,created_at desc);
create index if not exists candidate_pipeline_runs_latest_idx
  on public.research_candidate_pipeline_runs(created_at desc);
create index if not exists candidate_pipeline_items_stage_idx
  on public.research_candidate_pipeline_items(research_candidate_pipeline_run_id,stage,ticker);

alter table public.candidate_valuation_input_packs enable row level security;
alter table public.research_candidate_pipeline_runs enable row level security;
alter table public.research_candidate_pipeline_items enable row level security;

revoke all on table
  public.candidate_valuation_input_packs,
  public.research_candidate_pipeline_runs,
  public.research_candidate_pipeline_items
from anon,authenticated;

grant select,insert on table
  public.candidate_valuation_input_packs,
  public.research_candidate_pipeline_runs,
  public.research_candidate_pipeline_items
to service_role;

revoke update,delete,truncate on table
  public.candidate_valuation_input_packs,
  public.research_candidate_pipeline_runs,
  public.research_candidate_pipeline_items
from service_role;

drop policy if exists "service role reads candidate valuation packs" on public.candidate_valuation_input_packs;
create policy "service role reads candidate valuation packs"
on public.candidate_valuation_input_packs for select to service_role using (true);

drop policy if exists "service role inserts candidate valuation packs" on public.candidate_valuation_input_packs;
create policy "service role inserts candidate valuation packs"
on public.candidate_valuation_input_packs for insert to service_role with check (true);

drop policy if exists "service role reads candidate pipeline runs" on public.research_candidate_pipeline_runs;
create policy "service role reads candidate pipeline runs"
on public.research_candidate_pipeline_runs for select to service_role using (true);

drop policy if exists "service role inserts candidate pipeline runs" on public.research_candidate_pipeline_runs;
create policy "service role inserts candidate pipeline runs"
on public.research_candidate_pipeline_runs for insert to service_role with check (true);

drop policy if exists "service role reads candidate pipeline items" on public.research_candidate_pipeline_items;
create policy "service role reads candidate pipeline items"
on public.research_candidate_pipeline_items for select to service_role using (true);

drop policy if exists "service role inserts candidate pipeline items" on public.research_candidate_pipeline_items;
create policy "service role inserts candidate pipeline items"
on public.research_candidate_pipeline_items for insert to service_role with check (true);

drop trigger if exists candidate_valuation_input_packs_append_only_guard on public.candidate_valuation_input_packs;
create trigger candidate_valuation_input_packs_append_only_guard
before update or delete on public.candidate_valuation_input_packs
for each row execute function private.guard_append_only_history();

drop trigger if exists research_candidate_pipeline_runs_append_only_guard on public.research_candidate_pipeline_runs;
create trigger research_candidate_pipeline_runs_append_only_guard
before update or delete on public.research_candidate_pipeline_runs
for each row execute function private.guard_append_only_history();

drop trigger if exists research_candidate_pipeline_items_append_only_guard on public.research_candidate_pipeline_items;
create trigger research_candidate_pipeline_items_append_only_guard
before update or delete on public.research_candidate_pipeline_items
for each row execute function private.guard_append_only_history();

comment on table public.candidate_valuation_input_packs is
  'Explicit reviewed Valuation V3 inputs for shortlisted research candidates. Old packs remain immutable when assumptions change.';
comment on table public.research_candidate_pipeline_runs is
  'Immutable batch evaluations connecting a Solpient 100 screening run to Valuation V3 and Readiness V1.';
comment on table public.research_candidate_pipeline_items is
  'Immutable per-candidate handoff output with stage, V3 valuation state, readiness state, and ordered next actions.';
