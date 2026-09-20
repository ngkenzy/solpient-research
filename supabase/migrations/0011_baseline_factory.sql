create table if not exists public.baseline_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  generation_version text not null,
  generated_at timestamptz not null default now(),
  source_cutoff_at timestamptz not null,
  industry_module text,
  status text not null default 'generated',
  evidence_completeness_pct numeric,
  standard_valid boolean not null default false,
  standard_status text,
  validation_result jsonb not null default '{}'::jsonb,
  evidence_summary jsonb not null default '{}'::jsonb,
  draft_payload jsonb not null,
  published_run_id uuid references public.research_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, generation_version, source_cutoff_at)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='baseline_drafts_status_check'
  ) then
    alter table public.baseline_drafts
      add constraint baseline_drafts_status_check
      check (status in ('generated','ready_for_review','promoted','rejected'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname='baseline_drafts_completeness_check'
  ) then
    alter table public.baseline_drafts
      add constraint baseline_drafts_completeness_check
      check (
        evidence_completeness_pct is null or
        (evidence_completeness_pct >= 0 and evidence_completeness_pct <= 100)
      );
  end if;
end $$;

create index if not exists baseline_drafts_company_generated_idx
  on public.baseline_drafts(company_id, generated_at desc);

create index if not exists baseline_drafts_status_idx
  on public.baseline_drafts(status, generated_at desc);

alter table public.baseline_drafts enable row level security;

revoke all on table public.baseline_drafts from public, anon, authenticated;
grant all on table public.baseline_drafts to service_role;

update public.fundamental_snapshots
set source_url = regexp_replace(source_url, '([?&])apikey=[^&]*', '', 'g')
where provider='fmp'
  and source_url is not null
  and source_url ilike '%apikey=%';


create index if not exists baseline_drafts_published_run_idx
  on public.baseline_drafts(published_run_id);

drop policy if exists "service role manages baseline drafts" on public.baseline_drafts;
create policy "service role manages baseline drafts"
  on public.baseline_drafts
  for all
  to service_role
  using (true)
  with check (true);
