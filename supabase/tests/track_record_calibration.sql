-- Verified Track Record / Calibration Engine database invariants.
-- Run after the migration. Entire fixture rolls back.

begin;
set local role service_role;

do $test$
declare
  v_run uuid;
  v_scope uuid;
  v_failed boolean;
begin
  insert into public.track_record_runs(
    as_of_at,methodology_version,calibration_bucket_version,input_hash,
    forecast_row_count,verified_row_count,unresolved_row_count,
    weak_lineage_row_count,unverified_snapshot_row_count,source_summary
  ) values (
    clock_timestamp(),'track-record-v1','calibration-buckets-20pct-v1',repeat('a',64),
    10,5,5,0,0,'{"fixture":true}'::jsonb
  ) returning id into v_run;

  insert into public.track_record_scope_snapshots(
    track_record_run_id,scope_type,scope_key,label,sample_grade,total_forecast_rows,
    verified_sample_size,unresolved_count,weak_lineage_count,unverified_snapshot_count,
    numeric_metrics,direction_metrics,probability_metrics,confidence_calibration_metrics,
    benchmark_relative_metrics,caveat,snapshot_hash
  ) values (
    v_run,'global','all','All verified forecasts','emerging',10,5,5,0,0,
    '{"sample_size":5,"median_ape":12}'::jsonb,
    '{"sample_size":3,"accuracy":66.67}'::jsonb,
    '{"sample_size":2,"brier_score":0.2}'::jsonb,
    '{"sample_size":3}'::jsonb,
    '{"sample_size":1,"benchmark_win_rate":100}'::jsonb,
    'Emerging sample.',repeat('b',64)
  ) returning id into v_scope;

  insert into public.track_record_calibration_buckets(
    track_record_scope_snapshot_id,calibration_type,lower_bound,upper_bound,
    sample_size,mean_forecast_probability,observed_rate,calibration_gap,
    absolute_calibration_gap,brier_score
  ) values (
    v_scope,'probability',60,80,2,70,50,20,20,.2
  );

  v_failed:=false;
  begin update public.track_record_runs set verified_row_count=99 where id=v_run;
  exception when others then v_failed:=true; end;
  if not v_failed then raise exception 'Track-record run was mutable.'; end if;

  v_failed:=false;
  begin delete from public.track_record_scope_snapshots where id=v_scope;
  exception when others then v_failed:=true; end;
  if not v_failed then raise exception 'Track-record scope snapshot was deletable.'; end if;

  if has_table_privilege('anon','public.track_record_runs','SELECT')
     or has_table_privilege('authenticated','public.track_record_runs','SELECT') then
    raise exception 'Public roles unexpectedly have raw track-record ledger access.';
  end if;

  v_failed:=false;
  begin
    insert into public.track_record_runs(
      as_of_at,methodology_version,calibration_bucket_version,input_hash
    ) values (clock_timestamp(),'track-record-v1','calibration-buckets-20pct-v1',repeat('a',64));
  exception when unique_violation then v_failed:=true; end;
  if not v_failed then raise exception 'Duplicate input hash produced another immutable run.'; end if;
end
$test$;

rollback;
