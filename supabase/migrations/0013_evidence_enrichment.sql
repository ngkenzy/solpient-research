create table if not exists public.baseline_enrichment_runs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.baseline_drafts(id) on delete cascade,
  engine_version text not null,
  run_key text not null,
  generated_at timestamptz not null default now(),
  source_cutoff_at timestamptz,
  status text not null default 'generated',
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(draft_id,run_key)
);

create table if not exists public.baseline_enrichment_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.baseline_enrichment_runs(id) on delete cascade,
  draft_id uuid not null references public.baseline_drafts(id) on delete cascade,
  item_key text not null,
  item_type text not null,
  module text,
  metric_key text,
  label text not null,
  fact_text text,
  value_numeric numeric,
  value_text text,
  unit text,
  period_end date,
  period_type text,
  basis text not null,
  confidence text not null,
  source_title text not null,
  source_url text not null,
  source_type text,
  source_date date,
  interpretation text,
  status text not null default 'proposed',
  applied_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(run_id,item_key)
);

do $$
begin
  if not exists(select 1 from pg_constraint where conname='baseline_enrichment_items_type_check') then
    alter table public.baseline_enrichment_items add constraint baseline_enrichment_items_type_check check(item_type in('metric','evidence','gap_note'));
  end if;
  if not exists(select 1 from pg_constraint where conname='baseline_enrichment_items_basis_check') then
    alter table public.baseline_enrichment_items add constraint baseline_enrichment_items_basis_check check(basis in('reported','derived','assessment'));
  end if;
  if not exists(select 1 from pg_constraint where conname='baseline_enrichment_items_confidence_check') then
    alter table public.baseline_enrichment_items add constraint baseline_enrichment_items_confidence_check check(confidence in('high','medium','low'));
  end if;
  if not exists(select 1 from pg_constraint where conname='baseline_enrichment_items_status_check') then
    alter table public.baseline_enrichment_items add constraint baseline_enrichment_items_status_check check(status in('proposed','accepted','rejected'));
  end if;
end $$;

create index if not exists baseline_enrichment_runs_draft_idx on public.baseline_enrichment_runs(draft_id,generated_at desc);
create index if not exists baseline_enrichment_items_draft_idx on public.baseline_enrichment_items(draft_id,created_at desc);
create index if not exists baseline_enrichment_items_run_status_idx on public.baseline_enrichment_items(run_id,status);

alter table public.baseline_enrichment_runs enable row level security;
alter table public.baseline_enrichment_items enable row level security;

revoke all on public.baseline_enrichment_runs from public,anon,authenticated;
revoke all on public.baseline_enrichment_items from public,anon,authenticated;
grant all on public.baseline_enrichment_runs to service_role;
grant all on public.baseline_enrichment_items to service_role;

drop policy if exists "service role manages enrichment runs" on public.baseline_enrichment_runs;
create policy "service role manages enrichment runs" on public.baseline_enrichment_runs for all to service_role using(true) with check(true);

drop policy if exists "service role manages enrichment items" on public.baseline_enrichment_items;
create policy "service role manages enrichment items" on public.baseline_enrichment_items for all to service_role using(true) with check(true);
