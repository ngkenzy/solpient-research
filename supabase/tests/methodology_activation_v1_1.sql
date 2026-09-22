-- Methodology Activation V1.1 atomicity fixture. Entire test rolls back.
begin;
set local role service_role;

do $test$
declare
  v_old uuid;
  v_new uuid;
  v_result jsonb;
  v_failed boolean := false;
begin
  insert into public.methodology_definitions(
    methodology_key,version,name,category,risk_class,purpose,owner,
    source_files,input_contract,output_contract,weights,thresholds,assumptions,
    dependencies,known_limitations,change_summary,impacts,legacy_bootstrap,
    registry_version,manifest,manifest_hash,implementation_hash
  ) values (
    'fixture_atomic','fixture-atomic-v1','Fixture old','screening','high',
    'Old fixture methodology for atomic activation testing.','Solpient',
    '["lib/fixture-old.mjs"]'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,
    '[]'::jsonb,'["fixture"]'::jsonb,'old fixture',
    '{"database":true,"historical_interpretation":true}'::jsonb,false,
    'methodology-registry-v1','{"methodology_key":"fixture_atomic","version":"fixture-atomic-v1"}'::jsonb,
    repeat('a',64),repeat('b',64)
  ) returning id into v_old;

  insert into public.methodology_lifecycle_events(methodology_definition_id,event_type,reason,actor)
  values (v_old,'registered','fixture','test'),(v_old,'active','fixture active','test');

  insert into public.methodology_definitions(
    methodology_key,version,name,category,risk_class,purpose,owner,
    source_files,input_contract,output_contract,weights,thresholds,assumptions,
    dependencies,known_limitations,change_summary,impacts,legacy_bootstrap,
    registry_version,manifest,manifest_hash,implementation_hash
  ) values (
    'fixture_atomic','fixture-atomic-v2','Fixture new','screening','high',
    'New fixture methodology for atomic activation testing.','Solpient',
    '["lib/fixture-new.mjs"]'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,
    '[]'::jsonb,'["fixture"]'::jsonb,'new fixture',
    '{"database":true,"historical_interpretation":true}'::jsonb,false,
    'methodology-registry-v1','{"methodology_key":"fixture_atomic","version":"fixture-atomic-v2"}'::jsonb,
    repeat('c',64),repeat('d',64)
  ) returning id into v_new;

  insert into public.methodology_lifecycle_events(methodology_definition_id,event_type,reason,actor)
  values
    (v_new,'registered','fixture','test'),
    (v_new,'candidate','fixture','test'),
    (v_new,'validated','fixture','test');

  insert into public.methodology_validation_runs(
    methodology_definition_id,validation_type,status,validator,evidence_ref
  ) values
    (v_new,'unit_tests','pass','test','fixture'),
    (v_new,'build','pass','test','fixture'),
    (v_new,'db_invariant','pass','test','fixture'),
    (v_new,'historical_integrity','pass','test','fixture'),
    (v_new,'methodology_regression','pass','test','fixture');

  select public.activate_universe_methodology_stack_v1_1(
    jsonb_build_array(jsonb_build_object(
      'definition_id',v_new,
      'methodology_key','fixture_atomic',
      'version','fixture-atomic-v2'
    )),
    repeat('e',64),
    repeat('f',64),
    'methodology-validation-activation-v1.1',
    'fixture',
    repeat('1',40)
  ) into v_result;

  if coalesce((v_result->>'activated')::boolean,false) is not true then
    raise exception 'atomic activation did not report success';
  end if;
  if (
    select event_type from public.methodology_lifecycle_events
    where methodology_definition_id=v_new
    order by effective_at desc,created_at desc,id desc limit 1
  ) <> 'active' then
    raise exception 'new methodology did not become active';
  end if;
  if (
    select event_type from public.methodology_lifecycle_events
    where methodology_definition_id=v_old
    order by effective_at desc,created_at desc,id desc limit 1
  ) <> 'superseded' then
    raise exception 'old methodology was not superseded';
  end if;

  -- A new candidate without evidence must fail and must not produce ACTIVE.
  insert into public.methodology_definitions(
    methodology_key,version,name,category,risk_class,purpose,owner,
    source_files,known_limitations,change_summary,impacts,legacy_bootstrap,
    registry_version,manifest,manifest_hash,implementation_hash
  ) values (
    'fixture_atomic_2','fixture-atomic-2-v1','Fixture invalid','screening','high',
    'Invalid fixture methodology used to prove fail-closed activation.','Solpient',
    '["lib/fixture-invalid.mjs"]'::jsonb,'["fixture"]'::jsonb,'invalid fixture',
    '{"database":true}'::jsonb,false,
    'methodology-registry-v1','{"methodology_key":"fixture_atomic_2","version":"fixture-atomic-2-v1"}'::jsonb,
    repeat('2',64),repeat('3',64)
  ) returning id into v_new;
  insert into public.methodology_lifecycle_events(methodology_definition_id,event_type,reason,actor)
  values
    (v_new,'registered','fixture','test'),
    (v_new,'candidate','fixture','test'),
    (v_new,'validated','fixture','test');

  begin
    perform public.activate_universe_methodology_stack_v1_1(
      jsonb_build_array(jsonb_build_object(
        'definition_id',v_new,
        'methodology_key','fixture_atomic_2',
        'version','fixture-atomic-2-v1'
      )),
      repeat('4',64),repeat('5',64),
      'methodology-validation-activation-v1.1','fixture',repeat('6',40)
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'activation accepted missing evidence'; end if;
  if exists (
    select 1 from public.methodology_lifecycle_events
    where methodology_definition_id=v_new and event_type='active'
  ) then
    raise exception 'failed activation wrote ACTIVE event';
  end if;
end
$test$;

rollback;
