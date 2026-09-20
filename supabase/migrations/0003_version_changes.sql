-- SOLPIENT Research Version 2: explicit version lineage + deterministic change ledger.

alter table public.research_runs
  add column if not exists previous_run_id uuid references public.research_runs(id) on delete set null;

create index if not exists research_runs_previous_run_idx
  on public.research_runs(previous_run_id);

create table if not exists public.research_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  current_run_id uuid not null references public.research_runs(id) on delete cascade,
  previous_run_id uuid references public.research_runs(id) on delete set null,
  category text not null,
  change_type text not null,
  metric_key text not null,
  label text not null,
  old_value numeric,
  new_value numeric,
  delta_value numeric,
  delta_percent numeric,
  old_text text,
  new_text text,
  direction text,
  materiality text not null default 'material'
    check (materiality in ('material','notable','informational')),
  summary text not null,
  created_at timestamptz not null default now(),
  unique(current_run_id, category, metric_key)
);

create index if not exists research_changes_current_run_idx
  on public.research_changes(current_run_id, category);

create index if not exists research_changes_company_idx
  on public.research_changes(company_id, created_at desc);

alter table public.research_changes enable row level security;

create policy "public read published research changes"
  on public.research_changes
  for select
  using (
    exists (
      select 1
      from public.research_runs r
      where r.id = current_run_id
        and r.status = 'published'
    )
  );
