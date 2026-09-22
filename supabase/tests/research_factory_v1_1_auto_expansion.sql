-- Research Factory V1.1 automatic expansion invariants.
begin;
set local role service_role;

do $test$
declare
  v_screen_run uuid;
  v_screen_ids uuid[] := array[]::uuid[];
  v_pipeline_run uuid;
  v_pipeline_ids uuid[] := array[]::uuid[];
  v_factory_run uuid;
  v_factory_items uuid[] := array[]::uuid[];
  v_claim jsonb;
  v_batch uuid;
  v_second_claim jsonb;
  v_second_batch uuid;
  v_done jsonb;
  v_item uuid;
  i integer;
begin
  insert into public.universe_screen_runs(
    as_of_at,methodology_version,selection_version,provider,input_hash,
    input_count,result_count,research_candidate_count,
    solpient_100_candidate_count,proposed_deep_research_count,metadata
  ) values (
    '2026-09-21T23:59:59Z',
    'solpient-universe-screen-v2.3',
    'fixture-selection-v1',
    'research-factory-v1.1-fixture',
    repeat('1',64),
    5,5,5,5,5,
    jsonb_build_object(
      'validation_hash',repeat('2',64),
      'universe_input_hash',repeat('3',64)
    )
  ) returning id into v_screen_run;

  for i in 1..5 loop
    insert into public.universe_screen_results(
      universe_screen_run_id,ticker,company_name,sector,industry,screen_profile,
      screen_state,universe_rank,shortlist_rank,proposed_for_deep_research,
      screen_score,quality_core_score,evidence_coverage_pct,
      gates,reasons,score_detail,input_summary,result_hash
    ) values (
      v_screen_run,'V11'||i,'Factory V1.1 Fixture '||i,
      'Information Technology','Software','software',
      'research_candidate',i,i,true,80,80,80,
      '[]'::jsonb,'{}'::jsonb,'{}'::jsonb,
      '{"price":100}'::jsonb,
      substr(repeat((i+3)::text,64),1,64)
    ) returning id into v_item;
    v_screen_ids:=array_append(v_screen_ids,v_item);
  end loop;

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
    repeat('9',64),
    5,0,0,0,5,0,'{}'::jsonb
  ) returning id into v_pipeline_run;

  for i in 1..5 loop
    insert into public.research_candidate_pipeline_items(
      research_candidate_pipeline_run_id,universe_screen_result_id,ticker,
      stage,readiness_state,valuation_preflight_complete,next_actions,
      pipeline_output,item_hash
    ) values (
      v_pipeline_run,v_screen_ids[i],'V11'||i,
      'onboarding','building',false,'[]'::jsonb,
      '{"pipelineVersion":"research-candidate-pipeline-v2.4","stage":"onboarding"}'::jsonb,
      substr(repeat((i+4)::text,64),1,64)
    ) returning id into v_item;
    v_pipeline_ids:=array_append(v_pipeline_ids,v_item);
  end loop;

  select public.create_research_factory_run_v1(
    jsonb_build_object(
      'source_pipeline_run_id',v_pipeline_run,
      'factory_version','research-factory-v1',
      'input_hash',repeat('a',64),
      'candidate_count',5,
      'metadata','{}'::jsonb
    ),
    jsonb_build_array(
      jsonb_build_object(
        'source_pipeline_item_id',v_pipeline_ids[1],
        'source_screen_result_id',v_screen_ids[1],
        'ticker','V111','ordinal',1,'stage','evidence_ingestion','status','queued',
        'repair_job_count',0,'manual_review_count',0,'next_actions','[]'::jsonb,
        'state_snapshot','{}'::jsonb,'state_hash',repeat('b',64)
      ),
      jsonb_build_object(
        'source_pipeline_item_id',v_pipeline_ids[2],
        'source_screen_result_id',v_screen_ids[2],
        'ticker','V112','ordinal',2,'stage','baseline_draft','status','queued',
        'repair_job_count',0,'manual_review_count',0,'next_actions','[]'::jsonb,
        'state_snapshot','{}'::jsonb,'state_hash',repeat('c',64)
      ),
      jsonb_build_object(
        'source_pipeline_item_id',v_pipeline_ids[3],
        'source_screen_result_id',v_screen_ids[3],
        'ticker','V113','ordinal',3,'stage','research_draft','status','queued',
        'repair_job_count',0,'manual_review_count',0,'next_actions','[]'::jsonb,
        'state_snapshot','{}'::jsonb,'state_hash',repeat('d',64)
      ),
      jsonb_build_object(
        'source_pipeline_item_id',v_pipeline_ids[4],
        'source_screen_result_id',v_screen_ids[4],
        'ticker','V114','ordinal',4,'stage','valuation_review','status','needs_review',
        'repair_job_count',0,'manual_review_count',0,
        'next_actions','[{"type":"valuation_review","action":"review"}]'::jsonb,
        'state_snapshot','{}'::jsonb,'state_hash',repeat('e',64)
      ),
      jsonb_build_object(
        'source_pipeline_item_id',v_pipeline_ids[5],
        'source_screen_result_id',v_screen_ids[5],
        'ticker','V115','ordinal',5,'stage','baseline_draft','status','needs_review',
        'repair_job_count',1,'manual_review_count',1,
        'next_actions','[{"type":"repair_review","action":"review"}]'::jsonb,
        'state_snapshot','{}'::jsonb,'state_hash',repeat('f',64)
      )
    )
  ) into v_factory_run;

  select public.claim_research_factory_batch_v1_1(
    v_factory_run,2,null,'research-factory-v1.1'
  ) into v_claim;

  if (v_claim->>'selected_count')::integer<>2 then
    raise exception 'expected first claim to select 2 items: %',v_claim;
  end if;
  if v_claim->'items'->0->>'ticker'<>'V111'
     or v_claim->'items'->1->>'ticker'<>'V112' then
    raise exception 'claim did not preserve ranked safe order: %',v_claim;
  end if;

  v_batch:=(v_claim->>'batch_id')::uuid;

  if (
    select count(*) from public.research_factory_items
    where worker_batch_id=v_batch and status='running'
  )<>2 then
    raise exception 'claimed items were not marked running';
  end if;

  select public.claim_research_factory_batch_v1_1(
    v_factory_run,2,null,'research-factory-v1.1'
  ) into v_second_claim;

  if (v_second_claim->>'selected_count')::integer<>1
     or v_second_claim->'items'->0->>'ticker'<>'V113' then
    raise exception 'second claim should select only remaining safe item: %',v_second_claim;
  end if;
  v_second_batch:=(v_second_claim->>'batch_id')::uuid;

  for v_item in
    select id from public.research_factory_items
    where worker_batch_id in (v_batch,v_second_batch)
  loop
    perform public.transition_research_factory_item_v1(
      v_item,
      'valuation_review',
      'needs_review',
      null,null,null,null,80,0,0,
      '[{"type":"valuation_review","action":"review assumptions"}]'::jsonb,
      '{"fixture":"review-gate"}'::jsonb,
      repeat('1',64),
      null,
      'fixture_reached_review_gate'
    );
  end loop;

  select public.complete_research_factory_batch_v1_1(
    v_batch,
    '{"failed_tickers":0}'::jsonb
  ) into v_done;

  if (v_done->>'safe_queue_count_after')::integer<>0 then
    raise exception 'safe queue should be drained in fixture: %',v_done;
  end if;
  if (v_done->>'review_gate_count_after')::integer<>5 then
    raise exception 'all fixture items should be at review gates: %',v_done;
  end if;
  if coalesce((v_done->>'factory_completed')::boolean,false) is not true then
    raise exception 'factory run should be complete after all 5 hit review gates: %',v_done;
  end if;

  if (select status from public.research_factory_runs where id=v_factory_run)<>'completed' then
    raise exception 'factory run status was not completed';
  end if;

  if has_table_privilege('anon','public.research_factory_worker_runs','SELECT')
     or has_table_privilege('authenticated','public.research_factory_worker_runs','SELECT')
     or has_function_privilege(
       'anon',
       'public.claim_research_factory_batch_v1_1(uuid,integer,text,text)',
       'EXECUTE'
     ) then
    raise exception 'public roles unexpectedly have V1.1 worker access';
  end if;
end
$test$;

rollback;
