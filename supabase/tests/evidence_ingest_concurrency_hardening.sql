-- Canonical evidence ingestion concurrency/idempotency regression test.
-- Entire fixture rolls back.

begin;
set local role service_role;

do $test$
declare
  v_company uuid;
  v_source_id uuid := '11111111-1111-5111-8111-111111111111';
  v_observation_id uuid := '22222222-2222-5222-8222-222222222222';
  v_fact_id uuid := '33333333-3333-5333-8333-333333333333';
  v_result jsonb;
  v_failed boolean;
  v_source jsonb;
  v_observation jsonb;
  v_fact jsonb;
begin
  insert into public.companies(ticker,company_name)
  values (
    'PC' || substr(replace(gen_random_uuid()::text,'-',''),1,6),
    'Provenance Concurrency Fixture'
  )
  returning id into v_company;

  v_source:=jsonb_build_object(
    'id',v_source_id,
    'company_id',v_company,
    'source_key','concurrency-source-key',
    'provider','fixture',
    'source_type','Fixture source',
    'title','Fixture',
    'retrieved_at','2026-09-22T12:00:00Z',
    'source_quality_class','verified_secondary',
    'visibility','internal',
    'metadata','{}'::jsonb,
    'created_at','2026-09-22T12:00:00Z'
  );

  v_observation:=jsonb_build_object(
    'id',v_observation_id,
    'source_id',v_source_id,
    'company_id',v_company,
    'observation_key','concurrency-observation-key',
    'module','universal',
    'metric_key','revenue',
    'raw_value_numeric',100,
    'unit','USD',
    'economic_period_end','2025-12-31',
    'economic_period_type','fy',
    'observation_at','2026-09-22T12:00:00Z',
    'known_at','2026-09-22T12:00:00Z',
    'provider','fixture',
    'basis','reported',
    'source_locator','{}'::jsonb,
    'raw_payload','{}'::jsonb,
    'visibility','internal',
    'created_at','2026-09-22T12:00:00Z'
  );

  v_fact:=jsonb_build_object(
    'id',v_fact_id,
    'company_id',v_company,
    'fact_key','concurrency-fact-key',
    'module','universal',
    'metric_key','revenue',
    'value_numeric',100,
    'unit','USD',
    'economic_period_end','2025-12-31',
    'economic_period_type','fy',
    'known_at','2026-09-22T12:00:00Z',
    'normalization_methodology_version','canonical-fact-v1',
    'selected_observation_id',v_observation_id,
    'source_confidence_class','verified_secondary',
    'conflict_state','provisional',
    'selection_reason','Concurrency fixture.',
    'confidence_metadata','{}'::jsonb,
    'derivation_metadata','{}'::jsonb,
    'visibility','internal',
    'created_at','2026-09-22T12:00:00Z'
  );

  select public.ingest_evidence_batch_v1(
    jsonb_build_array(v_source),
    jsonb_build_array(v_observation),
    jsonb_build_array(v_fact),
    '[]'::jsonb,
    '[]'::jsonb
  ) into v_result;

  if (v_result->>'sources')::int<>1
     or (v_result->>'observations')::int<>1
     or (v_result->>'facts')::int<>1 then
    raise exception 'First canonical ingest did not insert the fixture identities.';
  end if;

  -- Exact retry must be a no-op rather than a primary-key failure.
  select public.ingest_evidence_batch_v1(
    jsonb_build_array(v_source),
    jsonb_build_array(v_observation),
    jsonb_build_array(v_fact),
    '[]'::jsonb,
    '[]'::jsonb
  ) into v_result;

  if (v_result->>'sources')::int<>0
     or (v_result->>'observations')::int<>0
     or (v_result->>'facts')::int<>0 then
    raise exception 'Exact retry unexpectedly inserted duplicate canonical identities.';
  end if;

  -- Same deterministic UUID with a different key must still fail closed.
  v_failed:=false;
  begin
    perform public.ingest_evidence_batch_v1(
      jsonb_build_array(v_source || jsonb_build_object('source_key','different-source-key')),
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    );
  exception when others then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'Mismatched source UUID/key collision was silently accepted.';
  end if;

  v_failed:=false;
  begin
    perform public.ingest_evidence_batch_v1(
      '[]'::jsonb,
      jsonb_build_array(v_observation || jsonb_build_object('observation_key','different-observation-key')),
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    );
  exception when others then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'Mismatched observation UUID/key collision was silently accepted.';
  end if;

  v_failed:=false;
  begin
    perform public.ingest_evidence_batch_v1(
      '[]'::jsonb,
      '[]'::jsonb,
      jsonb_build_array(v_fact || jsonb_build_object('fact_key','different-fact-key')),
      '[]'::jsonb,
      '[]'::jsonb
    );
  exception when others then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'Mismatched fact UUID/key collision was silently accepted.';
  end if;
end
$test$;

rollback;
