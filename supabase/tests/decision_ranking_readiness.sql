-- Phase 3 ranking/readiness database invariants.
-- Run only after applying the Phase 3 migration. This fixture rolls back.

begin;
set local role service_role;

do $test$
declare
  v_source public.ranking_history%rowtype;
  v_id uuid;
  v_failed boolean;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_source
  from public.ranking_history
  order by ranked_at desc
  limit 1;

  if v_source.id is null then
    raise exception 'Phase 3 fixture requires at least one existing ranking_history row.';
  end if;

  insert into public.ranking_history(
    company_id,research_run_id,ranked_at,rank,overall_score,price,base_fair_value,
    methodology_version,integrity_version,hash_algorithm,canonicalization_version,snapshot_hash,
    business_quality_score,business_quality_coverage_pct,
    investment_opportunity_score,opportunity_coverage_pct,
    evidence_confidence_score,evidence_component_coverage_pct,
    decision_score,readiness_state,readiness_tier,readiness_methodology_version,
    score_inputs,readiness_reasons
  ) values (
    v_source.company_id,v_source.research_run_id,v_now,999,v_source.overall_score,
    v_source.price,v_source.base_fair_value,
    'decision-ranking-v1','historical-integrity-v1','sha256',
    coalesce(v_source.canonicalization_version,'solpient-canonical-json-v1'),repeat('a',64),
    80,100,75,100,90,100,77,'decision_ready',2,'readiness-v1',
    '{"fixture":true}'::jsonb,
    '{"state":"decision_ready","blockers":[],"warnings":[],"decision_ready_blockers":[]}'::jsonb
  )
  returning id into v_id;

  if not exists (
    select 1 from public.ranking_history
    where id=v_id
      and business_quality_score=80
      and investment_opportunity_score=75
      and evidence_confidence_score=90
      and decision_score=77
      and readiness_state='decision_ready'
      and readiness_tier=2
  ) then
    raise exception 'Phase 3 ranking snapshot did not persist expected fields.';
  end if;

  v_failed:=false;
  begin
    update public.ranking_history set decision_score=1 where id=v_id;
  exception when others then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'Phase 3 ranking snapshot update was not blocked by historical integrity.';
  end if;

  v_failed:=false;
  begin
    delete from public.ranking_history where id=v_id;
  exception when others then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'Phase 3 ranking snapshot delete was not blocked by historical integrity.';
  end if;

  v_failed:=false;
  begin
    insert into public.ranking_history(
      company_id,research_run_id,ranked_at,rank,methodology_version,
      integrity_version,hash_algorithm,canonicalization_version,snapshot_hash,
      readiness_state,readiness_tier
    ) values (
      v_source.company_id,v_source.research_run_id,v_now + interval '1 second',1000,
      'decision-ranking-v1','historical-integrity-v1','sha256',
      coalesce(v_source.canonicalization_version,'solpient-canonical-json-v1'),repeat('b',64),
      'buy_now',9
    );
  exception when others then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'Invalid Phase 3 readiness state/tier was accepted.';
  end if;
end
$test$;

rollback;
