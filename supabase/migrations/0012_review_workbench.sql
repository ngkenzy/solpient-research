create table if not exists public.baseline_reviews (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null unique references public.baseline_drafts(id) on delete cascade,
  status text not null default 'editing',
  review_payload jsonb not null default '{}'::jsonb,
  validation_result jsonb not null default '{}'::jsonb,
  promotion_readiness jsonb not null default '{}'::jsonb,
  review_notes text,
  reviewed_at timestamptz,
  promoted_at timestamptz,
  published_run_id uuid references public.research_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname='baseline_reviews_status_check') then
    alter table public.baseline_reviews add constraint baseline_reviews_status_check
      check (status in ('editing','ready','promoted','rejected'));
  end if;
end $$;
create index if not exists baseline_reviews_status_idx on public.baseline_reviews(status,updated_at desc);
create index if not exists baseline_reviews_published_run_idx on public.baseline_reviews(published_run_id);
alter table public.baseline_reviews enable row level security;
revoke all on table public.baseline_reviews from public,anon,authenticated;
grant all on table public.baseline_reviews to service_role;
drop policy if exists "service role manages baseline reviews" on public.baseline_reviews;
create policy "service role manages baseline reviews" on public.baseline_reviews for all to service_role using (true) with check (true);
