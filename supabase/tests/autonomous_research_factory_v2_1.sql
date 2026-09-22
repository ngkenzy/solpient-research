-- Autonomous Research Factory V2.1 database invariants.
-- Entire fixture rolls back.

begin;
set local role service_role;

do $test$
declare
  v_screen_run uuid;
  v_screen_result uuid;
  v_pipeline_run uuid;
  v_pipeline_item uuid;
  v_factory_run uuid;
  v_factory_item uuid;
  v_company uuid;
  v_autonomous_run uuid;
  v_assignment uuid;
  v_pack uuid;
  v_failed boolean := false;
  v_valuation_input jsonb;
begin
  insert into public.companies(
    ticker,company_name,cik,exchange,sector,industry
  ) values (
    'ARV21','Autonomous Research Fixture','0000000999','NYSE',
    'Information Technology','Software & IT Services'
  ) returning id into v_company;

  insert into public.universe_screen_runs(
    as_of_at,methodology_version,selection_version,provider,input_hash,
    input_count,result_count,research_candidate_count,
    solpient_100_candidate_count,proposed_deep_research_count,metadata
  ) values (
    '2026-09-21T23:59:59Z',
    'solpient-universe-screen-v2.3',
    'fixture-selection-v1',
    'autonomous-research-factory-v2.1-fixture',
    repeat('1',64),
    1,1,1,1,1,
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
    v_screen_run,'ARV21','Autonomous Research Fixture',
    'Information Technology','Software & IT Services','software',
    'solpient_100_candidate',1,1,true,
    90,90,90,'[]'::jsonb,'{}'::jsonb,
    '{"sector_classification":{"confidence":"high","reviewRequired":false}}'::jsonb,
    '{"price":100}'::jsonb,
    repeat('4',64)
  ) returning id into v_screen_result;

  insert into public.research_candidate_pipeline_runs(
    universe_screen_run_id,pipeline_version,valuation_methodology_version,
    readiness_methodology_version,evaluation_as_of,input_hash,candidate_count,
    decision_ready_count,research_ready_count,building_count,onboarding_count,
    valuation_building_count,metadata
  ) values (
    v_screen_run,'research-candidate-pipeline-v2.4',
    'solpient-valuation-methodology-v3','readiness-v1',
    '2026-09-21T23:59:59Z',repeat('5',64),
    1,0,0,0,0,1,'{}'::jsonb
  ) returning id into v_pipeline_run;

  insert into public.research_candidate_pipeline_items(
    research_candidate_pipeline_run_id,universe_screen_result_id,ticker,
    company_id,stage,readiness_state,valuation_preflight_complete,
    next_actions,pipeline_output,item_hash
  ) values (
    v_pipeline_run,v_screen_result,'ARV21',v_company,
    'valuation_building','building',false,'[]'::jsonb,
    '{"pipelineVersion":"research-candidate-pipeline-v2.4","stage":"valuation_building"}'::jsonb,
    repeat('6',64)
  ) returning id into v_pipeline_item;

  insert into public.research_factory_runs(
    source_pipeline_run_id,factory_version,input_hash,status,candidate_count,metadata
  ) values (
    v_pipeline_run,'research-factory-v1',repeat('7',64),'active',1,'{}'::jsonb
  ) returning id into v_factory_run;

  insert into public.research_factory_items(
    research_factory_run_id,source_pipeline_item_id,source_screen_result_id,
    ticker,company_id,ordinal,stage,status,repair_job_count,manual_review_count,
    next_actions,state_snapshot,state_hash
  ) values (
    v_factory_run,v_pipeline_item,v_screen_result,
    'ARV21',v_company,1,'valuation_review','needs_review',1,1,
    '[{"type":"valuation_review","action":"fixture"}]'::jsonb,
    '{}'::jsonb,repeat('8',64)
  ) returning id into v_factory_item;

  insert into public.research_factory_autonomous_runs(
    research_factory_run_id,automation_version,status,max_items
  ) values (
    v_factory_run,'autonomous-research-factory-v2.1','running',20
  ) returning id into v_autonomous_run;

  insert into public.research_factory_industry_assignments(
    research_factory_item_id,company_id,source_screen_result_id,ticker,
    policy_version,module,proposed_module,status,confidence,method,reason,
    evidence,decision_hash
  ) values (
    v_factory_item,v_company,v_screen_result,'ARV21',
    'industry-assignment-v2.1','software_platform','software_platform',
    'applied',0.95,'profile:software','fixture high-confidence assignment',
    '{"fixture":true}'::jsonb,repeat('9',64)
  ) returning id into v_assignment;

  v_valuation_input := jsonb_build_object(
    'industryModule','software_platform',
    'currentPrice',100,
    'fcfPerShare',6,
    'assumptions',jsonb_build_object(
      'bear',jsonb_build_object(
        'initialGrowth',3,'matureGrowth',2,'discountRate',12,'terminalGrowth',1.5,'projectionYears',5
      ),
      'base',jsonb_build_object(
        'initialGrowth',8,'matureGrowth',4,'discountRate',10,'terminalGrowth',2.5,'projectionYears',5
      ),
      'bull',jsonb_build_object(
        'initialGrowth',12,'matureGrowth',6,'discountRate',9,'terminalGrowth',3,'projectionYears',5
      )
    ),
    'multiples',jsonb_build_object(
      'historical',jsonb_build_object('bear',16,'base',20,'bull',24),
      'peer',jsonb_build_object('bear',17,'base',21,'bull',25)
    ),
    'returnScenarios',jsonb_build_object(
      'bear',jsonb_build_object('startingMetricPerShare',6,'metricGrowthRate',3,'exitMultiple',16),
      'base',jsonb_build_object('startingMetricPerShare',6,'metricGrowthRate',8,'exitMultiple',20),
      'bull',jsonb_build_object('startingMetricPerShare',6,'metricGrowthRate',12,'exitMultiple',24)
    ),
    'evidence',jsonb_build_object(
      'valuationHistoryYears',5,'peerCount',4,'primarySourcePct',100
    )
  );

  insert into public.research_factory_autonomous_decisions(
    autonomous_run_id,research_factory_item_id,ticker,decision_type,
    decision_status,policy_version,confidence,input_hash,decision_hash,
    output,evidence
  ) values (
    v_autonomous_run,v_factory_item,'ARV21','valuation_assumptions',
    'applied','valuation-assumptions-v2.1',0.91,repeat('a',64),repeat('b',64),
    jsonb_build_object('valuation_input',v_valuation_input),
    '{"fixture":"high-confidence"}'::jsonb
  );

  select public.publish_autonomous_valuation_pack_v2_1(
    v_factory_item,
    repeat('b',64),
    'software_platform',
    v_valuation_input,
    repeat('a',64),
    0.91,
    'valuation-assumptions-v2.1'
  ) into v_pack;

  if v_pack is null then
    raise exception 'autonomous valuation pack was not created';
  end if;

  if not exists (
    select 1
    from public.candidate_valuation_input_packs
    where id=v_pack
      and ticker='ARV21'
      and status='reviewed'
      and reviewed_by='autonomous-policy:valuation-assumptions-v2.1'
      and universe_screen_result_id=v_screen_result
      and company_id=v_company
      and valuation_input=v_valuation_input
  ) then
    raise exception 'autonomous valuation pack did not preserve review provenance';
  end if;

  if not exists (
    select 1
    from public.research_factory_autonomous_decisions
    where research_factory_item_id=v_factory_item
      and decision_type='valuation_pack'
      and decision_status='applied'
      and decision_hash=repeat('b',64)
  ) then
    raise exception 'valuation-pack decision ledger entry missing';
  end if;

  -- Low confidence cannot publish, even when payload otherwise looks complete.
  v_failed:=false;
  begin
    perform public.publish_autonomous_valuation_pack_v2_1(
      v_factory_item,
      repeat('b',64),
      'software_platform',
      v_valuation_input,
      repeat('c',64),
      0.70,
      'valuation-assumptions-v2.1'
    );
  exception when others then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'low-confidence autonomous valuation unexpectedly published';
  end if;

  -- A quarantined valuation decision cannot publish.
  insert into public.research_factory_autonomous_decisions(
    autonomous_run_id,research_factory_item_id,ticker,decision_type,
    decision_status,policy_version,confidence,input_hash,decision_hash,
    output,evidence
  ) values (
    v_autonomous_run,v_factory_item,'ARV21','valuation_assumptions',
    'quarantined','valuation-assumptions-v2.1',0.85,repeat('d',64),repeat('e',64),
    jsonb_build_object('valuation_input',v_valuation_input),
    '{"fixture":"quarantined"}'::jsonb
  );

  v_failed:=false;
  begin
    perform public.publish_autonomous_valuation_pack_v2_1(
      v_factory_item,
      repeat('e',64),
      'software_platform',
      v_valuation_input,
      repeat('d',64),
      0.85,
      'valuation-assumptions-v2.1'
    );
  exception when others then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'quarantined autonomous valuation unexpectedly published';
  end if;

  -- Append-only machine decisions and assignments must remain immutable.
  v_failed:=false;
  begin
    update public.research_factory_industry_assignments
    set reason='tampered'
    where id=v_assignment;
  exception when others then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'autonomous industry assignment was mutable';
  end if;

  v_failed:=false;
  begin
    delete from public.research_factory_autonomous_decisions
    where research_factory_item_id=v_factory_item;
  exception when others then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'autonomous decision ledger was deletable';
  end if;

  if has_table_privilege(
       'anon','public.research_factory_autonomous_decisions','SELECT'
     )
     or has_table_privilege(
       'authenticated','public.research_factory_industry_assignments','SELECT'
     )
     or has_function_privilege(
       'anon',
       'public.publish_autonomous_valuation_pack_v2_1(uuid,text,text,jsonb,text,numeric,text)',
       'EXECUTE'
     )
  then
    raise exception 'public roles unexpectedly have Autonomous Factory V2.1 access';
  end if;
end
$test$;

rollback;
