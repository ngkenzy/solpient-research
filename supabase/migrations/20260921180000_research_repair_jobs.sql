create table if not exists public.research_repair_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  layer text not null,
  field text not null,
  repair_type text not null,
  automation_mode text not null check (automation_mode in ('auto','scheduled','manual')),
  runner text,
  status text not null default 'pending' check (status in ('pending','running','verifying','monitoring','completed','needs_review','blocked')),
  priority integer not null default 50 check (priority between 0 and 100),
  readiness_pct numeric,
  coverage_date date,
  reason text,
  details jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,layer,field)
);

create index if not exists research_repair_jobs_status_priority_idx
  on public.research_repair_jobs(status,priority desc,updated_at desc);
create index if not exists research_repair_jobs_company_idx
  on public.research_repair_jobs(company_id,updated_at desc);

alter table public.research_repair_jobs enable row level security;

grant select on public.research_repair_jobs to anon, authenticated;
grant select,insert,update,delete on public.research_repair_jobs to service_role;

drop policy if exists "public read research repair jobs" on public.research_repair_jobs;
create policy "public read research repair jobs"
on public.research_repair_jobs for select
to anon, authenticated
using (true);

drop policy if exists "service role manages research repair jobs" on public.research_repair_jobs;
create policy "service role manages research repair jobs"
on public.research_repair_jobs for all
to service_role
using (true)
with check (true);
