-- Autonomous Research Factory V2.1
-- Machine decisions are append-only. High-confidence industry and valuation
-- decisions can advance the factory; low-confidence decisions quarantine the
-- ticker without blocking unrelated companies.

alter table public.research_factory_items
  drop constraint if exists research_factory_items_status_check;

alter table public.research_factory_items
  add constraint research_factory_items_status_check
  check (
    status = any (
      array[
        'queued'::text,
        'running'::text,
        'needs_review'::text,
        'blocked'::text,
        'quarantined'::text,
        'complete'::text
      ]
    )
  );

create table if not exists public.research_factory_autonomous_runs (
  id uuid primary key default gen_random_uuid(),
  research_factory_run_id uuid not null
    references public.research_factory_runs(id) on delete restrict,
  automation_version text not null,
  status text not null default 'running'
    check (status in ('running','success','partial','noop','failed')),
  max_items integer not null default 20 check (max_items between 1 and 100),
  processed_count integer not null default 0 check (processed_count >= 0),
  auto_approved_count integer not null default 0 check (auto_approved_count >= 0),
  quarantined_count integer not null default 0 check (quarantined_count >= 0),
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.research_factory_autonomous_decisions (
  id uuid primary key default gen_random_uuid(),
  autonomous_run_id uuid references public.research_factory_autonomous_runs(id) on delete restrict,
  research_factory_item_id uuid not null
    references public.research_factory_items(id) on delete restrict,
  ticker text not null,
  decision_type text not null
    check (decision_type in (
      'evidence_repair',
      'industry_assignment',
      'valuation_assumptions',
      'valuation_pack',
      'quarantine'
    )),
  decision_status text not null
    check (decision_status in ('applied','quarantined','skipped')),
  policy_version text not null,
  confidence numeric not null check (confidence between 0 and 1),
  input_hash text not null,
  decision_hash text not null,
  output jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(research_factory_item_id,decision_type,decision_hash),
  constraint research_factory_autonomous_decision_input_hash_check
    check (input_hash ~ '^[0-9a-f]{64}$'),
  constraint research_factory_autonomous_decision_hash_check
    check (decision_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.research_factory_industry_assignments (
  id uuid primary key default gen_random_uuid(),
  research_factory_item_id uuid not null
    references public.research_factory_items(id) on delete restrict,
  company_id uuid references public.companies(id) on delete restrict,
  source_screen_result_id uuid not null
    references public.universe_screen_results(id) on delete restrict,
  ticker text not null,
  policy_version text not null,
  module text,
  proposed_module text,
  status text not null check (status in ('applied','quarantined')),
  confidence numeric not null check (confidence between 0 and 1),
  method text not null,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  decision_hash text not null,
  created_at timestamptz not null default now(),
  unique(research_factory_item_id,decision_hash),
  constraint research_factory_industry_assignment_hash_check
    check (decision_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists research_factory_autonomous_runs_factory_idx
  on public.research_factory_autonomous_runs(research_factory_run_id,started_at desc);

create index if not exists research_factory_autonomous_decisions_item_idx
  on public.research_factory_autonomous_decisions(research_factory_item_id,created_at desc);

create index if not exists research_factory_autonomous_decisions_run_idx
  on public.research_factory_autonomous_decisions(autonomous_run_id,created_at desc);

create index if not exists research_factory_industry_assignments_item_idx
  on public.research_factory_industry_assignments(research_factory_item_id,created_at desc);

create index if not exists research_factory_industry_assignments_company_idx
  on public.research_factory_industry_assignments(company_id,created_at desc);

alter table public.research_factory_autonomous_runs enable row level security;
alter table public.research_factory_autonomous_decisions enable row level security;
alter table public.research_factory_industry_assignments enable row level security;

revoke all on table
  public.research_factory_autonomous_runs,
  public.research_factory_autonomous_decisions,
  public.research_factory_industry_assignments
from public,anon,authenticated;

grant select,insert,update on table public.research_factory_autonomous_runs
to service_role;

grant select,insert on table
  public.research_factory_autonomous_decisions,
  public.research_factory_industry_assignments
to service_role;

revoke update,delete,truncate on table
  public.research_factory_autonomous_decisions,
  public.research_factory_industry_assignments
from service_role;

drop policy if exists "service role manages autonomous research factory runs"
  on public.research_factory_autonomous_runs;
create policy "service role manages autonomous research factory runs"
on public.research_factory_autonomous_runs
for all to service_role
using (true)
with check (true);

drop policy if exists "service role reads autonomous decisions"
  on public.research_factory_autonomous_decisions;
create policy "service role reads autonomous decisions"
on public.research_factory_autonomous_decisions
for select to service_role
using (true);

drop policy if exists "service role inserts autonomous decisions"
  on public.research_factory_autonomous_decisions;
create policy "service role inserts autonomous decisions"
on public.research_factory_autonomous_decisions
for insert to service_role
with check (true);

drop policy if exists "service role reads autonomous industry assignments"
  on public.research_factory_industry_assignments;
create policy "service role reads autonomous industry assignments"
on public.research_factory_industry_assignments
for select to service_role
using (true);

drop policy if exists "service role inserts autonomous industry assignments"
  on public.research_factory_industry_assignments;
create policy "service role inserts autonomous industry assignments"
on public.research_factory_industry_assignments
for insert to service_role
with check (true);

drop trigger if exists research_factory_autonomous_decisions_append_only_guard
  on public.research_factory_autonomous_decisions;
create trigger research_factory_autonomous_decisions_append_only_guard
before update or delete on public.research_factory_autonomous_decisions
for each row execute function private.guard_append_only_history();

drop trigger if exists research_factory_industry_assignments_append_only_guard
  on public.research_factory_industry_assignments;
create trigger research_factory_industry_assignments_append_only_guard
before update or delete on public.research_factory_industry_assignments
for each row execute function private.guard_append_only_history();

create or replace function public.publish_autonomous_valuation_pack_v2_1(
  p_research_factory_item_id uuid,
  p_decision_hash text,
  p_industry_module text,
  p_valuation_input jsonb,
  p_input_hash text,
  p_confidence numeric,
  p_policy_version text default 'valuation-assumptions-v2.1'
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_item public.research_factory_items%rowtype;
  v_decision public.research_factory_autonomous_decisions%rowtype;
  v_assignment public.research_factory_industry_assignments%rowtype;
  v_existing public.candidate_valuation_input_packs%rowtype;
  v_id uuid;
begin
  if coalesce(p_decision_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid autonomous valuation decision hash';
  end if;
  if coalesce(p_input_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid autonomous valuation input hash';
  end if;
  if p_confidence is null or p_confidence < 0.78 or p_confidence > 1 then
    raise exception 'autonomous valuation confidence must be between 0.78 and 1';
  end if;
  if jsonb_typeof(p_valuation_input) <> 'object' then
    raise exception 'valuation input must be an object';
  end if;

  select * into v_item
  from public.research_factory_items
  where id=p_research_factory_item_id
  for update;

  if not found then raise exception 'Research Factory item not found'; end if;
  if v_item.company_id is null then raise exception 'Research Factory item has no company'; end if;

  select * into v_assignment
  from public.research_factory_industry_assignments
  where research_factory_item_id=v_item.id
    and status='applied'
    and module=p_industry_module
    and confidence>=0.80
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'high-confidence autonomous industry assignment not found';
  end if;

  select * into v_decision
  from public.research_factory_autonomous_decisions
  where research_factory_item_id=v_item.id
    and decision_type='valuation_assumptions'
    and decision_status='applied'
    and decision_hash=p_decision_hash
    and confidence>=0.78
    and policy_version=p_policy_version
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'approved autonomous valuation decision not found';
  end if;

  select * into v_existing
  from public.candidate_valuation_input_packs
  where ticker=v_item.ticker
    and input_hash=p_input_hash;

  if found then
    if v_existing.status<>'reviewed'
       or v_existing.industry_module<>p_industry_module
       or v_existing.valuation_input<>p_valuation_input then
      raise exception 'existing valuation pack conflicts with autonomous policy output';
    end if;
    return v_existing.id;
  end if;

  insert into public.candidate_valuation_input_packs(
    ticker,company_id,universe_screen_result_id,
    valuation_methodology_version,industry_module,status,
    valuation_input,input_hash,reviewed_by,reviewed_at,review_note
  ) values (
    v_item.ticker,
    v_item.company_id,
    v_item.source_screen_result_id,
    'solpient-valuation-methodology-v3',
    p_industry_module,
    'reviewed',
    p_valuation_input,
    p_input_hash,
    'autonomous-policy:'||p_policy_version,
    clock_timestamp(),
    'Auto-approved by Autonomous Research Factory V2.1. Decision hash: '||p_decision_hash||
      '. Confidence: '||round(p_confidence*100,1)||'%.'
  )
  returning id into v_id;

  insert into public.research_factory_autonomous_decisions(
    autonomous_run_id,research_factory_item_id,ticker,decision_type,
    decision_status,policy_version,confidence,input_hash,decision_hash,
    output,evidence
  ) values (
    v_decision.autonomous_run_id,
    v_item.id,
    v_item.ticker,
    'valuation_pack',
    'applied',
    p_policy_version,
    p_confidence,
    p_input_hash,
    p_decision_hash,
    jsonb_build_object(
      'candidate_valuation_input_pack_id',v_id,
      'industry_module',p_industry_module,
      'status','reviewed'
    ),
    jsonb_build_object(
      'valuation_assumption_decision_id',v_decision.id,
      'industry_assignment_id',v_assignment.id
    )
  )
  on conflict (research_factory_item_id,decision_type,decision_hash) do nothing;

  return v_id;
end
$$;

revoke all on function public.publish_autonomous_valuation_pack_v2_1(
  uuid,text,text,jsonb,text,numeric,text
) from public,anon,authenticated;

grant execute on function public.publish_autonomous_valuation_pack_v2_1(
  uuid,text,text,jsonb,text,numeric,text
) to service_role;

comment on table public.research_factory_autonomous_decisions is
  'Append-only machine decisions for Autonomous Research Factory V2.1; human and automated approvals remain distinguishable.';
comment on table public.research_factory_industry_assignments is
  'Append-only deterministic industry-module assignments or quarantines for Research Factory candidates.';
comment on function public.publish_autonomous_valuation_pack_v2_1(uuid,text,text,jsonb,text,numeric,text) is
  'Creates a reviewed Valuation V3 input pack only from a recorded high-confidence autonomous industry assignment and valuation-assumption decision.';
