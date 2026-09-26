-- V1 Portfolio — Own/Follow relationship + position weights.
--
-- 1. Adds `relationship` ('own' | 'follow', default 'own'), a manual target
--    `weight` percent (0-100, nullable), and a manual `market_value` dollar
--    amount (nullable) to public.portfolio_positions. Manual entry and CSV
--    are first-class: no brokerage/Plaid linking is ever required.
-- 2. Joins position weight into consumer_private.get_my_what_matters_v1 so a
--    `high` company event on a 0.5% position no longer scores like one on a
--    40% position. Methodology version bumps to group-b-user-materiality-v2.
--
-- Weight rule (deterministic, per portfolio):
--   basis_i        = coalesce(market_value, quantity * average_cost, 0)
--                    for relationship='own' positions only.
--   dollar_share_i = basis_i / total_basis, or 1/n_owned when total_basis = 0
--                    (missing position dollars -> equal weighting among owned
--                    names, never exclusion).
--   raw_i          = coalesce(manual weight pct / 100, dollar_share_i)
--   share_i        = raw_i / sum(raw), or 1/n_owned when sum(raw) = 0.
--   weight_factor  = share_i * n_owned  (1.0 under equal weighting, so the
--                    score is unchanged from v1 when no weight info exists).
--   user_score     = clamp(0, 100, round(company_score * weight_factor
--                    + thesis_importance_boost)).
-- Follow positions carry no portfolio weight: they keep weight_factor = 1.0
-- (neutral) and are never excluded from What Matters.

alter table public.portfolio_positions
  add column if not exists relationship text not null default 'own'
    check (relationship in ('own', 'follow')),
  add column if not exists weight numeric(7,4) null
    check (weight is null or (weight >= 0 and weight <= 100)),
  add column if not exists market_value numeric(24,2) null
    check (market_value is null or market_value >= 0);

comment on column public.portfolio_positions.relationship is
  'V1: own = held position, follow = watched company with no ownership. Defaults to own.';
comment on column public.portfolio_positions.weight is
  'V1: manual target weight as a percent of the portfolio (0-100). Null means derive from market_value / cost basis, else equal-share fallback.';
comment on column public.portfolio_positions.market_value is
  'V1: manual position market value in the portfolio base currency. Alternative to share counts for weight computation; no brokerage link required.';

create index if not exists portfolio_positions_user_relationship_idx
  on public.portfolio_positions(user_id, relationship);

-- Owner-scoped RLS already covers the whole row (policies on
-- public.portfolio_positions match auth.uid() = user_id), so the new columns
-- inherit the same isolation. Grants are unchanged: authenticated gets
-- select/insert/update/delete, service_role gets all.

-- Stage B: weight-aware What Matters scoring.
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
      c.company_name,
      pp.relationship,
      pp.weight as manual_weight_pct,
      pp.market_value,
      pp.quantity,
      pp.average_cost
    from public.portfolio_positions pp
    join public.portfolios p
      on p.id=pp.portfolio_id
     and p.user_id=pp.user_id
    join public.companies c on c.id=pp.company_id
    where pp.user_id=v_user_id
  ),
  -- V1 position weights, computed per portfolio. Missing position dollars
  -- fall back to equal weighting among owned names (never exclusion);
  -- follow positions stay neutral (factor 1.0) since they carry no weight.
  weighted as (
    select
      p.*,
      case
        when p.relationship='own'
          then coalesce(p.market_value, p.quantity * p.average_cost, 0)
        else null
      end as dollar_basis,
      count(*) filter (where p.relationship='own')
        over (partition by p.portfolio_id) as owned_count,
      sum(
        case
          when p.relationship='own'
            then coalesce(p.market_value, p.quantity * p.average_cost, 0)
          else 0
        end
      ) over (partition by p.portfolio_id) as owned_dollar_total
    from positions p
  ),
  shares as (
    select
      w.*,
      case
        when w.relationship<>'own' then null
        when w.owned_count=0 then 1.0
        when w.owned_dollar_total > 0
          then w.dollar_basis / w.owned_dollar_total
        else 1.0 / w.owned_count
      end as dollar_share,
      case
        when w.relationship<>'own' then 'follow'
        when w.manual_weight_pct is not null then 'manual'
        when w.market_value is not null then 'market_value'
        when w.average_cost is not null then 'cost_basis'
        else 'equal_share'
      end as weight_basis
    from weighted w
  ),
  normalized as (
    select
      s.*,
      coalesce(s.manual_weight_pct / 100, s.dollar_share) as raw_share,
      sum(coalesce(s.manual_weight_pct / 100, s.dollar_share))
        over (partition by s.portfolio_id) as raw_total
    from shares s
  ),
  final_weights as (
    select
      n.*,
      case
        when n.relationship<>'own' then 1.0
        when n.owned_count=0 then 1.0
        when n.raw_total > 0
          then (n.raw_share / n.raw_total) * n.owned_count
        else 1.0
      end as weight_factor,
      case
        when n.relationship<>'own' then null
        when n.owned_count=0 then 1.0
        when n.raw_total > 0 then n.raw_share / n.raw_total
        else 1.0 / n.owned_count
      end as weight_share
    from normalized n
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
    from final_weights p
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
    from final_weights p
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
          round(
            coalesce((m.event_json->'company_materiality'->>'score')::integer,0)
              * m.weight_factor
            + case
                when m.factor_id is null then 0
                else (m.importance-3)*5
              end
          )::integer
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
              'company_name',company_name,
              'relationship',relationship,
              'weight_share',weight_share,
              'weight_factor',weight_factor,
              'weight_basis',weight_basis
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
              'weight_factor',weight_factor,
              'reason',case
                when factor_id is not null
                  then 'Matches an enabled thesis factor with importance '
                    ||importance::text||'/5.'
                else 'No enabled personalized thesis factor matched this event metric.'
              end,
              'methodology_version','group-b-user-materiality-v2'
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

comment on function consumer_private.get_my_what_matters_v1(date,integer) is
  'Privileged non-exposed B5 helper. User identity is derived only from auth.uid(). V1: user_score is scaled by the position weight factor (group-b-user-materiality-v2); missing position dollars fall back to equal weighting, never exclusion.';
