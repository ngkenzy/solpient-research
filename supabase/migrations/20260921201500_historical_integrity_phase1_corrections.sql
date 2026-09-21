-- Phase 1 correction semantics and append-only resolver hardening.
-- Corrections keep the original observation timestamp while adding a superseding row.
-- Prediction scores may be re-scored only under a new methodology version.

alter table public.realized_outcomes
  drop constraint if exists realized_outcomes_prediction_outcome_id_observed_at_key;

create unique index if not exists realized_outcomes_original_observation_unique_idx
  on public.realized_outcomes(prediction_outcome_id, observed_at)
  where supersedes_id is null;

alter table public.prediction_scores
  drop constraint if exists prediction_scores_prediction_outcome_id_realized_outcome_id_key;

create unique index if not exists prediction_scores_methodology_unique_idx
  on public.prediction_scores(prediction_outcome_id, realized_outcome_id, methodology_version);

alter table public.ranking_history
  alter column methodology_version set default 'ranking-v1';

CREATE OR REPLACE FUNCTION private.resolve_prediction_outcomes(p_as_of_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_run_id uuid;
  v_fundamental integer := 0;
  v_relative integer := 0;
  v_skipped integer := 0;
  rec record;
  v_actual record;
  v_realized_id uuid;
  v_abs_error numeric;
  v_pct_error numeric;
  v_company_target numeric;
  v_benchmark_start numeric;
  v_benchmark_target numeric;
  v_company_return numeric;
  v_benchmark_return numeric;
  v_excess numeric;
  v_direction_correct boolean;
  v_brier numeric;
begin
  insert into private.prediction_resolution_runs(as_of_date)
  values (p_as_of_date)
  returning id into v_run_id;

  for rec in
    select
      po.*,
      ps.company_id,
      ps.predicted_at,
      ps.price_at_prediction,
      ps.benchmark_ticker,
      ps.benchmark_price_at_prediction
    from public.prediction_outcomes po
    join public.prediction_snapshots ps on ps.id = po.prediction_snapshot_id
    where po.resolver_status = 'pending'
      and po.resolver_kind = 'metric'
      and po.target_date is not null
      and po.target_date <= p_as_of_date
      and po.actual_metric_key is not null
      and not exists (
        select 1 from public.realized_outcomes ro
        where ro.prediction_outcome_id = po.id
      )
  loop
    v_realized_id := null;

    select
      mh.value_numeric,
      mh.value_text,
      mh.observed_at,
      mh.period_end,
      mh.source_url,
      mh.source_title
    into v_actual
    from public.company_metric_history mh
    where mh.company_id = rec.company_id
      and mh.metric_key = rec.actual_metric_key
      and (rec.actual_period_type is null or mh.period_type = rec.actual_period_type)
      and mh.period_end between
          (rec.target_date - rec.target_window_days)
          and (rec.target_date + rec.target_window_days)
      and mh.observed_at::date <= p_as_of_date
    order by
      abs(mh.period_end - rec.target_date),
      mh.observed_at desc
    limit 1;

    if found and (v_actual.value_numeric is not null or v_actual.value_text is not null) then
      insert into public.realized_outcomes(
        prediction_outcome_id,
        observed_at,
        actual_value,
        actual_text,
        source_url,
        source_note
      )
      values (
        rec.id,
        v_actual.observed_at,
        v_actual.value_numeric,
        v_actual.value_text,
        v_actual.source_url,
        concat_ws(' · ', v_actual.source_title, 'period end ' || v_actual.period_end::text)
      )
      on conflict do nothing
      returning id into v_realized_id;

      if v_realized_id is null then
        select id into v_realized_id
        from public.realized_outcomes
        where prediction_outcome_id = rec.id
          and observed_at = v_actual.observed_at
        limit 1;
      end if;

      v_abs_error := null;
      v_pct_error := null;

      if v_actual.value_numeric is not null and rec.predicted_value is not null then
        v_abs_error := abs(v_actual.value_numeric - rec.predicted_value);
        if v_actual.value_numeric <> 0 then
          v_pct_error := v_abs_error / abs(v_actual.value_numeric) * 100;
        end if;
      elsif v_actual.value_numeric is not null
            and rec.predicted_low is not null
            and rec.predicted_high is not null then
        v_abs_error := case
          when v_actual.value_numeric between rec.predicted_low and rec.predicted_high then 0
          when v_actual.value_numeric < rec.predicted_low then rec.predicted_low - v_actual.value_numeric
          else v_actual.value_numeric - rec.predicted_high
        end;
        if v_actual.value_numeric <> 0 then
          v_pct_error := v_abs_error / abs(v_actual.value_numeric) * 100;
        end if;
      end if;

      insert into public.prediction_scores(
        prediction_outcome_id,
        realized_outcome_id,
        scored_at,
        absolute_error,
        percentage_error,
        notes
      )
      values (
        rec.id,
        v_realized_id,
        now(),
        v_abs_error,
        v_pct_error,
        'Automatically resolved from company_metric_history'
      )
      on conflict do nothing;

      update public.prediction_outcomes
      set resolver_status = 'resolved',
          resolved_at = now(),
          resolution_note = concat('Matched ', rec.actual_metric_key, ' to period ', v_actual.period_end::text)
      where id = rec.id;

      v_fundamental := v_fundamental + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  for rec in
    select
      po.*,
      ps.company_id,
      ps.predicted_at,
      ps.price_at_prediction,
      ps.benchmark_ticker,
      ps.benchmark_price_at_prediction,
      c.ticker
    from public.prediction_outcomes po
    join public.prediction_snapshots ps on ps.id = po.prediction_snapshot_id
    join public.companies c on c.id = ps.company_id
    where po.resolver_status = 'pending'
      and po.resolver_kind = 'relative_return'
      and po.target_date is not null
      and po.target_date <= p_as_of_date
      and not exists (
        select 1 from public.realized_outcomes ro
        where ro.prediction_outcome_id = po.id
      )
  loop
    v_realized_id := null;
    v_company_target := null;
    v_benchmark_start := rec.benchmark_price_at_prediction;
    v_benchmark_target := null;
    v_company_return := null;
    v_benchmark_return := null;
    v_excess := null;
    v_direction_correct := null;
    v_brier := null;

    select ms.price into v_company_target
    from public.market_snapshots ms
    where ms.symbol = rec.ticker
      and ms.trading_date <= rec.target_date
      and ms.trading_date >= rec.target_date - 7
    order by ms.trading_date desc, ms.observed_at desc
    limit 1;

    if v_benchmark_start is null and rec.benchmark_ticker is not null then
      select ms.price into v_benchmark_start
      from public.market_snapshots ms
      where ms.symbol = rec.benchmark_ticker
        and ms.trading_date <= rec.predicted_at::date
        and ms.trading_date >= rec.predicted_at::date - 7
      order by ms.trading_date desc, ms.observed_at desc
      limit 1;
    end if;

    if rec.benchmark_ticker is not null then
      select ms.price into v_benchmark_target
      from public.market_snapshots ms
      where ms.symbol = rec.benchmark_ticker
        and ms.trading_date <= rec.target_date
        and ms.trading_date >= rec.target_date - 7
      order by ms.trading_date desc, ms.observed_at desc
      limit 1;
    end if;

    if rec.price_at_prediction is not null and rec.price_at_prediction <> 0
       and v_company_target is not null
       and v_benchmark_start is not null and v_benchmark_start <> 0
       and v_benchmark_target is not null then

      v_company_return := (v_company_target / rec.price_at_prediction - 1) * 100;
      v_benchmark_return := (v_benchmark_target / v_benchmark_start - 1) * 100;
      v_excess := v_company_return - v_benchmark_return;

      if rec.predicted_text is not null then
        if lower(rec.predicted_text) like '%outperform%' then
          v_direction_correct := v_excess > 0;
        elsif lower(rec.predicted_text) like '%underperform%' then
          v_direction_correct := v_excess < 0;
        end if;
      end if;

      if rec.predicted_probability is not null and v_direction_correct is not null then
        v_brier := power(
          rec.predicted_probability / 100.0 -
          case when v_direction_correct then 1 else 0 end,
          2
        );
      end if;

      insert into public.realized_outcomes(
        prediction_outcome_id,
        observed_at,
        actual_value,
        actual_text,
        source_note
      )
      values (
        rec.id,
        rec.target_date::timestamptz,
        v_excess,
        case when v_excess > 0 then 'Outperformed benchmark'
             when v_excess < 0 then 'Underperformed benchmark'
             else 'Matched benchmark' end,
        concat(
          rec.ticker, ' return ', round(v_company_return, 2), '% vs ',
          rec.benchmark_ticker, ' ', round(v_benchmark_return, 2),
          '%; excess ', round(v_excess, 2), '%'
        )
      )
      on conflict do nothing
      returning id into v_realized_id;

      if v_realized_id is null then
        select id into v_realized_id
        from public.realized_outcomes
        where prediction_outcome_id = rec.id
          and observed_at = rec.target_date::timestamptz
        limit 1;
      end if;

      insert into public.prediction_scores(
        prediction_outcome_id,
        realized_outcome_id,
        scored_at,
        direction_correct,
        probability_brier_score,
        benchmark_excess_return,
        notes
      )
      values (
        rec.id,
        v_realized_id,
        now(),
        v_direction_correct,
        v_brier,
        v_excess,
        'Automatically resolved from market_snapshots'
      )
      on conflict do nothing;

      update public.prediction_outcomes
      set resolver_status = 'resolved',
          resolved_at = now(),
          resolution_note = concat('Resolved against ', rec.benchmark_ticker, ' through ', rec.target_date::text)
      where id = rec.id;

      v_relative := v_relative + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  update private.prediction_resolution_runs
  set finished_at = now(),
      fundamental_resolved = v_fundamental,
      relative_return_resolved = v_relative,
      skipped_integer = v_skipped,
      status = 'succeeded'
  where id = v_run_id;

  return jsonb_build_object(
    'as_of_date', p_as_of_date,
    'fundamental_resolved', v_fundamental,
    'relative_return_resolved', v_relative,
    'skipped', v_skipped
  );
exception
  when others then
    update private.prediction_resolution_runs
    set finished_at = now(),
        status = 'failed',
        error_message = sqlerrm
    where id = v_run_id;
    raise;
end;
$function$


revoke update on table public.prediction_scores from service_role;

comment on index public.realized_outcomes_original_observation_unique_idx is
  'One original observation per prediction outcome and timestamp; corrections may preserve the same observed_at and supersede the original.';
comment on index public.prediction_scores_methodology_unique_idx is
  'A realized outcome may be scored again only under a distinct methodology version; prior scores remain immutable.';
