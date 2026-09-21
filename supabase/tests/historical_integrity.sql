-- Historical integrity database integration test.
-- Run against a migrated database with: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/historical_integrity.sql
-- The entire fixture is rolled back.

begin;
set local role service_role;

do $test$
declare
  v_company uuid;
  v_failed_company uuid;
  v_draft uuid;
  v_review uuid;
  v_composition uuid;
  v_run uuid;
  v_version integer;
  v_correction_draft uuid;
  v_correction_review uuid;
  v_correction_composition uuid;
  v_correction_run uuid;
  v_failed_draft uuid;
  v_failed_review uuid;
  v_failed_composition uuid;
  v_prediction uuid;
  v_prediction_outcome uuid;
  v_realized uuid;
  v_realized_correction uuid;
  v_score uuid;
  v_score_v2 uuid;
  v_ranking uuid;
  v_ranking_correction uuid;
  v_result jsonb;
  v_package jsonb;
  v_integrity jsonb;
  v_failed boolean;
  v_now timestamptz := clock_timestamp();
begin
  insert into public.companies(ticker,company_name)
  values ('ZZI' || substr(replace(gen_random_uuid()::text,'-',''),1,5),'Integrity Test Co')
  returning id into v_company;

  insert into public.baseline_drafts(
    company_id,generation_version,source_cutoff_at,status,evidence_completeness_pct,
    standard_valid,standard_status,draft_payload
  ) values (
    v_company,'integrity-test',v_now,'ready_for_review',100,true,'complete','{}'::jsonb
  ) returning id into v_draft;

  insert into public.baseline_reviews(
    draft_id,status,review_payload,validation_result,promotion_readiness,reviewed_at
  ) values (
    v_draft,'ready','{}'::jsonb,'{}'::jsonb,'{"ready":true}'::jsonb,v_now
  ) returning id into v_review;

  insert into public.research_compositions(
    draft_id,company_id,engine_version,status,composition_payload,validation_result,generated_at,applied_at
  ) values (
    v_draft,v_company,'composer-test','applied','{"review_patch":{}}'::jsonb,'{}'::jsonb,v_now,v_now
  ) returning id into v_composition;

  v_package := jsonb_build_object(
    'ticker','ZZITEST',
    'company_name','Integrity Test Co',
    'research',jsonb_build_object(
      'standard_version','solpient-v2','price_at_research',100,'market_cap',1000000,
      'source_period','FY2026','summary','Integrity test research',
      'data_cutoff_at',v_now,'benchmark_ticker','SPY'
    ),
    'financial_metrics',jsonb_build_object('revenue',1000,'free_cash_flow',100),
    'scores',jsonb_build_object('overall_score',80,'quality_score',80),
    'valuations',jsonb_build_object('base_value',120,'bear_value',80,'bull_value',160),
    'business_assessment',jsonb_build_object(
      'business_quality_rating','strong','moat_rating','narrow','evidence',jsonb_build_array()
    ),
    'metric_observations',jsonb_build_array(jsonb_build_object(
      'module','universal','metric_key','revenue_growth_1y','label','Revenue growth',
      'value_numeric',10,'basis','reported','status','available'
    )),
    'risk_register',jsonb_build_array(jsonb_build_object(
      'risk_key','growth','category','investment','title','Growth risk',
      'probability','medium','severity','high','thesis_breaker','Growth breaks',
      'source_urls',jsonb_build_array()
    )),
    'expected_return_scenarios',jsonb_build_array(jsonb_build_object(
      'scenario','base','horizon_years',5,'expected_cagr',8,
      'methodology','integrity test','assumptions',jsonb_build_object()
    )),
    'thesis_variables',jsonb_build_array(jsonb_build_object(
      'variable_name','Growth','status','monitor','breaker_condition','Growth breaks'
    )),
    'sources',jsonb_build_array(jsonb_build_object(
      'source_type','10-K','title','Test filing','url','https://example.com/test',
      'retrieved_at',v_now
    )),
    'investment_thesis',jsonb_build_object('what_must_be_true','Economics remain durable'),
    'financial_quality',jsonb_build_object('history_years',5),
    'fundamental_scorecard',jsonb_build_array(),
    'competitive_position',jsonb_build_object('peers',jsonb_build_array('AAA','BBB')),
    'valuation_analysis',jsonb_build_object('assumptions',jsonb_build_object('discount_rate',10)),
    'historical_valuation',jsonb_build_object(),
    'investment_lenses',jsonb_build_object(),
    'decision_dashboard',jsonb_build_object(),
    'final_conclusion',jsonb_build_object()
  );

  v_integrity := jsonb_build_object(
    'integrity_version','historical-integrity-v1',
    'publication_engine_version','reviewed-v2-publisher-test',
    'methodology_version','solpient-v2:composer-test',
    'canonicalization_version','solpient-canonical-json-v1',
    'evidence_hash',repeat('a',64),
    'normalized_inputs_hash',repeat('b',64),
    'valuation_inputs_hash',repeat('c',64),
    'composition_hash',repeat('d',64),
    'published_output_hash',repeat('e',64),
    'standard_status','complete',
    'completeness_pct',100,
    'validation_notes',jsonb_build_array(),
    'validation_result',jsonb_build_object(),
    'promotion_readiness',jsonb_build_object('ready',true)
  );

  select public.publish_reviewed_research_v2(
    v_draft,v_review,v_composition,null,v_package,v_integrity,'[]'::jsonb
  ) into v_result;
  v_run := (v_result->>'id')::uuid;
  v_version := (v_result->>'version')::integer;

  if v_run is null or v_version <> 1 then
    raise exception 'Successful publication did not return a complete run.';
  end if;
  if not exists(select 1 from public.research_runs where id=v_run and status='published') then
    raise exception 'Published research root missing.';
  end if;
  if not exists(select 1 from public.financial_metrics where research_run_id=v_run)
     or not exists(select 1 from public.scores where research_run_id=v_run)
     or not exists(select 1 from public.valuations where research_run_id=v_run)
     or not exists(select 1 from public.business_assessments where research_run_id=v_run)
     or not exists(select 1 from public.metric_observations where research_run_id=v_run)
     or not exists(select 1 from public.risk_register where research_run_id=v_run)
     or not exists(select 1 from public.expected_return_scenarios where research_run_id=v_run)
     or not exists(select 1 from public.thesis_variables where research_run_id=v_run)
     or not exists(select 1 from public.sources where research_run_id=v_run)
     or not exists(select 1 from public.research_v2_sections where research_run_id=v_run) then
    raise exception 'Atomic publication did not create the full research package.';
  end if;

  v_failed := false;
  begin
    update public.research_runs set summary='rewrite attempt' where id=v_run;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Published research update was not blocked.'; end if;

  v_failed := false;
  begin
    delete from public.research_runs where id=v_run;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Published research delete was not blocked.'; end if;

  -- Correction creates a new immutable research version and preserves the original.
  insert into public.baseline_drafts(
    company_id,generation_version,source_cutoff_at,status,evidence_completeness_pct,
    standard_valid,standard_status,draft_payload
  ) values (
    v_company,'integrity-correction',v_now,'ready_for_review',100,true,'complete','{}'::jsonb
  ) returning id into v_correction_draft;

  insert into public.baseline_reviews(
    draft_id,status,review_payload,validation_result,promotion_readiness,reviewed_at
  ) values (
    v_correction_draft,'ready','{}'::jsonb,'{}'::jsonb,'{"ready":true}'::jsonb,v_now
  ) returning id into v_correction_review;

  insert into public.research_compositions(
    draft_id,company_id,engine_version,status,composition_payload,validation_result,generated_at,applied_at
  ) values (
    v_correction_draft,v_company,'composer-test','applied','{"review_patch":{}}'::jsonb,'{}'::jsonb,v_now,v_now
  ) returning id into v_correction_composition;

  select public.publish_reviewed_research_v2(
    v_correction_draft,v_correction_review,v_correction_composition,v_run,v_package,
    v_integrity || jsonb_build_object(
      'supersedes_id',v_run,'correction_reason','Corrected source mapping',
      'published_output_hash',repeat('f',64)
    ),
    '[]'::jsonb
  ) into v_result;
  v_correction_run := (v_result->>'id')::uuid;

  if not exists(select 1 from public.research_runs where id=v_run) then
    raise exception 'Original research was lost during correction.';
  end if;
  if not exists(select 1 from public.research_runs where id=v_correction_run and supersedes_id=v_run and correction_reason is not null) then
    raise exception 'Research correction lineage was not preserved.';
  end if;

  -- Failed publication must leave no partial published package.
  insert into public.companies(ticker,company_name)
  values ('ZZF' || substr(replace(gen_random_uuid()::text,'-',''),1,5),'Failed Integrity Test Co')
  returning id into v_failed_company;

  insert into public.baseline_drafts(
    company_id,generation_version,source_cutoff_at,status,evidence_completeness_pct,
    standard_valid,standard_status,draft_payload
  ) values (
    v_failed_company,'integrity-failure',v_now,'ready_for_review',100,true,'complete','{}'::jsonb
  ) returning id into v_failed_draft;

  insert into public.baseline_reviews(
    draft_id,status,review_payload,validation_result,promotion_readiness,reviewed_at
  ) values (
    v_failed_draft,'ready','{}'::jsonb,'{}'::jsonb,'{"ready":true}'::jsonb,v_now
  ) returning id into v_failed_review;

  insert into public.research_compositions(
    draft_id,company_id,engine_version,status,composition_payload,validation_result,generated_at,applied_at
  ) values (
    v_failed_draft,v_failed_company,'composer-test','applied','{"review_patch":{}}'::jsonb,'{}'::jsonb,v_now,v_now
  ) returning id into v_failed_composition;

  v_failed := false;
  begin
    perform public.publish_reviewed_research_v2(
      v_failed_draft,v_failed_review,v_failed_composition,null,
      v_package || jsonb_build_object('business_assessment',jsonb_build_object('moat_rating','narrow')),
      v_integrity,'[]'::jsonb
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Invalid publication unexpectedly succeeded.'; end if;
  if exists(select 1 from public.research_runs where source_draft_id=v_failed_draft) then
    raise exception 'Failed publication left a partial research_run.';
  end if;

  -- Predictions lock forecast content atomically with outcomes.
  select public.publish_prediction_package_v1(
    jsonb_build_object(
      'company_id',v_company,'research_run_id',v_correction_run,
      'prediction_key','integrity-'||gen_random_uuid()::text,
      'predicted_at',v_now,'model_version','integrity-test-v1','horizon_months',12,
      'benchmark_ticker','SPY','price_at_prediction',100,'confidence',70,
      'thesis_status','intact','rationale','Integrity test',
      'feature_snapshot',jsonb_build_object(),'source_snapshot',jsonb_build_array()
    ),
    jsonb_build_array(jsonb_build_object(
      'metric_key','revenue','label','Revenue','outcome_type','fundamental',
      'predicted_value',1100,'target_date',(v_now::date + 365),'resolver_status','pending'
    )),
    jsonb_build_object('integrity_hash',repeat('1',64),'integrity_version','historical-integrity-v1')
  ) into v_result;
  v_prediction := (v_result->>'id')::uuid;

  v_failed := false;
  begin
    update public.prediction_snapshots set rationale='rewrite' where id=v_prediction;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Locked prediction update was not blocked.'; end if;

  v_failed := false;
  begin
    delete from public.prediction_snapshots where id=v_prediction;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Locked prediction delete was not blocked.'; end if;

  select id into v_prediction_outcome
  from public.prediction_outcomes
  where prediction_snapshot_id=v_prediction
  limit 1;

  v_failed := false;
  begin
    update public.prediction_outcomes set predicted_value=999 where id=v_prediction_outcome;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Locked forecast value update was not blocked.'; end if;

  -- Resolver metadata remains mutable without changing the original forecast.
  update public.prediction_outcomes
  set resolver_status='manual', resolved_at=v_now, resolution_note='Integrity resolver metadata test'
  where id=v_prediction_outcome;

  insert into public.realized_outcomes(
    prediction_outcome_id,observed_at,actual_value,actual_text,source_note
  ) values (
    v_prediction_outcome,v_now,1090,'Observed','Initial observation'
  ) returning id into v_realized;

  insert into public.realized_outcomes(
    prediction_outcome_id,observed_at,actual_value,actual_text,source_note,
    supersedes_id,correction_reason
  ) values (
    v_prediction_outcome,v_now,1100,'Corrected observed','Corrected source',
    v_realized,'Corrected source mapping'
  ) returning id into v_realized_correction;

  if not exists(select 1 from public.realized_outcomes where id=v_realized)
     or not exists(select 1 from public.realized_outcomes where id=v_realized_correction and supersedes_id=v_realized) then
    raise exception 'Realized-outcome correction did not preserve the original.';
  end if;

  insert into public.prediction_scores(
    prediction_outcome_id,realized_outcome_id,absolute_error,methodology_version,notes
  ) values (
    v_prediction_outcome,v_realized_correction,0,'score-v1','Integrity score'
  ) returning id into v_score;

  v_failed := false;
  begin
    update public.prediction_scores set notes='rewrite attempt' where id=v_score;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Prediction score rewrite was not blocked.'; end if;

  -- Re-scoring under a new methodology appends a second score instead of mutating score-v1.
  insert into public.prediction_scores(
    prediction_outcome_id,realized_outcome_id,absolute_error,methodology_version,notes
  ) values (
    v_prediction_outcome,v_realized_correction,1,'score-v2','Re-scored under a new methodology'
  ) returning id into v_score_v2;

  if v_score_v2 is null
     or (select count(*) from public.prediction_scores
         where prediction_outcome_id=v_prediction_outcome
           and realized_outcome_id=v_realized_correction) <> 2 then
    raise exception 'Methodology-versioned rescoring did not preserve the original score.';
  end if;

  -- Ranking history is append-only and corrections preserve the original row.
  insert into public.ranking_history(
    company_id,research_run_id,ranked_at,rank,overall_score,price,base_fair_value,
    methodology_version,integrity_version,hash_algorithm,canonicalization_version
  ) values (
    v_company,v_correction_run,v_now,1,80,100,120,
    'ranking-test-v1','historical-integrity-v1','sha256','postgres-jsonb-v1'
  ) returning id into v_ranking;

  v_failed := false;
  begin
    update public.ranking_history set rank=2 where id=v_ranking;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Ranking history update was not blocked.'; end if;

  v_failed := false;
  begin
    delete from public.ranking_history where id=v_ranking;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Ranking history delete was not blocked.'; end if;

  insert into public.ranking_history(
    company_id,research_run_id,ranked_at,rank,overall_score,price,base_fair_value,
    methodology_version,integrity_version,hash_algorithm,canonicalization_version,
    supersedes_id,correction_reason
  ) values (
    v_company,v_correction_run,v_now + interval '1 second',2,80,100,120,
    'ranking-test-v1','historical-integrity-v1','sha256','postgres-jsonb-v1',
    v_ranking,'Corrected rank assignment'
  ) returning id into v_ranking_correction;

  if not exists(select 1 from public.ranking_history where id=v_ranking)
     or not exists(select 1 from public.ranking_history where id=v_ranking_correction and supersedes_id=v_ranking) then
    raise exception 'Ranking correction did not preserve original lineage.';
  end if;
end
$test$;

rollback;
