-- Solpient 100 Universe Screening Engine
-- Internal append-only screening snapshots. Final Solpient 100 membership remains review-gated.

create table if not exists public.universe_screen_runs (
  id uuid primary key default gen_random_uuid(),
  as_of_at timestamptz not null,
  methodology_version text not null,
  selection_version text not null,
  provider text not null,
  input_hash text not null unique,
  input_count integer not null default 0 check (input_count >= 0),
  result_count integer not null default 0 check (result_count >= 0),
  excluded_count integer not null default 0 check (excluded_count >= 0),
  watch_count integer not null default 0 check (watch_count >= 0),
  research_candidate_count integer not null default 0 check (research_candidate_count >= 0),
  solpient_100_candidate_count integer not null default 0 check (solpient_100_candidate_count >= 0),
  proposed_deep_research_count integer not null default 0 check (proposed_deep_research_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint universe_screen_runs_hash_check check (input_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.universe_screen_results (
  id uuid primary key default gen_random_uuid(),
  universe_screen_run_id uuid not null references public.universe_screen_runs(id) on delete restrict,
  ticker text not null,
  company_name text,
  sector text,
  industry text,
  screen_profile text not null,
  screen_state text not null check (
    screen_state in ('excluded','watch','research_candidate','solpient_100_candidate','solpient_100')
  ),
  universe_rank integer not null check (universe_rank > 0),
  shortlist_rank integer check (shortlist_rank is null or shortlist_rank > 0),
  proposed_for_deep_research boolean not null default false,
  final_membership_requires_review boolean not null default true,
  screen_score numeric check (screen_score is null or screen_score between 0 and 100),
  quality_core_score numeric check (quality_core_score is null or quality_core_score between 0 and 100),
  evidence_coverage_pct numeric check (evidence_coverage_pct is null or evidence_coverage_pct between 0 and 100),
  quality_score numeric check (quality_score is null or quality_score between 0 and 100),
  durability_score numeric check (durability_score is null or durability_score between 0 and 100),
  balance_sheet_score numeric check (balance_sheet_score is null or balance_sheet_score between 0 and 100),
  growth_score numeric check (growth_score is null or growth_score between 0 and 100),
  valuation_score numeric check (valuation_score is null or valuation_score between 0 and 100),
  gates jsonb not null default '[]'::jsonb,
  reasons jsonb not null default '{}'::jsonb,
  score_detail jsonb not null default '{}'::jsonb,
  input_summary jsonb not null default '{}'::jsonb,
  result_hash text not null,
  created_at timestamptz not null default now(),
  unique(universe_screen_run_id,ticker),
  constraint universe_screen_results_hash_check check (result_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists universe_screen_runs_latest_idx
  on public.universe_screen_runs(as_of_at desc,created_at desc);

create index if not exists universe_screen_results_rank_idx
  on public.universe_screen_results(universe_screen_run_id,universe_rank);

create index if not exists universe_screen_results_shortlist_idx
  on public.universe_screen_results(universe_screen_run_id,shortlist_rank)
  where proposed_for_deep_research=true;

create index if not exists universe_screen_results_state_idx
  on public.universe_screen_results(universe_screen_run_id,screen_state,screen_score desc);

alter table public.universe_screen_runs enable row level security;
alter table public.universe_screen_results enable row level security;

revoke all on table public.universe_screen_runs, public.universe_screen_results
from anon,authenticated;

grant select,insert on table public.universe_screen_runs, public.universe_screen_results
to service_role;

revoke update,delete,truncate on table public.universe_screen_runs, public.universe_screen_results
from service_role;

drop policy if exists "service role reads universe screen runs" on public.universe_screen_runs;
create policy "service role reads universe screen runs"
on public.universe_screen_runs for select to service_role using (true);

drop policy if exists "service role inserts universe screen runs" on public.universe_screen_runs;
create policy "service role inserts universe screen runs"
on public.universe_screen_runs for insert to service_role with check (true);

drop policy if exists "service role reads universe screen results" on public.universe_screen_results;
create policy "service role reads universe screen results"
on public.universe_screen_results for select to service_role using (true);

drop policy if exists "service role inserts universe screen results" on public.universe_screen_results;
create policy "service role inserts universe screen results"
on public.universe_screen_results for insert to service_role with check (true);

drop trigger if exists universe_screen_runs_append_only_guard on public.universe_screen_runs;
create trigger universe_screen_runs_append_only_guard
before update or delete on public.universe_screen_runs
for each row execute function private.guard_append_only_history();

drop trigger if exists universe_screen_results_append_only_guard on public.universe_screen_results;
create trigger universe_screen_results_append_only_guard
before update or delete on public.universe_screen_results
for each row execute function private.guard_append_only_history();

comment on table public.universe_screen_runs is
  'Immutable provider-agnostic broad-universe screening batches. Each input hash can materialize only once.';
comment on table public.universe_screen_results is
  'Immutable quantitative pre-research screen. Proposed deep-research inclusion is not equivalent to approved Solpient 100 membership.';
