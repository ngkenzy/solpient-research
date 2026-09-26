-- Group B / B4 — normalized company materiality contract.
-- Reuses existing company_change_events and decision_triggers; no duplicate event storage.

create or replace function consumer_private.get_company_materiality_events_v1(
  p_company_id uuid,
  p_since date default (current_date - 30),
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
  v_since date:=coalesce(p_since,current_date-30);
  v_company public.companies;
  v_events jsonb;
  v_count integer;
begin
  select * into v_company
  from public.companies
  where id=p_company_id;

  if not found then
    raise exception 'Unknown company %.',p_company_id;
  end if;

  with normalized as (
    select
      'company_change'::text as source_kind,
      cce.id::text as source_record_id,
      cce.occurred_at::timestamptz as event_time,
      cce.category as event_type,
      cce.metric_key,
      cce.label,
      cce.summary,
      cce.materiality as materiality_level,
      case cce.materiality
        when 'high' then 90
        when 'material' then 70
        when 'notable' then 50
        else 30
      end as materiality_score,
      cce.decision_impact as decision_effect,
      cce.direction,
      'recorded'::text as event_status,
      jsonb_build_object(
        'source_kind',cce.source_kind,
        'source_id',cce.source_id,
        'source_url',cce.source_url,
        'old_value',cce.old_value,
        'new_value',cce.new_value,
        'delta_value',cce.delta_value,
        'delta_percent',cce.delta_percent,
        'old_text',cce.old_text,
        'new_text',cce.new_text
      ) as evidence
    from public.company_change_events cce
    where cce.company_id=p_company_id
      and cce.occurred_at>=v_since

    union all

    select
      'decision_trigger'::text,
      dt.id::text,
      coalesce(dt.first_triggered_at,dt.last_evaluated_at) as event_time,
      'decision_trigger'::text,
      dt.metric_key,
      dt.label,
      dt.rationale,
      dt.severity,
      case dt.severity
        when 'high' then 90
        when 'material' then 70
        else 40
      end,
      dt.decision_effect,
      null::text,
      dt.evaluation_status,
      jsonb_build_object(
        'trigger_key',dt.trigger_key,
        'trigger_group',dt.trigger_group,
        'comparator',dt.comparator,
        'threshold_value',dt.threshold_value,
        'threshold_unit',dt.threshold_unit,
        'current_value',dt.current_value,
        'current_text',dt.current_text,
        'source_kind',dt.source_kind,
        'source_ref',dt.source_ref,
        'metadata',dt.metadata
      )
    from public.decision_triggers dt
    where dt.company_id=p_company_id
      and dt.evaluation_status in ('triggered','needs_review')
      and coalesce(dt.first_triggered_at,dt.last_evaluated_at)::date>=v_since
  ),
  limited as (
    select *
    from normalized
    order by materiality_score desc,event_time desc,source_kind,source_record_id
    limit v_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'event_id',source_kind||':'||source_record_id,
      'source_kind',source_kind,
      'source_record_id',source_record_id,
      'occurred_at',event_time,
      'event_type',event_type,
      'metric_key',metric_key,
      'label',label,
      'summary',summary,
      'company_materiality',jsonb_build_object(
        'level',materiality_level,
        'score',materiality_score,
        'methodology_version','group-b-company-materiality-v1'
      ),
      'decision_effect',decision_effect,
      'direction',direction,
      'event_status',event_status,
      'evidence',evidence
    ) order by materiality_score desc,event_time desc,source_kind,source_record_id),'[]'::jsonb),
    count(*)::integer
  into v_events,v_count
  from limited;

  return jsonb_build_object(
    'contract_version','group-b-company-materiality-v1',
    'company',jsonb_build_object(
      'id',v_company.id,
      'ticker',v_company.ticker,
      'company_name',v_company.company_name
    ),
    'since',v_since,
    'event_count',v_count,
    'events',v_events
  );
end
$$;

revoke all on function consumer_private.get_company_materiality_events_v1(uuid,date,integer)
  from public,anon;
grant execute on function consumer_private.get_company_materiality_events_v1(uuid,date,integer)
  to authenticated;

create or replace function public.get_company_materiality_events_v1(
  p_company_id uuid,
  p_since date default (current_date - 30),
  p_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select consumer_private.get_company_materiality_events_v1(p_company_id,p_since,p_limit);
$$;

revoke all on function public.get_company_materiality_events_v1(uuid,date,integer)
  from public,anon;
grant execute on function public.get_company_materiality_events_v1(uuid,date,integer)
  to authenticated;

comment on function public.get_company_materiality_events_v1(uuid,date,integer) is
  'Group B4 normalized company-materiality contract over existing change events and triggered decision rules.';

comment on function consumer_private.get_company_materiality_events_v1(uuid,date,integer) is
  'Privileged non-exposed B4 helper; contains no user-owned data.';
