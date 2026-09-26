-- Group B / B5 — user-scoped What Matters contract.
-- Combines B4 company materiality with B3 position thesis personalization.
-- No event duplication and no persisted recommendation output.

create or replace function consumer_private.get_my_what_matters_v1(
  p_since date default (current_date - 30),
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_since date:=coalesce(p_since,current_date-30);
  v_limit integer:=least(greatest(coalesce(p_limit,100),1),200);
  v_items jsonb;
  v_count integer;
  v_source_status text;
begin
  if v_user_id is null then
    raise exception 'Authentication required.'
      using errcode='42501';
  end if;

  with positions as (
    select
      pp.id as position_id,
      pp.portfolio_id,
      p.name as portfolio_name,
      pp.company_id,
      c.ticker,
      c.company_name
    from public.portfolio_positions pp
    join public.portfolios p
      on p.id=pp.portfolio_id
     and p.user_id=pp.user_id
    join public.companies c on c.id=pp.company_id
    where pp.user_id=v_user_id
  ),
  source_freshness as (
    select
      p.company_id,
      (
        select max(css.observed_at)
        from public.company_state_snapshots css
        where css.company_id=p.company_id
      ) as change_engine_as_of,
      (
        select max(dt.last_evaluated_at)
        from public.decision_triggers dt
        where dt.company_id=p.company_id
      ) as trigger_engine_as_of
    from positions p
    group by p.company_id
  ),
  position_events as (
    select
      p.*,
      event.value as event_json,
      sf.change_engine_as_of,
      sf.trigger_engine_as_of,
      case
        when sf.change_engine_as_of is not null and sf.trigger_engine_as_of is not null
          then least(sf.change_engine_as_of,sf.trigger_engine_as_of)
        else coalesce(sf.change_engine_as_of,sf.trigger_engine_as_of)
      end as source_as_of
    from positions p
    left join source_freshness sf on sf.company_id=p.company_id
    cross join lateral jsonb_array_elements(
      consumer_private.get_company_materiality_events_v1(
        p.company_id,
        v_since,
        100
      )->'events'
    ) event(value)
  ),
  matched as (
    select
      pe.*,
      factor.id as factor_id,
      factor.factor_label,
      factor.importance,
      factor.personal_expectation,
      factor.personal_breaker_condition
    from position_events pe
    left join lateral (
      select f.*
      from public.position_thesis_factors f
      where f.position_id=pe.position_id
        and f.user_id=v_user_id
        and f.enabled
        and nullif(pe.event_json->>'metric_key','') is not null
        and f.factor_key=
          'canonical:metric:'||lower(trim(pe.event_json->>'metric_key'))
      order by f.importance desc,f.updated_at desc,f.id
      limit 1
    ) factor on true
  ),
  scored as (
    select
      m.*,
      coalesce((m.event_json->'company_materiality'->>'score')::integer,0)
        as company_score,
      least(
        100,
        greatest(
          0,
          coalesce((m.event_json->'company_materiality'->>'score')::integer,0)
          + case
              when m.factor_id is null then 0
              else (m.importance-3)*5
            end
        )
      ) as user_score,
      case
        when m.source_as_of is null then 'unavailable'
        when m.source_as_of < now()-interval '72 hours' then 'stale'
        else 'current'
      end as source_status
    from matched m
  ),
  limited as (
    select *
    from scored
    order by user_score desc,
             (event_json->>'occurred_at')::timestamptz desc,
             position_id,
             event_json->>'event_id'
    limit v_limit
  ),
  aggregate_items as (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'item_id',position_id::text||':'||(event_json->>'event_id'),
            'position',jsonb_build_object(
              'id',position_id,
              'portfolio_id',portfolio_id,
              'portfolio_name',portfolio_name,
              'company_id',company_id,
              'ticker',ticker,
              'company_name',company_name
            ),
            'event',event_json,
            'user_materiality',jsonb_build_object(
              'score',user_score,
              'level',case
                when user_score>=90 then 'thesis_priority'
                when user_score>=70 then 'important'
                when user_score>=50 then 'monitor'
                else 'background'
              end,
              'personalized',factor_id is not null,
              'matched_factor_id',factor_id,
              'matched_factor_label',factor_label,
              'importance',importance,
              'personal_expectation',personal_expectation,
              'personal_breaker_condition',personal_breaker_condition,
              'reason',case
                when factor_id is not null
                  then 'Matches an enabled thesis factor with importance '
                    ||importance::text||'/5.'
                else 'No enabled personalized thesis factor matched this event metric.'
              end,
              'methodology_version','group-b-user-materiality-v1'
            ),
            'source_freshness',jsonb_build_object(
              'status',source_status,
              'source_as_of',source_as_of,
              'change_engine_as_of',change_engine_as_of,
              'trigger_engine_as_of',trigger_engine_as_of,
              'age_hours',case
                when source_as_of is null then null
                else round(
                  extract(epoch from (now()-source_as_of))/3600.0,
                  1
                )
              end
            )
          )
          order by user_score desc,
                   (event_json->>'occurred_at')::timestamptz desc,
                   position_id,
                   event_json->>'event_id'
        ),
        '[]'::jsonb
      ) as items,
      count(*)::integer as item_count,
      case
        when count(*)=0 then 'no_items'
        when bool_or(source_status='unavailable') then 'unavailable'
        when bool_or(source_status='stale') then 'stale'
        else 'current'
      end as overall_source_status
    from limited
  )
  select items,item_count,overall_source_status
  into v_items,v_count,v_source_status
  from aggregate_items;

  return jsonb_build_object(
    'contract_version','group-b-what-matters-v1',
    'generated_at',now(),
    'since',v_since,
    'item_count',coalesce(v_count,0),
    'source_status',coalesce(v_source_status,'no_items'),
    'items',coalesce(v_items,'[]'::jsonb)
  );
end
$$;

revoke all on function consumer_private.get_my_what_matters_v1(date,integer)
  from public,anon;
grant execute on function consumer_private.get_my_what_matters_v1(date,integer)
  to authenticated;

create or replace function public.get_my_what_matters_v1(
  p_since date default (current_date - 30),
  p_limit integer default 100
)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select consumer_private.get_my_what_matters_v1(p_since,p_limit);
$$;

revoke all on function public.get_my_what_matters_v1(date,integer)
  from public,anon;
grant execute on function public.get_my_what_matters_v1(date,integer)
  to authenticated;

comment on function public.get_my_what_matters_v1(date,integer) is
  'Group B5 user-scoped What Matters contract. Combines company materiality with enabled position thesis factors without making trading recommendations.';

comment on function consumer_private.get_my_what_matters_v1(date,integer) is
  'Privileged non-exposed B5 helper. User identity is derived only from auth.uid().';
