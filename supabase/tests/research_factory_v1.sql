-- Research Factory V1 database invariants.
-- Entire fixture runs inside a transaction and rolls back.

begin;
set local role service_role;

do $test$
declare
  v_screen_run uuid;
  v_screen_a uuid;
  v_screen_b uuid;
  v_pipeline_run uuid;
  v_pipeline_a uuid;
  v_pipeline_b uuid;
  v_factory_run uuid;
  v_factory_item uuid;
  v_company uuid;
  v_valuation_draft uuid;
  v_failed boolean := false;
  v_items jsonb;
begin
  insert into public.universe_screen_runs(
    as_of_at,methodology_version,selection_version,provider,input_hash,
    input_count,result_count,research_candidate_count,
    solpient_100_candidate_count,proposed_deep_research_count,metadata
  ) values (
    '2026-09-21T23:59:59Z',
    'solpient-universe-screen-v2.3',
    'fixture-selection-v1',
    'research-factory-v1-fixture',
    repeat('1',64),
    2,2,2,2,2,
    jsonb_build_object(
      'validation_hash',repeat('2',64),
      'universe_input_hash',repeat('3',64)
    )
  ) returning id into v_screen_run;

  insert into public.universe_screen_results(
    universe_screen_run_id,ticker,company_name,sector,industry,screen_profile,
    screen_state,universe_rank,shortlist_rank,proposed_for_deep_research,
    screen_score,quality_core_score,evidence_coverage_pct,
    gates,reasons,score_detail,input_summary,result_hash
  ) values (
    v_screen_run,'RFV1A','Factory Fixture A','Information Technology','Software','software',
    'solpient_100_candidate',1,1,true,90,90,90,
    '[]'::jsonb,'{}'::jsonb,'{}'::jsonb,'{"price":100}'::jsonb,repeat('4',64)
  ) returning id into v_screen_a;

  insert into public.universe_screen_results(
    universe_screen_run_id,ticker,company_name,sector,industry,screen_profile,
    screen_state,universe_rank,shortlist_rank,proposed_for_deep_research,
    screen_score,quality_core_score,evidence_coverage_pct,
    gates,reasons,score_detail,input_summary,result_hash
  ) values (
    v_screen_run,'RFV1B','Factory Fixture B','Industrials','Industrial','industrial',
    'research_candidate',2,2,true,80,80,80,
    '[]'::jsonb,'{}'::jsonb,'{}'::jsonb,'{"price":50}'::jsonb,repeat('5',64)
  ) returning id into v_screen_b;

  insert into public.research_candidate_pipeline_runs(
    universe_screen_run_id,pipeline_version,valuation_methodology_version,
    readiness_methodology_version,evaluation_as_of,input_hash,candidate_count,
    decision_ready_count,research_ready_count,building_count,onboarding_count,
    valuation_building_count,metadata
  ) values (
    v_screen_run,
    'research-candidate-pipeline-v2.4',
    'solpient-valuation-methodology-v3',
    'readiness-v1',
    '2026-09-21T23:59:59Z',
    repeat('6',64),
    2,0,0,0,2,0,
    '{}'::jsonb
  ) returning id into v_pipeline_run;

  insert into public.research_candidate_pipeline_items(
    research_candidate_pipeline_run_id,universe_screen_result_id,ticker,
    stage,readiness_state,valuation_preflight_complete,next_actions,
    pipeline_output,item_hash
  ) values (
    v_pipeline_run,v_screen_a,'RFV1A',
    'onboarding','building',false,'[]'::jsonb,
    '{"pipelineVersion":"research-candidate-pipeline-v2.4","stage":"onboarding"}'::jsonb,
    repeat('7',64)
  ) returning id into v_pipeline_a;

  insert into public.research_candidate_pipeline_items(
    research_candidate_pipeline_run_id,universe_screen_result_id,ticker,
    stage,readiness_state,valuation_preflight_complete,next_actions,
    pipeline_output,item_hash
  ) values (
    v_pipeline_run,v_screen_b,'RFV1B',
    'onboarding','building',false,'[]'::jsonb,
    '{"pipelineVersion":"research-candidate-pipeline-v2.4","stage":"onboarding"}'::jsonb,
    repeat('8',64)
  ) returning id into v_pipeline_b;

  v_items:=jsonb_build_array(
    jsonb_build_object(
      'source_pipeline_item_id',v_pipeline_a,
      'source_screen_result_id',v_screen_a,
      'ticker','RFV1A',
      'company_id',null,
      'ordinal',1,
      'stage','onboarding',
      'status','queued',
      'coverage_pct',null,
      'repair_job_count',0,
      'manual_review_count',0,
      'next_actions','[]'::jsonb,
      'state_snapshot','{}'::jsonb,
      'state_hash',repeat('9',64),
      'last_error',null
    ),
    jsonb_build_object(
      'source_pipeline_item_id',v_pipeline_b,
      'source_screen_result_id',v_screen_b,
      'ticker','RFV1B',
      'company_id',null,
      'ordinal',2,
      'stage','onboarding',
      'status','queued',
      'coverage_pct',null,
      'repair_job_count',0,
      'manual_review_count',0,
      'next_actions','[]'::jsonb,
      'state_snapshot','{}'::jsonb,
      'state_hash',repeat('a',64),
      'last_error',null
    )
  );

  select public.create_research_factory_run_v1(
    jsonb_build_object(
      'source_pipeline_run_id',v_pipeline_run,
      'factory_version','research-factory-v1',
      'input_hash',repeat('b',64),
      'candidate_count',2,
      'metadata','{}'::jsonb
    ),
    v_items
  ) into v_factory_run;

  if v_factory_run is null then
    raise exception 'Research Factory run was not created';
  end if;

  if (
    select count(*) from public.research_factory_items
    where research_factory_run_id=v_factory_run
  )<>2 then
    raise exception 'Research Factory item count mismatch';
  end if;

  if (
    select count(*) from public.research_factory_events
    where research_factory_run_id=v_factory_run
      and event_type='factory_item_created'
  )<>2 then
    raise exception 'Research Factory initial events missing';
  end if;

  insert into public.companies(
    ticker,company_name,cik,exchange,sector,industry
  ) values (
    'RFV1A','Factory Fixture A','0000000001','NYSE','Technology','Software'
  ) returning id into v_company;

  select id into v_factory_item
  from public.research_factory_items
  where research_factory_run_id=v_factory_run and ticker='RFV1A';

  perform public.transition_research_factory_item_v1(
    v_factory_item,
    'evidence_ingestion',
    'queued',
    v_company,
    null,
    null,
    null,
    null,
    0,
    0,
    '[{"action":"ingest evidence"}]'::jsonb,
    '{"company_id":"fixture"}'::jsonb,
    repeat('c',64),
    null,
    'identity_resolved'
  );

  if not exists (
    select 1 from public.research_factory_items
    where id=v_factory_item
      and company_id=v_company
      and stage='evidence_ingestion'
  ) then
    raise exception 'Research Factory transition failed';
  end if;

  if not exists (
    select 1 from public.research_factory_events
    where research_factory_item_id=v_factory_item
      and event_type='identity_resolved'
      and from_stage='onboarding'
      and to_stage='evidence_ingestion'
  ) then
    raise exception 'Research Factory transition event missing';
  end if;

  insert into public.research_factory_valuation_drafts(
    research_factory_item_id,company_id,source_screen_result_id,ticker,
    factory_version,industry_module,status,valuation_input,preflight,
    missing_fields,evidence,input_hash
  ) values (
    v_factory_item,v_company,v_screen_a,'RFV1A',
    'research-factory-v1','software_platform','draft',
    '{"currentPrice":100}'::jsonb,
    '{"complete":false}'::jsonb,
    '["assumptions.base.discountRate"]'::jsonb,
    '{"source":"fixture"}'::jsonb,
    repeat('d',64)
  ) returning id into v_valuation_draft;

  v_failed:=false;
  begin
    update public.research_factory_valuation_drafts
    set status='rejected'
    where id=v_valuation_draft;
  exception when others then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'Research Factory valuation draft was mutable';
  end if;

  v_failed:=false;
  begin
    delete from public.research_factory_events
    where research_factory_item_id=v_factory_item;
  exception when others then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'Research Factory events were deletable';
  end if;

  if has_table_privilege('anon','public.research_factory_items','SELECT')
     or has_table_privilege('authenticated','public.research_factory_valuation_drafts','SELECT')
     or has_function_privilege('anon','public.create_research_factory_run_v1(jsonb,jsonb)','EXECUTE') then
    raise exception 'Public roles unexpectedly have Research Factory access';
  end if;
end
$test$;

rollback;
