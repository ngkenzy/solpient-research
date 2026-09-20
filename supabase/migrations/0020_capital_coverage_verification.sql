create table if not exists public.capital_coverage_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  activity_type text not null check (activity_type in ('insider','institutional','political')),
  status text not null default 'pending'
    check (status in ('pending','activity_found','verified_none','partial','unavailable')),
  provider text not null default 'orchestrator',
  window_start date,
  window_end date,
  verified_at timestamptz,
  record_count integer not null default 0,
  source_url text,
  source_key text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, activity_type)
);

create index if not exists capital_coverage_checks_status_idx
  on public.capital_coverage_checks(status, activity_type, updated_at desc);

create index if not exists capital_coverage_checks_company_idx
  on public.capital_coverage_checks(company_id, activity_type);

alter table public.capital_coverage_checks enable row level security;

drop policy if exists "public read capital coverage checks" on public.capital_coverage_checks;
create policy "public read capital coverage checks"
  on public.capital_coverage_checks for select
  to anon, authenticated
  using (true);

revoke all on table public.capital_coverage_checks from public, anon, authenticated;
grant select on table public.capital_coverage_checks to anon, authenticated;
grant all on table public.capital_coverage_checks to service_role;

insert into public.capital_coverage_checks (company_id,activity_type,status,provider,metadata)
select c.id, t.activity_type, 'pending', 'orchestrator', '{"bootstrap":"22x3 coverage matrix"}'::jsonb
from public.companies c
cross join (values ('insider'),('institutional'),('political')) as t(activity_type)
on conflict (company_id,activity_type) do nothing;

with latest as (
  select distinct on (ca.company_id, ca.activity_type)
    ca.company_id,
    ca.activity_type,
    ca.provider,
    coalesce(ca.verified_at, ca.created_at) as verified_at,
    ca.source_url,
    ca.source_key
  from public.capital_activity ca
  order by ca.company_id, ca.activity_type, coalesce(ca.verified_at, ca.created_at) desc
),
counts as (
  select company_id, activity_type, count(*)::int as record_count
  from public.capital_activity
  group by company_id, activity_type
)
update public.capital_coverage_checks cc
set status='activity_found',
    provider=l.provider,
    verified_at=l.verified_at,
    window_end=current_date,
    record_count=co.record_count,
    source_url=l.source_url,
    source_key=l.source_key,
    notes='Bootstrapped from existing normalized capital activity.',
    metadata=jsonb_build_object('bootstrap','existing activity','record_count',co.record_count),
    updated_at=now()
from latest l
join counts co on co.company_id=l.company_id and co.activity_type=l.activity_type
where cc.company_id=l.company_id and cc.activity_type=l.activity_type;
