create table if not exists public.research_compositions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.baseline_drafts(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  engine_version text not null,
  context_pack_id uuid references public.research_context_packs(id) on delete set null,
  status text not null default 'generated',
  composition_payload jsonb not null default '{}'::jsonb,
  validation_result jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  applied_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(draft_id,engine_version),
  constraint research_compositions_status_check check (status in ('generated','applied','superseded'))
);
create index if not exists research_compositions_company_generated_idx on public.research_compositions(company_id,generated_at desc);
alter table public.research_compositions enable row level security;
revoke all on table public.research_compositions from public,anon,authenticated;
grant all on table public.research_compositions to service_role;
