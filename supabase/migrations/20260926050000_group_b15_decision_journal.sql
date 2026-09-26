-- Group B / B15 — append-only investment decision journal.
-- Users record their own decision; Solpient captures the current research and
-- personalized thesis state server-side. Historical entries are immutable.

create table if not exists public.position_decision_journal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id uuid not null,
  company_id uuid not null references public.companies(id) on delete restrict,
  decision_type text not null
    check (decision_type in ('watch','hold','add','trim','exit')),
  conviction smallint not null check (conviction between 1 and 5),
  rationale text not null check (char_length(trim(rationale)) between 3 and 5000),
  trigger_item_id text null check (trigger_item_id is null or char_length(trigger_item_id) <= 400),
  research_run_id uuid null references public.research_runs(id) on delete restrict,
  supersedes_decision_id uuid null references public.position_decision_journal(id) on delete restrict,
  decision_snapshot jsonb not null,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint position_decision_journal_position_owner_fkey
    foreign key (position_id,user_id)
    references public.portfolio_positions(id,user_id)
    on delete restrict
);

create index if not exists position_decision_journal_user_time_idx
  on public.position_decision_journal(user_id,decided_at desc);

create index if not exists position_decision_journal_position_time_idx
  on public.position_decision_journal(position_id,decided_at desc);

create index if not exists position_decision_journal_company_time_idx
  on public.position_decision_journal(company_id,decided_at desc);

alter table public.position_decision_journal enable row level security;

revoke all on public.position_decision_journal from public,anon,authenticated;
grant select on public.position_decision_journal to authenticated;
grant all on public.position_decision_journal to service_role;

drop policy if exists "Users read own decision journal"
  on public.position_decision_journal;
create policy "Users read own decision journal"
on public.position_decision_journal for select
to authenticated
using ((select auth.uid())=user_id);

create or replace function private.guard_position_decision_journal_v1()
returns trigger
language plpgsql
set search_path=''
as $
begin
  if tg_op in ('UPDATE','DELETE')
     and current_user not in ('postgres','supabase_admin','supabase_auth_admin') then
    raise exception 'Decision journal rows are append-only; record a new superseding decision instead.';
  end if;

  if tg_op='DELETE' then
    return old;
  end if;
  return new;
end
$;

revoke all on function private.guard_position_decision_journal_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists position_decision_journal_append_only_guard
  on public.position_decision_journal;
create trigger position_decision_journal_append_only_guard
before update or delete on public.position_decision_journal
for each row execute function private.guard_position_decision_journal_v1();

create or replace function consumer_private.record_my_position_decision_v1(
  p_position_id uuid,
  p_decision_type text,
  p_conviction integer,
  p_rationale text,
  p_trigger_item_id text default null,
  p_supersedes_decision_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path=''
as $b15$
declare
  v_user_id uuid:=auth.uid();
  v_company_id uuid;
  v_contract jsonb;
  v_position_state jsonb;
  v_thesis_factors jsonb;
  v_research_run_id uuid;
  v_decision_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required.'
      using errcode='42501';
  end if;

  if p_decision_type not in ('watch','hold','add','trim','exit') then
    raise exception 'Invalid decision type.'
      using errcode='23514';
  end if;

  if p_conviction is null or p_conviction<1 or p_conviction>5 then
    raise exception 'Conviction must be between 1 and 5.'
      using errcode='23514';
  end if;

  if char_length(trim(coalesce(p_rationale,'')))<3 then
    raise exception 'Decision rationale is required.'
      using errcode='23514';
  end if;

  select pp.company_id
  into v_company_id
  from public.portfolio_positions pp
  where pp.id=p_position_id
    and pp.user_id=v_user_id;

  if v_company_id is null then
    raise exception 'Position not found.'
      using errcode='42501';
  end if;

  if p_supersedes_decision_id is not null
     and not exists (
       select 1
       from public.position_decision_journal d
       where d.id=p_supersedes_decision_id
         and d.user_id=v_user_id
         and d.position_id=p_position_id
     ) then
    raise exception 'Superseded decision must belong to this position and user.'
      using errcode='42501';
  end if;

  v_contract:=consumer_private.get_my_portfolio_research_state_v1(now());

  select item
  into v_position_state
  from jsonb_array_elements(coalesce(v_contract->'positions','[]'::jsonb)) item
  where item->>'position_id'=p_position_id::text
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',f.id,
        'source_type',f.source_type,
        'canonical_thesis_variable_id',f.canonical_thesis_variable_id,
        'factor_key',f.factor_key,
        'factor_label',f.factor_label,
        'importance',f.importance,
        'personal_expectation',f.personal_expectation,
        'personal_breaker_condition',f.personal_breaker_condition,
        'enabled',f.enabled,
        'updated_at',f.updated_at
      )
      order by f.importance desc,f.factor_key
    ),
    '[]'::jsonb
  )
  into v_thesis_factors
  from public.position_thesis_factors f
  where f.user_id=v_user_id
    and f.position_id=p_position_id;

  v_research_run_id:=nullif(
    v_position_state->'research_contract'->'current_research'->>'id',
    ''
  )::uuid;

  insert into public.position_decision_journal(
    user_id,position_id,company_id,decision_type,conviction,rationale,
    trigger_item_id,research_run_id,supersedes_decision_id,decision_snapshot
  ) values (
    v_user_id,
    p_position_id,
    v_company_id,
    p_decision_type,
    p_conviction,
    trim(p_rationale),
    nullif(trim(coalesce(p_trigger_item_id,'')),''),
    v_research_run_id,
    p_supersedes_decision_id,
    jsonb_build_object(
      'contract_version','group-b-position-decision-snapshot-v1',
      'captured_at',now(),
      'portfolio_research_state',coalesce(v_position_state,'{}'::jsonb),
      'personal_thesis_factors',coalesce(v_thesis_factors,'[]'::jsonb)
    )
  )
  returning id into v_decision_id;

  return v_decision_id;
end
$b15$;

revoke all on function consumer_private.record_my_position_decision_v1(
  uuid,text,integer,text,text,uuid
) from public,anon;
grant execute on function consumer_private.record_my_position_decision_v1(
  uuid,text,integer,text,text,uuid
) to authenticated;

create or replace function public.record_my_position_decision_v1(
  p_position_id uuid,
  p_decision_type text,
  p_conviction integer,
  p_rationale text,
  p_trigger_item_id text default null,
  p_supersedes_decision_id uuid default null
)
returns uuid
language sql
volatile
security invoker
set search_path=''
as $$
  select consumer_private.record_my_position_decision_v1(
    p_position_id,p_decision_type,p_conviction,p_rationale,
    p_trigger_item_id,p_supersedes_decision_id
  );
$$;

revoke all on function public.record_my_position_decision_v1(
  uuid,text,integer,text,text,uuid
) from public,anon;
grant execute on function public.record_my_position_decision_v1(
  uuid,text,integer,text,text,uuid
) to authenticated;

comment on table public.position_decision_journal is
  'Group B15 append-only user decision history with server-captured research and personalized thesis snapshot.';
comment on function public.record_my_position_decision_v1(uuid,text,integer,text,text,uuid) is
  'Records the authenticated user decision for an owned position and snapshots current research/thesis state. Does not recommend a decision.';
