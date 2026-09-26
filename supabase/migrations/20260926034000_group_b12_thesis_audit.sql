-- Group B / B12 — position thesis audit trail.
-- Adds an append-only user thesis-factor history and a read contract that
-- combines it with existing What Matters/company-materiality events.
-- Published Research and company events are not duplicated or mutated.

create table if not exists public.position_thesis_factor_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id uuid not null,
  company_id uuid null references public.companies(id) on delete set null,
  factor_id uuid null,
  source_type text not null check (source_type in ('canonical','custom')),
  canonical_thesis_variable_id uuid null,
  factor_key text not null,
  factor_label text not null,
  event_type text not null
    check (event_type in ('factor_baseline','factor_added','factor_updated','factor_removed')),
  importance_before smallint null check (importance_before is null or importance_before between 1 and 5),
  importance_after smallint null check (importance_after is null or importance_after between 1 and 5),
  personal_expectation_before text null,
  personal_expectation_after text null,
  personal_breaker_before text null,
  personal_breaker_after text null,
  enabled_before boolean null,
  enabled_after boolean null,
  changed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists position_thesis_factor_history_user_position_idx
  on public.position_thesis_factor_history(user_id,position_id,changed_at desc,id);

create index if not exists position_thesis_factor_history_company_idx
  on public.position_thesis_factor_history(company_id,changed_at desc)
  where company_id is not null;

alter table public.position_thesis_factor_history enable row level security;

revoke all on public.position_thesis_factor_history from public,anon,authenticated;
grant select on public.position_thesis_factor_history to authenticated;
grant all on public.position_thesis_factor_history to service_role;

drop policy if exists "Users read own thesis factor history"
  on public.position_thesis_factor_history;
create policy "Users read own thesis factor history"
on public.position_thesis_factor_history for select
to authenticated
using ((select auth.uid())=user_id);

drop trigger if exists position_thesis_factor_history_append_only_guard
  on public.position_thesis_factor_history;
create trigger position_thesis_factor_history_append_only_guard
before update or delete on public.position_thesis_factor_history
for each row execute function private.guard_append_only_history();

create or replace function private.record_position_thesis_factor_history_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.position_thesis_factors;
  v_company_id uuid;
  v_event_type text;
begin
  if tg_op='UPDATE'
     and new.source_type is not distinct from old.source_type
     and new.canonical_thesis_variable_id is not distinct from old.canonical_thesis_variable_id
     and new.factor_key is not distinct from old.factor_key
     and new.factor_label is not distinct from old.factor_label
     and new.importance is not distinct from old.importance
     and new.personal_expectation is not distinct from old.personal_expectation
     and new.personal_breaker_condition is not distinct from old.personal_breaker_condition
     and new.enabled is not distinct from old.enabled then
    return new;
  end if;

  if tg_op='DELETE' then
    v_row:=old;
    v_event_type:='factor_removed';
  elsif tg_op='INSERT' then
    v_row:=new;
    v_event_type:='factor_added';
  else
    v_row:=new;
    v_event_type:='factor_updated';
  end if;

  select pp.company_id
  into v_company_id
  from public.portfolio_positions pp
  where pp.id=v_row.position_id
    and pp.user_id=v_row.user_id;

  insert into public.position_thesis_factor_history(
    user_id,position_id,company_id,factor_id,source_type,
    canonical_thesis_variable_id,factor_key,factor_label,event_type,
    importance_before,importance_after,
    personal_expectation_before,personal_expectation_after,
    personal_breaker_before,personal_breaker_after,
    enabled_before,enabled_after,changed_at,metadata
  ) values (
    v_row.user_id,
    v_row.position_id,
    v_company_id,
    v_row.id,
    v_row.source_type,
    v_row.canonical_thesis_variable_id,
    v_row.factor_key,
    v_row.factor_label,
    v_event_type,
    case when tg_op in ('UPDATE','DELETE') then old.importance else null end,
    case when tg_op in ('INSERT','UPDATE') then new.importance else null end,
    case when tg_op in ('UPDATE','DELETE') then old.personal_expectation else null end,
    case when tg_op in ('INSERT','UPDATE') then new.personal_expectation else null end,
    case when tg_op in ('UPDATE','DELETE') then old.personal_breaker_condition else null end,
    case when tg_op in ('INSERT','UPDATE') then new.personal_breaker_condition else null end,
    case when tg_op in ('UPDATE','DELETE') then old.enabled else null end,
    case when tg_op in ('INSERT','UPDATE') then new.enabled else null end,
    now(),
    jsonb_build_object(
      'history_version','group-b-thesis-factor-history-v1',
      'recorded_from_trigger',true
    )
  );

  if tg_op='DELETE' then return old; end if;
  return new;
end
$$;

revoke all on function private.record_position_thesis_factor_history_v1()
  from public,anon,authenticated;

drop trigger if exists position_thesis_factors_history
  on public.position_thesis_factors;
create trigger position_thesis_factors_history
after insert or update or delete on public.position_thesis_factors
for each row execute function private.record_position_thesis_factor_history_v1();

-- Seed one baseline record for factors that existed before B12.
insert into public.position_thesis_factor_history(
  user_id,position_id,company_id,factor_id,source_type,
  canonical_thesis_variable_id,factor_key,factor_label,event_type,
  importance_after,personal_expectation_after,personal_breaker_after,
  enabled_after,changed_at,metadata
)
select
  f.user_id,
  f.position_id,
  pp.company_id,
  f.id,
  f.source_type,
  f.canonical_thesis_variable_id,
  f.factor_key,
  f.factor_label,
  'factor_baseline',
  f.importance,
  f.personal_expectation,
  f.personal_breaker_condition,
  f.enabled,
  f.created_at,
  jsonb_build_object(
    'history_version','group-b-thesis-factor-history-v1',
    'seeded_at_b12',true
  )
from public.position_thesis_factors f
left join public.portfolio_positions pp
  on pp.id=f.position_id
 and pp.user_id=f.user_id
where not exists (
  select 1
  from public.position_thesis_factor_history h
  where h.user_id=f.user_id
    and h.position_id=f.position_id
    and h.factor_id=f.id
);

create or replace function consumer_private.get_my_position_thesis_audit_v1(
  p_position_id uuid,
  p_since date default (current_date - 180),
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_position record;
  v_since date:=coalesce(p_since,current_date-180);
  v_limit integer:=least(greatest(coalesce(p_limit,200),1),500);
  v_what_matters jsonb;
  v_timeline jsonb;
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required.'
      using errcode='42501';
  end if;

  select
    pp.id,
    pp.portfolio_id,
    p.name as portfolio_name,
    pp.company_id,
    c.ticker,
    c.company_name
  into v_position
  from public.portfolio_positions pp
  join public.portfolios p
    on p.id=pp.portfolio_id
   and p.user_id=pp.user_id
  join public.companies c on c.id=pp.company_id
  where pp.id=p_position_id
    and pp.user_id=v_user_id;

  if not found then
    raise exception 'Position is not available to this account.'
      using errcode='42501';
  end if;

  v_what_matters:=consumer_private.get_my_what_matters_v1(v_since,500);

  with material_events as (
    select
      'material_event'::text as audit_kind,
      item->>'item_id' as audit_id,
      coalesce(
        nullif(item->'event'->>'occurred_at','')::timestamptz,
        now()
      ) as occurred_at,
      item->'event'->>'label' as title,
      item->'event'->>'summary' as summary,
      item->'event'->>'metric_key' as metric_key,
      jsonb_build_object(
        'event',item->'event',
        'user_materiality',item->'user_materiality',
        'source_freshness',item->'source_freshness',
        'alert',(
          select jsonb_build_object(
            'id',a.id,
            'state',a.state,
            'level',a.level,
            'score',a.score,
            'read_at',a.read_at,
            'dismissed_at',a.dismissed_at
          )
          from public.thesis_alerts a
          where a.user_id=v_user_id
            and a.position_id=p_position_id
            and a.item_id=item->>'item_id'
          order by a.updated_at desc,a.id
          limit 1
        ),
        'feedback',(
          select jsonb_build_object(
            'feedback_type',f.feedback_type,
            'note',f.note,
            'updated_at',f.updated_at
          )
          from public.what_matters_feedback f
          where f.user_id=v_user_id
            and f.position_id=p_position_id
            and f.item_id=item->>'item_id'
          order by f.updated_at desc,f.id
          limit 1
        )
      ) as details
    from jsonb_array_elements(coalesce(v_what_matters->'items','[]'::jsonb)) item
    where (item->'position'->>'id')::uuid=p_position_id
  ),
  factor_events as (
    select
      'thesis_factor_change'::text as audit_kind,
      h.id::text as audit_id,
      h.changed_at as occurred_at,
      h.factor_label as title,
      case h.event_type
        when 'factor_baseline' then 'Thesis factor baseline recorded.'
        when 'factor_added' then 'Thesis factor added.'
        when 'factor_updated' then 'Thesis factor personalization changed.'
        when 'factor_removed' then 'Thesis factor removed.'
        else 'Thesis factor changed.'
      end as summary,
      case
        when h.factor_key like 'canonical:metric:%'
          then replace(h.factor_key,'canonical:metric:','')
        else null
      end as metric_key,
      jsonb_build_object(
        'event_type',h.event_type,
        'source_type',h.source_type,
        'factor_id',h.factor_id,
        'canonical_thesis_variable_id',h.canonical_thesis_variable_id,
        'factor_key',h.factor_key,
        'importance_before',h.importance_before,
        'importance_after',h.importance_after,
        'personal_expectation_before',h.personal_expectation_before,
        'personal_expectation_after',h.personal_expectation_after,
        'personal_breaker_before',h.personal_breaker_before,
        'personal_breaker_after',h.personal_breaker_after,
        'enabled_before',h.enabled_before,
        'enabled_after',h.enabled_after
      ) as details
    from public.position_thesis_factor_history h
    where h.user_id=v_user_id
      and h.position_id=p_position_id
      and h.changed_at::date>=v_since
  ),
  combined as (
    select * from material_events
    union all
    select * from factor_events
  ),
  limited as (
    select *
    from combined
    order by occurred_at desc,audit_kind,audit_id
    limit v_limit
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'audit_kind',audit_kind,
          'audit_id',audit_id,
          'occurred_at',occurred_at,
          'title',title,
          'summary',summary,
          'metric_key',metric_key,
          'details',details
        )
        order by occurred_at desc,audit_kind,audit_id
      ),
      '[]'::jsonb
    ),
    count(*)::integer
  into v_timeline,v_count
  from limited;

  return jsonb_build_object(
    'contract_version','group-b-position-thesis-audit-v1',
    'generated_at',now(),
    'since',v_since,
    'position',jsonb_build_object(
      'id',v_position.id,
      'portfolio_id',v_position.portfolio_id,
      'portfolio_name',v_position.portfolio_name,
      'company_id',v_position.company_id,
      'ticker',v_position.ticker,
      'company_name',v_position.company_name
    ),
    'timeline_count',coalesce(v_count,0),
    'timeline',coalesce(v_timeline,'[]'::jsonb)
  );
end
$$;

revoke all on function consumer_private.get_my_position_thesis_audit_v1(uuid,date,integer)
  from public,anon;
grant execute on function consumer_private.get_my_position_thesis_audit_v1(uuid,date,integer)
  to authenticated;

create or replace function public.get_my_position_thesis_audit_v1(
  p_position_id uuid,
  p_since date default (current_date - 180),
  p_limit integer default 200
)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select consumer_private.get_my_position_thesis_audit_v1(
    p_position_id,p_since,p_limit
  );
$$;

revoke all on function public.get_my_position_thesis_audit_v1(uuid,date,integer)
  from public,anon;
grant execute on function public.get_my_position_thesis_audit_v1(uuid,date,integer)
  to authenticated;

comment on table public.position_thesis_factor_history is
  'Group B12 append-only history of user thesis-factor personalization. Written only by system trigger; users may only read their own rows.';

comment on function public.get_my_position_thesis_audit_v1(uuid,date,integer) is
  'Group B12 authenticated position-level thesis audit timeline combining factor-history with existing What Matters events, alerts, evidence, and feedback.';
