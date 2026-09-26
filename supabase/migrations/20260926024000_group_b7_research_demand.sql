-- Group B / B7 — private research demand signals.
-- User requests influence research triage only. They never mutate candidate
-- stage/readiness, Solpient 100 eligibility, or published Research.

create table if not exists public.research_demand_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  request_type text not null default 'coverage'
    check (request_type in ('coverage','refresh','deep_dive','question')),
  priority smallint not null default 3 check (priority between 1 and 5),
  question text null check (question is null or char_length(question) <= 2000),
  reason text null check (reason is null or char_length(reason) <= 2000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint research_demand_requests_user_company_key unique (user_id,company_id)
);

create index if not exists research_demand_requests_company_idx
  on public.research_demand_requests(company_id,active,priority desc,updated_at desc);

create index if not exists research_demand_requests_user_idx
  on public.research_demand_requests(user_id,updated_at desc);

drop trigger if exists research_demand_requests_set_updated_at
  on public.research_demand_requests;
create trigger research_demand_requests_set_updated_at
before update on public.research_demand_requests
for each row execute function private.set_consumer_updated_at_v1();

alter table public.research_demand_requests enable row level security;

revoke all on public.research_demand_requests from public,anon;
grant select,insert,update,delete on public.research_demand_requests to authenticated;
grant all on public.research_demand_requests to service_role;

drop policy if exists "Users manage own research demand"
  on public.research_demand_requests;
create policy "Users manage own research demand"
on public.research_demand_requests
for all
to authenticated
using ((select auth.uid())=user_id)
with check ((select auth.uid())=user_id);

create or replace function public.get_research_demand_summary_v1()
returns table (
  company_id uuid,
  request_count bigint,
  high_priority_count bigint,
  average_priority numeric,
  latest_requested_at timestamptz,
  latest_question text
)
language sql
stable
security definer
set search_path=''
as $$
  with aggregate_demand as (
    select
      r.company_id,
      count(*)::bigint as request_count,
      count(*) filter (where r.priority>=4)::bigint as high_priority_count,
      round(avg(r.priority)::numeric,2) as average_priority,
      max(r.updated_at) as latest_requested_at
    from public.research_demand_requests r
    where r.active
    group by r.company_id
  )
  select
    a.company_id,
    a.request_count,
    a.high_priority_count,
    a.average_priority,
    a.latest_requested_at,
    (
      select nullif(trim(r2.question),'')
      from public.research_demand_requests r2
      where r2.company_id=a.company_id
        and r2.active
        and nullif(trim(coalesce(r2.question,'')),'') is not null
      order by r2.updated_at desc,r2.id
      limit 1
    ) as latest_question
  from aggregate_demand a
  order by a.high_priority_count desc,a.request_count desc,a.average_priority desc,a.company_id;
$$;

revoke all on function public.get_research_demand_summary_v1()
  from public,anon,authenticated;
grant execute on function public.get_research_demand_summary_v1()
  to service_role;

comment on table public.research_demand_requests is
  'Group B7 private user research demand. One active preference per user/company; never promotes pipeline state automatically.';

comment on function public.get_research_demand_summary_v1() is
  'Group B7 service-role-only aggregate demand signal for internal research triage. Returns no user identity.';
