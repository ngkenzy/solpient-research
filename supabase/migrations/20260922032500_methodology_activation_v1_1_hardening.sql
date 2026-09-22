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


create or replace function public.publish_universe_screen_package_v1_1(
  p_run jsonb,
  p_results jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_run_id uuid;
  v_existing uuid;
  v_expected_count integer;
begin
  if jsonb_typeof(p_run) <> 'object' then
    raise exception 'p_run must be a JSON object';
  end if;
  if jsonb_typeof(p_results) <> 'array' then
    raise exception 'p_results must be a JSON array';
  end if;

  if coalesce(p_run->>'input_hash','') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid universe screen input hash';
  end if;
  if coalesce(p_run->'metadata'->>'validation_hash','') !~ '^[0-9a-f]{64}$' then
    raise exception 'screen run requires validation_hash metadata';
  end if;
  if coalesce(p_run->'metadata'->>'universe_input_hash','') !~ '^[0-9a-f]{64}$' then
    raise exception 'screen run requires universe_input_hash metadata';
  end if;

  v_expected_count := coalesce((p_run->>'result_count')::integer,-1);
  if v_expected_count < 0 or v_expected_count <> jsonb_array_length(p_results) then
    raise exception 'result_count does not match result payload length';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('solpient-universe-screen-publish-v1.1',0));

  select id into v_existing
  from public.universe_screen_runs
  where input_hash=p_run->>'input_hash';

  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.universe_screen_runs(
    as_of_at,methodology_version,selection_version,provider,input_hash,
    input_count,result_count,excluded_count,watch_count,research_candidate_count,
    solpient_100_candidate_count,proposed_deep_research_count,metadata
  ) values (
    (p_run->>'as_of_at')::timestamptz,
    p_run->>'methodology_version',
    p_run->>'selection_version',
    p_run->>'provider',
    p_run->>'input_hash',
    (p_run->>'input_count')::integer,
    v_expected_count,
    coalesce((p_run->>'excluded_count')::integer,0),
    coalesce((p_run->>'watch_count')::integer,0),
    coalesce((p_run->>'research_candidate_count')::integer,0),
    coalesce((p_run->>'solpient_100_candidate_count')::integer,0),
    coalesce((p_run->>'proposed_deep_research_count')::integer,0),
    coalesce(p_run->'metadata','{}'::jsonb)
  )
  returning id into v_run_id;

  insert into public.universe_screen_results(
    universe_screen_run_id,ticker,company_name,sector,industry,screen_profile,
    screen_state,universe_rank,shortlist_rank,proposed_for_deep_research,
    final_membership_requires_review,screen_score,quality_core_score,
    evidence_coverage_pct,quality_score,durability_score,balance_sheet_score,
    growth_score,valuation_score,gates,reasons,score_detail,input_summary,result_hash
  )
  select
    v_run_id,
    r.ticker,r.company_name,r.sector,r.industry,r.screen_profile,
    r.screen_state,r.universe_rank,r.shortlist_rank,r.proposed_for_deep_research,
    r.final_membership_requires_review,r.screen_score,r.quality_core_score,
    r.evidence_coverage_pct,r.quality_score,r.durability_score,r.balance_sheet_score,
    r.growth_score,r.valuation_score,r.gates,r.reasons,r.score_detail,r.input_summary,r.result_hash
  from jsonb_to_recordset(p_results) as r(
    ticker text,
    company_name text,
    sector text,
    industry text,
    screen_profile text,
    screen_state text,
    universe_rank integer,
    shortlist_rank integer,
    proposed_for_deep_research boolean,
    final_membership_requires_review boolean,
    screen_score numeric,
    quality_core_score numeric,
    evidence_coverage_pct numeric,
    quality_score numeric,
    durability_score numeric,
    balance_sheet_score numeric,
    growth_score numeric,
    valuation_score numeric,
    gates jsonb,
    reasons jsonb,
    score_detail jsonb,
    input_summary jsonb,
    result_hash text
  );

  if (select count(*) from public.universe_screen_results where universe_screen_run_id=v_run_id)
     <> v_expected_count then
    raise exception 'atomic universe screen insert count mismatch';
  end if;

  return v_run_id;
end
$$;

revoke all on function public.publish_universe_screen_package_v1_1(jsonb,jsonb)
from public,anon,authenticated;
grant execute on function public.publish_universe_screen_package_v1_1(jsonb,jsonb)
to service_role;

comment on function public.publish_universe_screen_package_v1_1(jsonb,jsonb) is
  'Atomically publishes one immutable universe screen run and all result rows. Any result failure rolls back the entire package.';
