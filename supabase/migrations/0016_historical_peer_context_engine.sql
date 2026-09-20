create table if not exists public.research_context_packs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  context_version text not null,
  as_of_date date not null,
  generated_at timestamptz not null default now(),
  industry_module text,
  history_coverage jsonb not null default '{}'::jsonb,
  trends jsonb not null default '{}'::jsonb,
  latest_metrics jsonb not null default '{}'::jsonb,
  peer_set jsonb not null default '[]'::jsonb,
  peer_comparison jsonb not null default '[]'::jsonb,
  capital_allocation jsonb not null default '{}'::jsonb,
  limitations jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,context_version,as_of_date)
);

create index if not exists research_context_packs_company_date_idx
  on public.research_context_packs(company_id,as_of_date desc);

alter table public.research_context_packs enable row level security;
revoke all on table public.research_context_packs from public,anon,authenticated;
grant all on table public.research_context_packs to service_role;

drop policy if exists "service role manages research context packs" on public.research_context_packs;
create policy "service role manages research context packs"
  on public.research_context_packs
  for all to service_role
  using(true)
  with check(true);
