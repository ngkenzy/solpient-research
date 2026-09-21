-- Methodology Registry / Model Governance database invariants.
-- Run after migration. Entire fixture rolls back.

begin;
set local role service_role;

do $test$
declare
  v_def uuid;
  v_event uuid;
  v_validation uuid;
  v_failed boolean;
begin
  insert into public.methodology_definitions(
    methodology_key,version,name,category,risk_class,purpose,owner,
    source_files,input_contract,output_contract,weights,thresholds,assumptions,
    dependencies,known_limitations,change_summary,impacts,legacy_bootstrap,
    registry_version,manifest,manifest_hash
  ) values (
    'fixture','fixture-v1','Fixture Methodology','governance','critical',
    'Fixture methodology used to verify immutable governance behavior.',
    'Solpient',
    '["lib/fixture.mjs"]'::jsonb,
    '{"input":"fixture"}'::jsonb,
    '{"output":"fixture"}'::jsonb,
    '{"a":50,"b":50}'::jsonb,
    '{"threshold":70}'::jsonb,
    '{"assumption":"fixture"}'::jsonb,
    '[]'::jsonb,
    '["fixture limitation"]'::jsonb,
    'Initial fixture version.',
    '{"database":true,"capital_decision":true}'::jsonb,
    false,
    'methodology-registry-v1',
    '{"methodology_key":"fixture","version":"fixture-v1"}'::jsonb,
    repeat('a',64)
  ) returning id into v_def;

  insert into public.methodology_lifecycle_events(
    methodology_definition_id,event_type,reason,actor
  ) values (
    v_def,'registered','Fixture registration.','fixture'
  ) returning id into v_event;

  insert into public.methodology_validation_runs(
    methodology_definition_id,validation_type,status,validator,evidence_ref
  ) values (
    v_def,'unit_tests','pass','fixture','ci://fixture'
  ) returning id into v_validation;

  v_failed:=false;
  begin
    update public.methodology_definitions set name='Changed' where id=v_def;
  exception when others then v_failed:=true; end;
  if not v_failed then raise exception 'Methodology definition was mutable.'; end if;

  v_failed:=false;
  begin
    delete from public.methodology_lifecycle_events where id=v_event;
  exception when others then v_failed:=true; end;
  if not v_failed then raise exception 'Lifecycle event was deletable.'; end if;

  v_failed:=false;
  begin
    update public.methodology_validation_runs set status='fail' where id=v_validation;
  exception when others then v_failed:=true; end;
  if not v_failed then raise exception 'Validation evidence was mutable.'; end if;

  if has_table_privilege('anon','public.methodology_definitions','SELECT')
     or has_table_privilege('authenticated','public.methodology_validation_runs','SELECT') then
    raise exception 'Public roles unexpectedly have methodology-governance access.';
  end if;

  v_failed:=false;
  begin
    insert into public.methodology_definitions(
      methodology_key,version,name,category,risk_class,purpose,owner,
      change_summary,registry_version,manifest,manifest_hash
    ) values (
      'fixture','fixture-v1','Duplicate','governance','low',
      'Duplicate fixture methodology definition should be rejected.',
      'Solpient','duplicate','methodology-registry-v1','{}'::jsonb,repeat('b',64)
    );
  exception when unique_violation then v_failed:=true; end;
  if not v_failed then raise exception 'Duplicate methodology identity was accepted.'; end if;

  v_failed:=false;
  begin
    insert into public.methodology_lifecycle_events(
      methodology_definition_id,event_type,reason
    ) values (v_def,'mystery_state','invalid state');
  exception when check_violation then v_failed:=true; end;
  if not v_failed then raise exception 'Invalid lifecycle event was accepted.'; end if;
end
$test$;

rollback;
