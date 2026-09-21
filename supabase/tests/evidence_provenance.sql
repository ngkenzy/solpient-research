-- Phase 2 canonical evidence/provenance integration test.
-- Run against a Phase 1 + Phase 2 migrated database. The fixture rolls back.

begin;
set local role service_role;

do $test$
declare
  v_company uuid;
  v_context uuid;
  v_fundamental uuid;
  v_obs_a uuid;
  v_obs_b uuid;
  v_fact_a uuid;
  v_fact_b uuid;
  v_fcf_obs uuid;
  v_fcf_fact uuid;
  v_margin_fact uuid;
  v_conflict_source uuid;
  v_conflict_obs uuid;
  v_conflict_fact uuid;
  v_draft uuid;
  v_review uuid;
  v_composition uuid;
  v_run uuid;
  v_bad_draft uuid;
  v_bad_review uuid;
  v_bad_composition uuid;
  v_result jsonb;
  v_package jsonb;
  v_integrity jsonb;
  v_failed boolean;
  v_t0 timestamptz := '2026-02-19T12:00:00Z';
  v_cutoff timestamptz := '2026-02-20T12:00:00Z';
  v_amend_known timestamptz;
begin
  insert into public.companies(ticker,company_name)
  values ('ZP' || substr(replace(gen_random_uuid()::text,'-',''),1,6),'Phase 2 Provenance Test')
  returning id into v_company;

  insert into public.research_context_packs(
    company_id,context_version,as_of_date,generated_at,knowledge_cutoff_at,
    input_hash,provenance_status,industry_module
  ) values (
    v_company,'phase2-test','2026-02-20',v_t0 + interval '1 hour',v_t0 + interval '1 hour',
    repeat('a',64),'complete','universal'
  ) returning id into v_context;

  -- Original filing value A. The projection trigger must append source + observation.
  insert into public.fundamental_snapshots(
    company_id,observed_at,period_end,fiscal_year,fiscal_period,form,filed_at,
    revenue,free_cash_flow,source_url,raw_payload,provider
  ) values (
    v_company,v_t0,'2025-12-31',2025,'FY','10-K','2026-02-19',
    100,20,'https://www.sec.gov/Archives/test-a','{}'::jsonb,'sec_companyfacts'
  ) returning id into v_fundamental;

  select eo.id into v_obs_a
  from public.evidence_observations eo
  join public.evidence_sources es on es.id=eo.source_id
  where eo.company_id=v_company
    and eo.metric_key='revenue'
    and eo.raw_value_numeric=100
    and es.source_quality_class='primary_regulatory'
  order by eo.known_at desc limit 1;

  if v_obs_a is null then
    raise exception 'Original filing observation A was not captured.';
  end if;

  insert into public.normalized_facts(
    company_id,fact_key,module,metric_key,value_numeric,unit,economic_period_end,
    economic_period_type,known_at,normalization_methodology_version,selected_observation_id,
    source_confidence_class,conflict_state,selection_reason,confidence_metadata
  ) values (
    v_company,'fact-a-'||gen_random_uuid()::text,'universal','revenue',100,'USD','2025-12-31',
    'fy',v_t0,'canonical-fact-v1',v_obs_a,'primary_regulatory','verified',
    'Original filed value selected.',
    '{"supporting_observation_count":1,"independent_provider_count":1,"material_conflict":false}'::jsonb
  ) returning id into v_fact_a;

  insert into public.normalized_fact_observations(normalized_fact_id,observation_id,observation_role)
  values (v_fact_a,v_obs_a,'selected');

  -- Stage the exact fact used by research before invoking the unchanged Phase 1 RPC.
  insert into public.baseline_drafts(
    company_id,generation_version,source_cutoff_at,status,evidence_completeness_pct,
    standard_valid,standard_status,draft_payload,evidence_summary
  ) values (
    v_company,'phase2-test',v_cutoff,'ready_for_review',100,true,'complete','{}'::jsonb,'{}'::jsonb
  ) returning id into v_draft;

  insert into public.baseline_reviews(
    draft_id,status,review_payload,validation_result,promotion_readiness,reviewed_at
  ) values (
    v_draft,'ready','{}'::jsonb,'{}'::jsonb,'{"ready":true}'::jsonb,v_cutoff
  ) returning id into v_review;

  insert into public.research_compositions(
    draft_id,company_id,engine_version,context_pack_id,status,composition_payload,
    validation_result,generated_at,applied_at
  ) values (
    v_draft,v_company,'composer-phase2-test',v_context,'applied','{"review_patch":{}}'::jsonb,
    '{}'::jsonb,v_cutoff,v_cutoff
  ) returning id into v_composition;

  insert into public.research_input_manifest_staging(
    draft_id,composition_id,company_id,context_pack_id,cutoff_at,manifest_version,
    manifest_hash,provenance_status,items,confidence_summary
  ) values (
    v_draft,v_composition,v_company,v_context,v_cutoff,'evidence-provenance-v1',
    repeat('b',64),'complete',
    jsonb_build_array(jsonb_build_object(
      'normalized_fact_id',v_fact_a,'input_role','research_metric','module','universal',
      'metric_key','revenue','value_numeric',100,'unit','USD',
      'economic_period_end','2025-12-31','economic_period_type','fy',
      'known_at',v_t0,'basis','reported','source_confidence_class','primary_regulatory',
      'conflict_state','verified','provenance_status','complete',
      'source_lineage',jsonb_build_array(jsonb_build_object('observation_id',v_obs_a)),
      'lineage_metadata',jsonb_build_object(),'input_hash',repeat('1',64)
    )),
    '{"material_conflicts":0,"provisional_facts":0,"explicit_assumptions":0,"fact_backed_inputs":1,"total_inputs":1,"provenance_complete_pct":100}'::jsonb
  );

  v_package:=jsonb_build_object(
    'ticker','ZPTEST','company_name','Phase 2 Provenance Test',
    'research',jsonb_build_object(
      'standard_version','solpient-v2','price_at_research',10,'market_cap',1000,
      'source_period','FY2025','summary','Phase 2 test research',
      'data_cutoff_at',v_cutoff,'benchmark_ticker','SPY'
    ),
    'financial_metrics',jsonb_build_object('revenue',100,'free_cash_flow',20),
    'scores',jsonb_build_object('overall_score',80,'quality_score',80),
    'valuations',jsonb_build_object('base_value',12,'bear_value',8,'bull_value',16),
    'business_assessment',jsonb_build_object(
      'business_quality_rating','strong','moat_rating','narrow','evidence',jsonb_build_array()
    ),
    'metric_observations',jsonb_build_array(jsonb_build_object(
      'module','universal','metric_key','revenue','label','Revenue','value_numeric',100,
      'unit','USD','period_end','2025-12-31','period_type','fy','basis','reported','status','available'
    )),
    'risk_register',jsonb_build_array(jsonb_build_object(
      'risk_key','r1','category','investment','title','Risk','probability','medium',
      'severity','high','thesis_breaker','Breaker','source_urls',jsonb_build_array()
    )),
    'expected_return_scenarios',jsonb_build_array(jsonb_build_object(
      'scenario','base','horizon_years',5,'expected_cagr',8,'methodology','phase2 test',
      'assumptions',jsonb_build_object()
    )),
    'thesis_variables',jsonb_build_array(jsonb_build_object(
      'variable_name','Revenue durability','status','monitor','breaker_condition','Revenue breaks'
    )),
    'sources',jsonb_build_array(jsonb_build_object(
      'source_type','10-K','title','Original filing','url','https://www.sec.gov/Archives/test-a',
      'filing_date','2026-02-19','retrieved_at',v_t0
    )),
    'investment_thesis',jsonb_build_object('what_must_be_true','Revenue remains durable'),
    'financial_quality',jsonb_build_object('history_years',5),
    'fundamental_scorecard',jsonb_build_array(),
    'competitive_position',jsonb_build_object('peers',jsonb_build_array()),
    'valuation_analysis',jsonb_build_object('assumptions',jsonb_build_object('discount_rate',10)),
    'historical_valuation',jsonb_build_object(),
    'investment_lenses',jsonb_build_object(),
    'decision_dashboard',jsonb_build_object(),
    'final_conclusion',jsonb_build_object()
  );

  v_integrity:=jsonb_build_object(
    'integrity_version','historical-integrity-v1',
    'publication_engine_version','reviewed-v2-publisher-phase2-test',
    'methodology_version','solpient-v2:composer-phase2-test',
    'canonicalization_version','solpient-canonical-json-v1',
    'evidence_hash',repeat('c',64),'normalized_inputs_hash',repeat('d',64),
    'valuation_inputs_hash',repeat('e',64),'composition_hash',repeat('f',64),
    'published_output_hash',repeat('0',64),'standard_status','complete',
    'completeness_pct',100,'validation_notes',jsonb_build_array(),
    'validation_result',jsonb_build_object(),'promotion_readiness',jsonb_build_object('ready',true)
  );

  select public.publish_reviewed_research_v2(
    v_draft,v_review,v_composition,null,v_package,v_integrity,'[]'::jsonb
  ) into v_result;
  v_run:=(v_result->>'id')::uuid;

  if not exists (
    select 1 from public.research_runs
    where id=v_run and source_context_pack_id=v_context
      and provenance_version='evidence-provenance-v1'
      and input_manifest_hash=repeat('b',64)
  ) then
    raise exception 'Published research did not freeze Phase 2 context/provenance metadata.';
  end if;

  if not exists (
    select 1
    from public.research_input_manifests rim
    join public.research_input_manifest_items rimi on rimi.manifest_id=rim.id
    where rim.research_run_id=v_run and rimi.normalized_fact_id=v_fact_a
  ) then
    raise exception 'Published input manifest did not freeze fact A.';
  end if;

  v_failed:=false;
  begin
    update public.research_context_packs set summary='{"rewrite":true}'::jsonb where id=v_context;
  exception when others then v_failed:=true;
  end;
  if not v_failed then raise exception 'Published context pack remained mutable.'; end if;

  -- Later amended filing reports B. Projection trigger must preserve A and append B.
  update public.fundamental_snapshots
  set revenue=112,filed_at='2026-03-02',source_url='https://www.sec.gov/Archives/test-b',
      raw_payload='{"amended":true}'::jsonb,observed_at=clock_timestamp()
  where id=v_fundamental;

  select eo.id,eo.known_at into v_obs_b,v_amend_known
  from public.evidence_observations eo
  where eo.company_id=v_company and eo.metric_key='revenue' and eo.raw_value_numeric=112
  order by eo.known_at desc limit 1;

  if v_obs_b is null then raise exception 'Amended filing observation B was not captured.'; end if;
  if not exists (
    select 1 from public.evidence_observations
    where id=v_obs_a and raw_value_numeric=100
  ) then raise exception 'Original observation A was lost after amendment.'; end if;

  insert into public.normalized_facts(
    company_id,fact_key,module,metric_key,value_numeric,unit,economic_period_end,
    economic_period_type,known_at,normalization_methodology_version,selected_observation_id,
    source_confidence_class,conflict_state,selection_reason,confidence_metadata,
    supersedes_fact_id,supersession_reason
  ) values (
    v_company,'fact-b-'||gen_random_uuid()::text,'universal','revenue',112,'USD','2025-12-31',
    'fy',v_amend_known,'canonical-fact-v1',v_obs_b,'primary_regulatory','verified',
    'Amended filing supersedes original filing.',
    '{"supporting_observation_count":1,"independent_provider_count":1,"material_conflict":false,"superseded_observation_count":1}'::jsonb,
    v_fact_a,'Amended regulatory filing became known later.'
  ) returning id into v_fact_b;

  insert into public.normalized_fact_observations(normalized_fact_id,observation_id,observation_role)
  values (v_fact_b,v_obs_b,'selected'),(v_fact_b,v_obs_a,'superseded');

  if (select value_numeric from public.normalized_facts
      where company_id=v_company and metric_key='revenue' and known_at<=v_cutoff
      order by known_at desc limit 1) <> 100 then
    raise exception 'Historical as-of lookup leaked amended value B.';
  end if;

  if (select value_numeric from public.normalized_facts
      where company_id=v_company and metric_key='revenue'
      order by known_at desc limit 1) <> 112 then
    raise exception 'Current as-of lookup did not use amended value B.';
  end if;

  if not exists (
    select 1
    from public.research_input_manifests rim
    join public.research_input_manifest_items rimi on rimi.manifest_id=rim.id
    where rim.research_run_id=v_run
      and rimi.normalized_fact_id=v_fact_a
      and rimi.value_numeric=100
  ) then raise exception 'Historical manifest changed after amended filing.'; end if;

  if not exists (
    select 1 from public.normalized_facts
    where id=v_fact_b and supersedes_fact_id=v_fact_a
  ) then raise exception 'Fact B did not preserve supersession lineage to fact A.'; end if;

  -- Independent provider disagrees materially. Both observations remain and conflict is explicit.
  insert into public.evidence_sources(
    company_id,source_key,provider,source_type,title,retrieved_at,source_quality_class,visibility
  ) values (
    v_company,'conflict-source-'||gen_random_uuid()::text,'fmp','Structured provider',
    'Conflicting provider observation',clock_timestamp(),'structured_provider','internal'
  ) returning id into v_conflict_source;

  insert into public.evidence_observations(
    source_id,company_id,observation_key,module,metric_key,raw_value_numeric,unit,
    economic_period_end,economic_period_type,observation_at,known_at,provider,basis,visibility
  ) values (
    v_conflict_source,v_company,'conflict-observation-'||gen_random_uuid()::text,
    'universal','revenue',130,'USD','2025-12-31','fy',clock_timestamp(),clock_timestamp(),
    'fmp','reported','internal'
  ) returning id into v_conflict_obs;

  insert into public.normalized_facts(
    company_id,fact_key,module,metric_key,value_numeric,unit,economic_period_end,
    economic_period_type,known_at,normalization_methodology_version,selected_observation_id,
    source_confidence_class,conflict_state,selection_reason,confidence_metadata,
    supersedes_fact_id,supersession_reason
  ) values (
    v_company,'fact-conflict-'||gen_random_uuid()::text,'universal','revenue',112,'USD','2025-12-31',
    'fy',clock_timestamp(),'canonical-fact-v1',v_obs_b,'primary_regulatory','conflicting',
    'SEC selected by source authority; independent provider materially disagrees.',
    '{"material_conflict":true,"independent_provider_count":2,"conflicting_observation_count":1}'::jsonb,
    v_fact_b,'Independent provider disagreement became known.'
  ) returning id into v_conflict_fact;

  insert into public.normalized_fact_observations(normalized_fact_id,observation_id,observation_role)
  values (v_conflict_fact,v_obs_b,'selected'),(v_conflict_fact,v_conflict_obs,'conflicting');

  if (select count(*) from public.normalized_fact_observations where normalized_fact_id=v_conflict_fact) <> 2
     or not exists(select 1 from public.normalized_facts where id=v_conflict_fact and conflict_state='conflicting') then
    raise exception 'Provider conflict was not preserved explicitly.';
  end if;

  -- Derived fact lineage preserves exact normalized input fact IDs.
  select eo.id into v_fcf_obs
  from public.evidence_observations eo
  where eo.company_id=v_company and eo.metric_key='free_cash_flow'
  order by eo.known_at desc limit 1;

  insert into public.normalized_facts(
    company_id,fact_key,module,metric_key,value_numeric,unit,economic_period_end,economic_period_type,
    known_at,normalization_methodology_version,selected_observation_id,source_confidence_class,
    conflict_state,selection_reason,confidence_metadata
  )
  select v_company,'fcf-fact-'||gen_random_uuid()::text,'universal','free_cash_flow',20,'USD',
    '2025-12-31','fy',eo.known_at,'canonical-fact-v1',eo.id,'primary_regulatory','verified',
    'Filed FCF selected.','{"material_conflict":false}'::jsonb
  from public.evidence_observations eo where eo.id=v_fcf_obs
  returning id into v_fcf_fact;

  insert into public.normalized_facts(
    company_id,fact_key,module,metric_key,value_numeric,unit,economic_period_end,economic_period_type,
    known_at,normalization_methodology_version,source_confidence_class,conflict_state,
    selection_reason,derivation_basis,formula_identifier,calculation_engine_version,
    calculated_at,confidence_metadata
  ) values (
    v_company,'margin-fact-'||gen_random_uuid()::text,'universal','fcf_margin',
    (20.0/112.0)*100,'percent','2025-12-31','fy',v_amend_known,'canonical-fact-v1',
    'derived_calculation','provisional','Derived from exact revenue and FCF facts.',
    'FCF / revenue.','free_cash_flow_div_revenue_pct_v1','phase2-test-v1',v_amend_known,
    '{"material_conflict":false,"provenance_completeness":true}'::jsonb
  ) returning id into v_margin_fact;

  insert into public.normalized_fact_inputs(normalized_fact_id,input_fact_id,input_role,input_order)
  values (v_margin_fact,v_fcf_fact,'formula_input',0),(v_margin_fact,v_fact_b,'formula_input',1);

  if (select count(*) from public.normalized_fact_inputs where normalized_fact_id=v_margin_fact) <> 2 then
    raise exception 'Derived-metric fact input lineage is incomplete.';
  end if;

  -- Future-data manifest input must fail publication and leave no partial research run.
  insert into public.baseline_drafts(
    company_id,generation_version,source_cutoff_at,status,evidence_completeness_pct,
    standard_valid,standard_status,draft_payload,evidence_summary
  ) values (
    v_company,'phase2-cutoff-failure',v_cutoff,'ready_for_review',100,true,'complete','{}','{}'
  ) returning id into v_bad_draft;

  insert into public.baseline_reviews(
    draft_id,status,review_payload,validation_result,promotion_readiness,reviewed_at
  ) values (
    v_bad_draft,'ready','{}','{}','{"ready":true}',v_cutoff
  ) returning id into v_bad_review;

  insert into public.research_compositions(
    draft_id,company_id,engine_version,context_pack_id,status,composition_payload,
    validation_result,generated_at,applied_at
  ) values (
    v_bad_draft,v_company,'composer-phase2-bad',v_context,'applied','{}','{}',v_cutoff,v_cutoff
  ) returning id into v_bad_composition;

  insert into public.research_input_manifest_staging(
    draft_id,composition_id,company_id,context_pack_id,cutoff_at,manifest_version,
    manifest_hash,provenance_status,items,confidence_summary
  ) values (
    v_bad_draft,v_bad_composition,v_company,v_context,v_cutoff,'evidence-provenance-v1',
    repeat('9',64),'complete',
    jsonb_build_array(jsonb_build_object(
      'normalized_fact_id',v_fact_b,'metric_key','revenue','module','universal',
      'value_numeric',112,'unit','USD','economic_period_end','2025-12-31',
      'economic_period_type','fy','known_at',v_amend_known,'basis','reported',
      'source_confidence_class','primary_regulatory','conflict_state','verified',
      'provenance_status','complete','source_lineage',jsonb_build_array(),
      'lineage_metadata',jsonb_build_object(),'input_hash',repeat('8',64)
    )),'{}'
  );

  v_failed:=false;
  begin
    perform public.publish_reviewed_research_v2(
      v_bad_draft,v_bad_review,v_bad_composition,v_run,v_package,v_integrity,'[]'::jsonb
    );
  exception when others then v_failed:=true;
  end;
  if not v_failed then raise exception 'Publication accepted a future-known research input.'; end if;
  if exists(select 1 from public.research_runs where source_draft_id=v_bad_draft) then
    raise exception 'Failed cutoff publication left a partial research run.';
  end if;

  -- Security surface: raw canonical observations stay private; frozen manifest is readable.
  if has_table_privilege('anon','public.evidence_observations','SELECT') then
    raise exception 'Anon unexpectedly has SELECT on raw evidence observations.';
  end if;
  if not has_table_privilege('anon','public.research_input_manifests','SELECT') then
    raise exception 'Anon lacks SELECT on approved published manifest read model.';
  end if;
end
$test$;

rollback;
