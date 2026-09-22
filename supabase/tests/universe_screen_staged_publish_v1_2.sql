-- Universe Screen Staged Publication V1.2 rollback fixture.
begin;
set local role service_role;

do $test$
declare
  v_begin jsonb;
  v_session uuid;
  v_run uuid;
  v_run2 uuid;
  v_failed boolean := false;
  v_run_payload jsonb;
begin
  v_run_payload := jsonb_build_object(
    'as_of_at','2026-09-22T04:00:00Z',
    'methodology_version','fixture-screen-v1.2',
    'selection_version','fixture-selection-v1',
    'provider','fixture',
    'input_hash',repeat('1',64),
    'input_count',3,
    'result_count',3,
    'excluded_count',0,
    'watch_count',1,
    'research_candidate_count',2,
    'solpient_100_candidate_count',0,
    'proposed_deep_research_count',2,
    'metadata',jsonb_build_object(
      'validation_hash',repeat('2',64),
      'universe_input_hash',repeat('3',64)
    )
  );

  select public.begin_universe_screen_publish_v1_2(v_run_payload) into v_begin;
  v_session := (v_begin->>'publish_session_id')::uuid;
  if v_session is null then raise exception 'session was not created'; end if;

  perform public.stage_universe_screen_results_v1_2(
    v_session,1,
    jsonb_build_array(
      jsonb_build_object(
        'ticker','AAA','company_name','AAA','sector','Information Technology',
        'industry','Software','screen_profile','software',
        'screen_state','research_candidate','universe_rank',1,'shortlist_rank',1,
        'proposed_for_deep_research',true,'final_membership_requires_review',true,
        'screen_score',90,'quality_core_score',90,'evidence_coverage_pct',90,
        'quality_score',90,'durability_score',90,'balance_sheet_score',90,
        'growth_score',90,'valuation_score',90,'gates','[]'::jsonb,'reasons','{}'::jsonb,
        'score_detail','{}'::jsonb,'input_summary','{}'::jsonb,'result_hash',repeat('a',64)
      ),
      jsonb_build_object(
        'ticker','BBB','company_name','BBB','sector','Industrials',
        'industry','Industrial','screen_profile','general',
        'screen_state','research_candidate','universe_rank',2,'shortlist_rank',2,
        'proposed_for_deep_research',true,'final_membership_requires_review',true,
        'screen_score',80,'quality_core_score',80,'evidence_coverage_pct',80,
        'quality_score',80,'durability_score',80,'balance_sheet_score',80,
        'growth_score',80,'valuation_score',80,'gates','[]'::jsonb,'reasons','{}'::jsonb,
        'score_detail','{}'::jsonb,'input_summary','{}'::jsonb,'result_hash',repeat('b',64)
      )
    )
  );

  perform public.stage_universe_screen_results_v1_2(
    v_session,3,
    jsonb_build_array(
      jsonb_build_object(
        'ticker','CCC','company_name','CCC','sector','Consumer Discretionary',
        'industry','Retail','screen_profile','general',
        'screen_state','watch','universe_rank',3,'shortlist_rank',null,
        'proposed_for_deep_research',false,'final_membership_requires_review',true,
        'screen_score',70,'quality_core_score',70,'evidence_coverage_pct',70,
        'quality_score',70,'durability_score',70,'balance_sheet_score',70,
        'growth_score',70,'valuation_score',70,'gates','[]'::jsonb,'reasons','{}'::jsonb,
        'score_detail','{}'::jsonb,'input_summary','{}'::jsonb,'result_hash',repeat('c',64)
      )
    )
  );

  select public.finalize_universe_screen_publish_v1_2(v_session) into v_run;
  if v_run is null then raise exception 'finalize returned no run'; end if;
  if (select count(*) from public.universe_screen_results where universe_screen_run_id=v_run) <> 3 then
    raise exception 'final result count mismatch';
  end if;
  if exists (
    select 1 from public.universe_screen_publish_staged_results
    where publish_session_id=v_session
  ) then raise exception 'staging rows were not cleaned up'; end if;

  select public.finalize_universe_screen_publish_v1_2(v_session) into v_run2;
  if v_run2 <> v_run then raise exception 'finalize is not idempotent'; end if;

  begin
    perform public.stage_universe_screen_results_v1_2(
      v_session,1,
      jsonb_build_array(jsonb_build_object('ticker','DIFF','result_hash',repeat('d',64)))
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'finalized session accepted more staging'; end if;
end
$test$;

rollback;
