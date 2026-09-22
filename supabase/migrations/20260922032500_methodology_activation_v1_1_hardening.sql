-- Methodology Validation & Activation V1.1 hardening.
-- Adds immutable implementation fingerprints and an atomic final stack activation RPC.

alter table public.methodology_definitions
  add column if not exists implementation_hash text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname='methodology_definitions_implementation_hash_check'
      and conrelid='public.methodology_definitions'::regclass
  ) then
    alter table public.methodology_definitions
      add constraint methodology_definitions_implementation_hash_check
      check (implementation_hash is null or implementation_hash ~ '^[0-9a-f]{64}$');
  end if;
end
$$;

create or replace function public.activate_universe_methodology_stack_v1_1(
  p_targets jsonb,
  p_validation_hash text,
  p_universe_input_hash text,
  p_activation_version text,
  p_actor text,
  p_commit_sha text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_target jsonb;
  v_definition public.methodology_definitions%rowtype;
  v_state text;
  v_prior record;
  v_activated integer := 0;
  v_superseded integer := 0;
begin
  if jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets)=0 then
    raise exception 'p_targets must be a nonempty JSON array';
  end if;
  if p_validation_hash is null or p_validation_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid validation hash';
  end if;
  if p_universe_input_hash is null or p_universe_input_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid universe input hash';
  end if;
  if coalesce(trim(p_activation_version),'')='' then
    raise exception 'activation version is required';
  end if;
  if coalesce(trim(p_actor),'')='' then
    raise exception 'actor is required';
  end if;
  if p_commit_sha is null or p_commit_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'activation requires an exact 40-character commit SHA';
  end if;

  if (
    select count(*) <> count(distinct x->>'methodology_key')
    from jsonb_array_elements(p_targets) x
  ) then
    raise exception 'activation targets contain duplicate methodology keys';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('solpient-methodology-activation-v1.1',0));

  -- Validate the complete target set before inserting any ACTIVE event.
  for v_target in select value from jsonb_array_elements(p_targets)
  loop
    select *
      into v_definition
    from public.methodology_definitions
    where id=(v_target->>'definition_id')::uuid
      and methodology_key=v_target->>'methodology_key'
      and version=v_target->>'version';

    if not found then
      raise exception 'target methodology definition not found or identity mismatch: %', v_target;
    end if;
    if v_definition.implementation_hash is null then
      raise exception 'target methodology lacks implementation hash: % %',
        v_definition.methodology_key, v_definition.version;
    end if;

    select event_type
      into v_state
    from public.methodology_lifecycle_events
    where methodology_definition_id=v_definition.id
    order by effective_at desc, created_at desc, id desc
    limit 1;

    if v_state not in ('validated','active') then
      raise exception 'target methodology must be VALIDATED before atomic activation: % % state=%',
        v_definition.methodology_key, v_definition.version, coalesce(v_state,'null');
    end if;

    if not exists (
      select 1 from public.methodology_validation_runs
      where methodology_definition_id=v_definition.id
        and validation_type='unit_tests' and status='pass'
    ) or not exists (
      select 1 from public.methodology_validation_runs
      where methodology_definition_id=v_definition.id
        and validation_type='build' and status='pass'
    ) then
      raise exception 'required unit/build evidence missing for % %',
        v_definition.methodology_key, v_definition.version;
    end if;

    if coalesce((v_definition.impacts->>'database')::boolean,false)
       and not exists (
         select 1 from public.methodology_validation_runs
         where methodology_definition_id=v_definition.id
           and validation_type='db_invariant' and status='pass'
       ) then
      raise exception 'database invariant evidence missing for % %',
        v_definition.methodology_key, v_definition.version;
    end if;

    if (
      coalesce((v_definition.impacts->>'publication')::boolean,false)
      or coalesce((v_definition.impacts->>'historical_interpretation')::boolean,false)
    ) and not exists (
      select 1 from public.methodology_validation_runs
      where methodology_definition_id=v_definition.id
        and validation_type='historical_integrity' and status='pass'
    ) then
      raise exception 'historical integrity evidence missing for % %',
        v_definition.methodology_key, v_definition.version;
    end if;

    if (
      coalesce((v_definition.impacts->>'capital_decision')::boolean,false)
      or v_definition.risk_class='critical'
    ) and not exists (
      select 1 from public.methodology_validation_runs
      where methodology_definition_id=v_definition.id
        and validation_type='manual_review' and status='pass'
    ) then
      raise exception 'manual review evidence missing for % %',
        v_definition.methodology_key, v_definition.version;
    end if;

    if v_definition.category in ('valuation','ranking','prediction','calibration','screening')
       and not exists (
         select 1 from public.methodology_validation_runs
         where methodology_definition_id=v_definition.id
           and validation_type='methodology_regression' and status='pass'
       ) then
      raise exception 'methodology regression evidence missing for % %',
        v_definition.methodology_key, v_definition.version;
    end if;

    if v_state='active' and not exists (
      select 1
      from public.methodology_lifecycle_events
      where methodology_definition_id=v_definition.id
        and event_type='active'
        and metadata->>'validation_hash'=p_validation_hash
        and metadata->>'universe_input_hash'=p_universe_input_hash
      order by effective_at desc, created_at desc, id desc
      limit 1
    ) then
      raise exception 'already-active target was activated from a different validation/input bundle: % %',
        v_definition.methodology_key, v_definition.version;
    end if;
  end loop;

  -- Only after every target is valid do we write ACTIVE events.
  for v_target in select value from jsonb_array_elements(p_targets)
  loop
    select *
      into v_definition
    from public.methodology_definitions
    where id=(v_target->>'definition_id')::uuid;

    select event_type
      into v_state
    from public.methodology_lifecycle_events
    where methodology_definition_id=v_definition.id
    order by effective_at desc, created_at desc, id desc
    limit 1;

    if v_state='validated' then
      insert into public.methodology_lifecycle_events(
        methodology_definition_id,event_type,reason,actor,commit_sha,metadata
      ) values (
        v_definition.id,
        'active',
        'Atomically activated after governed full-universe validation under '||p_activation_version||'.',
        p_actor,
        p_commit_sha,
        jsonb_build_object(
          'activation_version',p_activation_version,
          'validation_hash',p_validation_hash,
          'universe_input_hash',p_universe_input_hash,
          'implementation_hash',v_definition.implementation_hash,
          'atomic_stack_activation',true
        )
      );
      v_activated := v_activated + 1;
    end if;
  end loop;

  -- Supersede older active versions only after the full target stack is active.
  for v_target in select value from jsonb_array_elements(p_targets)
  loop
    for v_prior in
      select d.id,d.methodology_key,d.version
      from public.methodology_definitions d
      where d.methodology_key=v_target->>'methodology_key'
        and d.id<>(v_target->>'definition_id')::uuid
        and (
          select e.event_type
          from public.methodology_lifecycle_events e
          where e.methodology_definition_id=d.id
          order by e.effective_at desc,e.created_at desc,e.id desc
          limit 1
        )='active'
    loop
      insert into public.methodology_lifecycle_events(
        methodology_definition_id,event_type,reason,actor,commit_sha,metadata
      ) values (
        v_prior.id,
        'superseded',
        'Superseded by '||(v_target->>'version')||
          ' after atomic governed full-universe validation.',
        p_actor,
        p_commit_sha,
        jsonb_build_object(
          'successor_version',v_target->>'version',
          'activation_version',p_activation_version,
          'validation_hash',p_validation_hash,
          'universe_input_hash',p_universe_input_hash,
          'atomic_stack_activation',true
        )
      );
      v_superseded := v_superseded + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'activated',true,
    'activated_count',v_activated,
    'superseded_count',v_superseded,
    'validation_hash',p_validation_hash,
    'universe_input_hash',p_universe_input_hash,
    'activation_version',p_activation_version
  );
end
$$;

revoke all on function public.activate_universe_methodology_stack_v1_1(
  jsonb,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.activate_universe_methodology_stack_v1_1(
  jsonb,text,text,text,text,text
) to service_role;

comment on function public.activate_universe_methodology_stack_v1_1(
  jsonb,text,text,text,text,text
) is
  'Atomically promotes an already-validated methodology stack to ACTIVE and supersedes prior active versions. Binds activation to an exact validation hash, universe input hash, implementation hash, and commit SHA.';
