-- Research Candidate Pipeline V2.4 database integrity fixture.
-- Requires the V2.4 migration and rolls back all fixture data/events.

begin;
set local role service_role;

do $test$
declare
  v_definition uuid;
  v_implementation_hash text := repeat('a',64);
  v_validation_bundle_hash text := repeat('b',64);
  v_commit_sha text := repeat('1',40);
  v_screen_run uuid;
  v_screen_a uuid;
  v_screen_b uuid;
  v_begin jsonb;
  v_session uuid;
  v_run uuid;
  v_failed boolean := false;
begin
  select id,implementation_hash
    into v_definition,v_implementation_hash
  from public.methodology_definitions
  where methodology_key='research_candidate_pipeline'
    and version='research-candidate-pipeline-v2.4';

  if v_definition is null then
    insert into public.methodology_definitions(
      methodology_key,version,name,category,risk_class,purpose,owner,
      source_files,known_limitations,change_summary,impacts,legacy_bootstrap,
      registry_version,manifest,manifest_hash,implementation_hash
    ) values (
      'research_candidate_pipeline','research-candidate-pipeline-v2.4',
      'Fixture Pipeline V2.4','repair','high',
      'Fixture methodology used to prove V2.4 activation and atomic publication invariants.',
      'Solpient',
      '["lib/research-candidate-pipeline-v2-4.mjs"]'::jsonb,
      '["fixture"]'::jsonb,
      'fixture integrity validation',
      '{"database":true,"capital_decision":true,"historical_interpretation":true}'::jsonb,
      false,
      'methodology-registry-v1',
      '{"methodology_key":"research_candidate_pipeline","version":"research-candidate-pipeline-v2.4","source_files":["lib/research-candidate-pipeline-v2-4.mjs"]}'::jsonb,
      repeat('c',64),
      v_implementation_hash
    )
    returning id into v_definition;

    insert into public.methodology_lifecycle_events(
      methodology_definition_id,event_type,reason,actor,effective_at
    ) values
      (v_definition,'registered','fixture','test','2026-09-22T04:50:00Z'),
      (v_definition,'candidate','fixture','test','2026-09-22T04:50:01Z');

    insert into public.methodology_validation_runs(
      methodology_definition_id,validation_type,status,validator,evidence_ref,
      commit_sha,details
    )
    select
      v_definition,v.validation_type,'pass','fixture','fixture',
      v_commit_sha,
      jsonb_build_object(
        'implementation_hash',v_implementation_hash,
        'validation_bundle_hash',v_validation_bundle_hash
      )
    from (
      values
        ('unit_tests'),
        ('build'),
        ('db_invariant'),
        ('historical_integrity'),
        ('manual_review')
    ) as v(validation_type);

    perform public.activate_research_candidate_pipeline_v2_4(
      v_definition,
      v_commit_sha,
      v_implementation_hash,
      v_validation_bundle_hash,
      'fixture'
    );
  end if;

  insert into public.universe_screen_runs(
    as_of_at,methodology_version,selection_version,provider,input_hash,
    input_count,result_count,research_candidate_count,
    solpient_100_candidate_count,proposed_deep_research_count,metadata
  ) values (
    '2026-09-21T23:59:59Z',
    'solpient-universe-screen-v2.3',
    'fixture-selection-v1',
    'fixture-pipeline-v2.4',
    repeat('2',64),
    2,2,2,2,2,
    jsonb_build_object(
      'validation_hash',repeat('3',64),
      'universe_input_hash',repeat('4',64)
    )
  ) returning id into v_screen_run;

  insert into public.universe_screen_results(
    universe_screen_run_id,ticker,screen_profile,screen_state,universe_rank,
    shortlist_rank,proposed_for_deep_research,screen_score,quality_core_score,
    evidence_coverage_pct,gates,reasons,score_detail,input_summary,result_hash
  ) values (
    v_screen_run,'P24A','software','solpient_100_candidate',1,1,true,
    90,90,90,'[]'::jsonb,'{}'::jsonb,'{}'::jsonb,'{"price":100}'::jsonb,repeat('5',64)
  ) returning id into v_screen_a;

  insert into public.universe_screen_results(
    universe_screen_run_id,ticker,screen_profile,screen_state,universe_rank,
    shortlist_rank,proposed_for_deep_research,screen_score,quality_core_score,
    evidence_coverage_pct,gates,reasons,score_detail,input_summary,result_hash
  ) values (
    v_screen_run,'P24B','industrial','research_candidate',2,2,true,
    80,80,80,'[]'::jsonb,'{}'::jsonb,'{}'::jsonb,'{"price":50}'::jsonb,repeat('6',64)
  ) returning id into v_screen_b;

  select public.begin_research_candidate_pipeline_publish_v2_4(
    jsonb_build_object(
      'universe_screen_run_id',v_screen_run,
      'pipeline_version','research-candidate-pipeline-v2.4',
      'valuation_methodology_version','solpient-valuation-methodology-v3',
      'readiness_methodology_version','readiness-v1',
      'evaluation_as_of','2026-09-21T23:59:59Z',
      'input_hash',repeat('7',64),
      'candidate_count',2,
      'decision_ready_count',0,
      'research_ready_count',0,
      'building_count',0,
      'onboarding_count',1,
      'valuation_building_count',1,
      'metadata',jsonb_build_object(
        'universe_screen_input_hash',repeat('2',64),
        'screen_validation_hash',repeat('3',64),
        'universe_input_hash',repeat('4',64),
        'pipeline_implementation_hash',v_implementation_hash
      )
    )
  ) into v_begin;

  v_session := (v_begin->>'publish_session_id')::uuid;
  if v_session is null then raise exception 'V2.4 publish session was not created'; end if;

  perform public.stage_research_candidate_pipeline_items_v2_4(
    v_session,1,
    jsonb_build_array(
      jsonb_build_object(
        'universe_screen_result_id',v_screen_a,
        'ticker','P24A',
        'company_id',null,
        'research_run_id',null,
        'valuation_input_pack_id',null,
        'stage','onboarding',
        'readiness_state','building',
        'valuation_preflight_complete',false,
        'valuation_base_fair_value',null,
        'valuation_confidence',null,
        'valuation_confidence_band',null,
        'base_5y_cagr',null,
        'decision_score',null,
        'evidence_confidence',null,
        'source_snapshot_hash',repeat('8',64),
        'source_snapshot',jsonb_build_object('ticker','P24A'),
        'next_actions','[]'::jsonb,
        'pipeline_output',jsonb_build_object(
          'pipelineVersion','research-candidate-pipeline-v2.4',
          'stage','onboarding'
        ),
        'item_hash',repeat('9',64)
      ),
      jsonb_build_object(
        'universe_screen_result_id',v_screen_b,
        'ticker','P24B',
        'company_id',null,
        'research_run_id',null,
        'valuation_input_pack_id',null,
        'stage','valuation_building',
        'readiness_state','building',
        'valuation_preflight_complete',false,
        'valuation_base_fair_value',null,
        'valuation_confidence',null,
        'valuation_confidence_band',null,
        'base_5y_cagr',null,
        'decision_score',null,
        'evidence_confidence',null,
        'source_snapshot_hash',repeat('d',64),
        'source_snapshot',jsonb_build_object('ticker','P24B'),
        'next_actions','[]'::jsonb,
        'pipeline_output',jsonb_build_object(
          'pipelineVersion','research-candidate-pipeline-v2.4',
          'stage','valuation_building'
        ),
        'item_hash',repeat('e',64)
      )
    )
  );

  select public.finalize_research_candidate_pipeline_publish_v2_4(v_session)
    into v_run;

  if v_run is null then raise exception 'V2.4 finalize returned no run'; end if;
  if (
    select count(*) from public.research_candidate_pipeline_items
    where research_candidate_pipeline_run_id=v_run
  ) <> 2 then
    raise exception 'V2.4 final item count mismatch';
  end if;
  if (
    select count(*) from public.research_candidate_pipeline_items
    where research_candidate_pipeline_run_id=v_run
      and source_snapshot_hash is not null
      and source_snapshot is not null
  ) <> 2 then
    raise exception 'V2.4 source snapshots were not preserved';
  end if;
  if exists (
    select 1 from public.research_candidate_pipeline_publish_staged_items
    where publish_session_id=v_session
  ) then
    raise exception 'V2.4 staging rows were not cleaned after finalize';
  end if;

  -- Incomplete staging must fail without producing an immutable run.
  select public.begin_research_candidate_pipeline_publish_v2_4(
    jsonb_build_object(
      'universe_screen_run_id',v_screen_run,
      'pipeline_version','research-candidate-pipeline-v2.4',
      'valuation_methodology_version','solpient-valuation-methodology-v3',
      'readiness_methodology_version','readiness-v1',
      'evaluation_as_of','2026-09-21T23:59:59Z',
      'input_hash',repeat('f',64),
      'candidate_count',2,
      'decision_ready_count',0,
      'research_ready_count',0,
      'building_count',0,
      'onboarding_count',2,
      'valuation_building_count',0,
      'metadata',jsonb_build_object(
        'universe_screen_input_hash',repeat('2',64),
        'screen_validation_hash',repeat('3',64),
        'universe_input_hash',repeat('4',64),
        'pipeline_implementation_hash',v_implementation_hash
      )
    )
  ) into v_begin;
  v_session := (v_begin->>'publish_session_id')::uuid;

  perform public.stage_research_candidate_pipeline_items_v2_4(
    v_session,1,
    jsonb_build_array(
      jsonb_build_object(
        'universe_screen_result_id',v_screen_a,
        'ticker','P24A',
        'stage','onboarding',
        'readiness_state','building',
        'valuation_preflight_complete',false,
        'source_snapshot_hash',repeat('8',64),
        'source_snapshot','{}'::jsonb,
        'next_actions','[]'::jsonb,
        'pipeline_output',jsonb_build_object(
          'pipelineVersion','research-candidate-pipeline-v2.4'
        ),
        'item_hash',repeat('9',64)
      )
    )
  );

  begin
    perform public.finalize_research_candidate_pipeline_publish_v2_4(v_session);
  exception when others then
    v_failed := true;
  end;

  if not v_failed then raise exception 'Incomplete V2.4 staging unexpectedly finalized'; end if;
  if exists (
    select 1 from public.research_candidate_pipeline_runs
    where input_hash=repeat('f',64)
  ) then
    raise exception 'Failed V2.4 finalize left an immutable orphan run';
  end if;
end
$test$;

rollback;
