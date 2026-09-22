-- Research Candidate Pipeline V2.4 integrity hardening.
-- Explicit screen-run binding, deterministic evaluation timestamps, source snapshots,
-- staged transport, and one-transaction immutable publication.

alter table public.research_candidate_pipeline_runs
  add column if not exists evaluation_as_of timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.research_candidate_pipeline_items
  add column if not exists source_snapshot_hash text,
  add column if not exists source_snapshot jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='research_candidate_pipeline_source_snapshot_hash_check'
      and conrelid='public.research_candidate_pipeline_items'::regclass
  ) then
    alter table public.research_candidate_pipeline_items
      add constraint research_candidate_pipeline_source_snapshot_hash_check
      check (
        source_snapshot_hash is null
        or source_snapshot_hash ~ '^[0-9a-f]{64}$'
      );
  end if;
end
$$;

create index if not exists candidate_valuation_input_packs_company_id_idx
  on public.candidate_valuation_input_packs(company_id);
create index if not exists candidate_valuation_input_packs_screen_result_id_idx
  on public.candidate_valuation_input_packs(universe_screen_result_id);
create index if not exists candidate_pipeline_runs_screen_run_id_idx
  on public.research_candidate_pipeline_runs(universe_screen_run_id);
create index if not exists candidate_pipeline_items_screen_result_id_idx
  on public.research_candidate_pipeline_items(universe_screen_result_id);
create index if not exists candidate_pipeline_items_company_id_idx
  on public.research_candidate_pipeline_items(company_id);
create index if not exists candidate_pipeline_items_research_run_id_idx
  on public.research_candidate_pipeline_items(research_run_id);
create index if not exists candidate_pipeline_items_valuation_pack_id_idx
  on public.research_candidate_pipeline_items(valuation_input_pack_id);

create table if not exists public.research_candidate_pipeline_publish_sessions (
  id uuid primary key default gen_random_uuid(),
  input_hash text not null unique,
  run_payload jsonb not null,
  expected_item_count integer not null check (expected_item_count >= 0),
  state text not null default 'staging'
    check (state in ('staging','finalized')),
  finalized_run_id uuid
    references public.research_candidate_pipeline_runs(id) on delete restrict,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  constraint research_candidate_pipeline_publish_session_hash_check
    check (input_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.research_candidate_pipeline_publish_staged_items (
  publish_session_id uuid not null
    references public.research_candidate_pipeline_publish_sessions(id) on delete cascade,
  ordinal integer not null check (ordinal > 0),
  ticker text not null,
  item_hash text not null,
  source_snapshot_hash text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (publish_session_id,ordinal),
  unique (publish_session_id,ticker),
  constraint research_candidate_pipeline_staged_item_hash_check
    check (item_hash ~ '^[0-9a-f]{64}$'),
  constraint research_candidate_pipeline_staged_source_hash_check
    check (source_snapshot_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists research_candidate_pipeline_publish_sessions_state_idx
  on public.research_candidate_pipeline_publish_sessions(state,created_at);

alter table public.research_candidate_pipeline_publish_sessions enable row level security;
alter table public.research_candidate_pipeline_publish_staged_items enable row level security;

revoke all on table
  public.research_candidate_pipeline_publish_sessions,
  public.research_candidate_pipeline_publish_staged_items
from public,anon,authenticated;

grant select,insert,update,delete on table
  public.research_candidate_pipeline_publish_sessions,
  public.research_candidate_pipeline_publish_staged_items
to service_role;

drop policy if exists "service role manages candidate pipeline publish sessions"
  on public.research_candidate_pipeline_publish_sessions;
create policy "service role manages candidate pipeline publish sessions"
on public.research_candidate_pipeline_publish_sessions
for all to service_role
using (true)
with check (true);

drop policy if exists "service role manages candidate pipeline staged items"
  on public.research_candidate_pipeline_publish_staged_items;
create policy "service role manages candidate pipeline staged items"
on public.research_candidate_pipeline_publish_staged_items
for all to service_role
using (true)
with check (true);

create or replace function public.begin_research_candidate_pipeline_publish_v2_4(
  p_run jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_input_hash text;
  v_expected_count integer;
  v_existing public.research_candidate_pipeline_runs%rowtype;
  v_session public.research_candidate_pipeline_publish_sessions%rowtype;
begin
  if jsonb_typeof(p_run) <> 'object' then
    raise exception 'p_run must be a JSON object';
  end if;

  v_input_hash := p_run->>'input_hash';
  v_expected_count := coalesce((p_run->>'candidate_count')::integer,-1);

  if coalesce(v_input_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid candidate pipeline input hash';
  end if;
  if v_expected_count < 0 then
    raise exception 'invalid candidate count';
  end if;
  if p_run->>'pipeline_version' <> 'research-candidate-pipeline-v2.4' then
    raise exception 'V2.4 publisher requires research-candidate-pipeline-v2.4';
  end if;
  if coalesce(p_run->>'evaluation_as_of','')='' then
    raise exception 'evaluation_as_of is required';
  end if;
  if coalesce(p_run->'metadata'->>'universe_screen_input_hash','') !~ '^[0-9a-f]{64}$' then
    raise exception 'universe_screen_input_hash metadata is required';
  end if;
  if coalesce(p_run->'metadata'->>'screen_validation_hash','') !~ '^[0-9a-f]{64}$' then
    raise exception 'screen_validation_hash metadata is required';
  end if;
  if coalesce(p_run->'metadata'->>'universe_input_hash','') !~ '^[0-9a-f]{64}$' then
    raise exception 'universe_input_hash metadata is required';
  end if;
  if coalesce(p_run->'metadata'->>'pipeline_implementation_hash','') !~ '^[0-9a-f]{64}$' then
    raise exception 'pipeline_implementation_hash metadata is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('solpient-research-candidate-pipeline:'||v_input_hash,0)
  );

  select * into v_existing
  from public.research_candidate_pipeline_runs
  where input_hash=v_input_hash;

  if found then
    if v_existing.candidate_count <> (
      select count(*) from public.research_candidate_pipeline_items i
      where i.research_candidate_pipeline_run_id=v_existing.id
    ) or v_existing.candidate_count <> v_expected_count
       or v_existing.universe_screen_run_id <>
          (p_run->>'universe_screen_run_id')::uuid
       or v_existing.pipeline_version <> p_run->>'pipeline_version'
       or v_existing.metadata->>'pipeline_implementation_hash' <>
          p_run->'metadata'->>'pipeline_implementation_hash'
    then
      raise exception 'existing immutable candidate pipeline run is incomplete or mismatched';
    end if;

    return jsonb_build_object(
      'status','already_published',
      'run_id',v_existing.id,
      'publish_session_id',null
    );
  end if;

  select * into v_session
  from public.research_candidate_pipeline_publish_sessions
  where input_hash=v_input_hash;

  if found then
    if v_session.run_payload <> p_run
       or v_session.expected_item_count <> v_expected_count then
      raise exception 'existing candidate pipeline staging session does not match requested run payload';
    end if;

    return jsonb_build_object(
      'status',v_session.state,
      'run_id',v_session.finalized_run_id,
      'publish_session_id',v_session.id,
      'staged_item_count',(
        select count(*)
        from public.research_candidate_pipeline_publish_staged_items s
        where s.publish_session_id=v_session.id
      )
    );
  end if;

  insert into public.research_candidate_pipeline_publish_sessions(
    input_hash,run_payload,expected_item_count
  ) values (
    v_input_hash,p_run,v_expected_count
  )
  returning * into v_session;

  return jsonb_build_object(
    'status','staging',
    'run_id',null,
    'publish_session_id',v_session.id,
    'staged_item_count',0
  );
end
$$;

create or replace function public.stage_research_candidate_pipeline_items_v2_4(
  p_publish_session_id uuid,
  p_start_ordinal integer,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session public.research_candidate_pipeline_publish_sessions%rowtype;
  v_item jsonb;
  v_ordinal integer;
  v_ticker text;
  v_item_hash text;
  v_source_hash text;
  v_existing public.research_candidate_pipeline_publish_staged_items%rowtype;
  v_chunk_count integer;
begin
  if p_start_ordinal is null or p_start_ordinal < 1 then
    raise exception 'p_start_ordinal must be >= 1';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'p_items must be a nonempty JSON array';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'candidate pipeline staging chunk exceeds 50 items';
  end if;

  select * into v_session
  from public.research_candidate_pipeline_publish_sessions
  where id=p_publish_session_id
  for update;

  if not found then raise exception 'candidate pipeline publish session not found'; end if;
  if v_session.state <> 'staging' then
    raise exception 'candidate pipeline publish session is not staging';
  end if;

  v_chunk_count := jsonb_array_length(p_items);
  if p_start_ordinal + v_chunk_count - 1 > v_session.expected_item_count then
    raise exception 'candidate pipeline staging chunk exceeds expected item count';
  end if;

  for v_item,v_ordinal in
    select value,p_start_ordinal + ordinality::integer - 1
    from jsonb_array_elements(p_items) with ordinality
  loop
    v_ticker := upper(trim(coalesce(v_item->>'ticker','')));
    v_item_hash := v_item->>'item_hash';
    v_source_hash := v_item->>'source_snapshot_hash';

    if v_ticker='' then
      raise exception 'staged candidate item missing ticker at ordinal %',v_ordinal;
    end if;
    if coalesce(v_item_hash,'') !~ '^[0-9a-f]{64}$' then
      raise exception 'staged candidate item has invalid item_hash at ordinal %',v_ordinal;
    end if;
    if coalesce(v_source_hash,'') !~ '^[0-9a-f]{64}$' then
      raise exception 'staged candidate item has invalid source_snapshot_hash at ordinal %',v_ordinal;
    end if;
    if v_item->'pipeline_output'->>'pipelineVersion' <> 'research-candidate-pipeline-v2.4' then
      raise exception 'staged candidate item has wrong pipeline version at ordinal %',v_ordinal;
    end if;

    select * into v_existing
    from public.research_candidate_pipeline_publish_staged_items
    where publish_session_id=p_publish_session_id
      and ordinal=v_ordinal;

    if found then
      if v_existing.payload <> v_item
         or v_existing.ticker <> v_ticker
         or v_existing.item_hash <> v_item_hash
         or v_existing.source_snapshot_hash <> v_source_hash then
        raise exception 'non-idempotent candidate item retry at ordinal %',v_ordinal;
      end if;
    else
      insert into public.research_candidate_pipeline_publish_staged_items(
        publish_session_id,ordinal,ticker,item_hash,source_snapshot_hash,payload
      ) values (
        p_publish_session_id,v_ordinal,v_ticker,v_item_hash,v_source_hash,v_item
      );
    end if;
  end loop;

  return jsonb_build_object(
    'publish_session_id',p_publish_session_id,
    'chunk_start_ordinal',p_start_ordinal,
    'chunk_item_count',v_chunk_count,
    'staged_item_count',(
      select count(*)
      from public.research_candidate_pipeline_publish_staged_items
      where publish_session_id=p_publish_session_id
    )
  );
end
$$;

create or replace function public.finalize_research_candidate_pipeline_publish_v2_4(
  p_publish_session_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session public.research_candidate_pipeline_publish_sessions%rowtype;
  v_screen public.universe_screen_runs%rowtype;
  v_definition public.methodology_definitions%rowtype;
  v_active public.methodology_lifecycle_events%rowtype;
  v_existing public.research_candidate_pipeline_runs%rowtype;
  v_run_id uuid;
  v_staged_count integer;
  v_min_ordinal integer;
  v_max_ordinal integer;
begin
  select * into v_session
  from public.research_candidate_pipeline_publish_sessions
  where id=p_publish_session_id
  for update;

  if not found then raise exception 'candidate pipeline publish session not found'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('solpient-research-candidate-pipeline:'||v_session.input_hash,0)
  );

  if v_session.state='finalized' then
    if v_session.finalized_run_id is null then
      raise exception 'finalized candidate pipeline session is missing finalized_run_id';
    end if;
    return v_session.finalized_run_id;
  end if;

  if v_session.run_payload->>'pipeline_version' <> 'research-candidate-pipeline-v2.4' then
    raise exception 'candidate pipeline session is not V2.4';
  end if;

  select * into v_screen
  from public.universe_screen_runs
  where id=(v_session.run_payload->>'universe_screen_run_id')::uuid;

  if not found then raise exception 'selected universe screen run does not exist'; end if;
  if v_screen.methodology_version <> 'solpient-universe-screen-v2.3' then
    raise exception 'V2.4 requires a solpient-universe-screen-v2.3 source run';
  end if;
  if v_screen.input_hash <> v_session.run_payload->'metadata'->>'universe_screen_input_hash'
     or v_screen.metadata->>'validation_hash' <>
        v_session.run_payload->'metadata'->>'screen_validation_hash'
     or v_screen.metadata->>'universe_input_hash' <>
        v_session.run_payload->'metadata'->>'universe_input_hash' then
    raise exception 'candidate pipeline source-screen hashes do not match immutable screen run';
  end if;
  if v_screen.proposed_deep_research_count <> v_session.expected_item_count then
    raise exception
      'candidate count does not match source screen deep-research count: expected %, got %',
      v_screen.proposed_deep_research_count,v_session.expected_item_count;
  end if;

  select * into v_definition
  from public.methodology_definitions
  where methodology_key='research_candidate_pipeline'
    and version='research-candidate-pipeline-v2.4';

  if not found then raise exception 'Research Candidate Pipeline V2.4 is not registered'; end if;
  if v_definition.implementation_hash is null
     or v_definition.implementation_hash <>
        v_session.run_payload->'metadata'->>'pipeline_implementation_hash' then
    raise exception 'candidate pipeline implementation hash mismatch';
  end if;

  select * into v_active
  from public.methodology_lifecycle_events
  where methodology_definition_id=v_definition.id
  order by effective_at desc,created_at desc,id desc
  limit 1;

  if not found or v_active.event_type <> 'active' then
    raise exception 'Research Candidate Pipeline V2.4 is not ACTIVE';
  end if;
  if v_active.metadata->>'implementation_hash' <> v_definition.implementation_hash then
    raise exception 'ACTIVE V2.4 event is not bound to the registered implementation hash';
  end if;

  select count(*),min(ordinal),max(ordinal)
    into v_staged_count,v_min_ordinal,v_max_ordinal
  from public.research_candidate_pipeline_publish_staged_items
  where publish_session_id=p_publish_session_id;

  if v_staged_count <> v_session.expected_item_count
     or (v_session.expected_item_count>0 and v_min_ordinal<>1)
     or (v_session.expected_item_count>0 and v_max_ordinal<>v_session.expected_item_count)
  then
    raise exception
      'candidate pipeline staged set is incomplete: staged=% expected=% min=% max=%',
      v_staged_count,v_session.expected_item_count,v_min_ordinal,v_max_ordinal;
  end if;

  if exists (
    select 1
    from public.research_candidate_pipeline_publish_staged_items s
    left join public.universe_screen_results u
      on u.id=(s.payload->>'universe_screen_result_id')::uuid
    where s.publish_session_id=p_publish_session_id
      and (
        u.id is null
        or u.universe_screen_run_id<>v_screen.id
        or u.proposed_for_deep_research is not true
        or upper(u.ticker)<>s.ticker
      )
  ) then
    raise exception 'staged candidate item is not bound to the selected deep-research shortlist';
  end if;

  select * into v_existing
  from public.research_candidate_pipeline_runs
  where input_hash=v_session.input_hash;

  if found then
    if v_existing.candidate_count <> (
      select count(*) from public.research_candidate_pipeline_items i
      where i.research_candidate_pipeline_run_id=v_existing.id
    ) or v_existing.candidate_count <> v_session.expected_item_count
       or v_existing.universe_screen_run_id<>v_screen.id
       or v_existing.pipeline_version<>'research-candidate-pipeline-v2.4'
       or v_existing.metadata->>'pipeline_implementation_hash'<>
          v_definition.implementation_hash
    then
      raise exception 'existing immutable candidate pipeline run is incomplete or mismatched';
    end if;

    update public.research_candidate_pipeline_publish_sessions
    set state='finalized',finalized_run_id=v_existing.id,finalized_at=now()
    where id=p_publish_session_id;

    delete from public.research_candidate_pipeline_publish_staged_items
    where publish_session_id=p_publish_session_id;

    return v_existing.id;
  end if;

  insert into public.research_candidate_pipeline_runs(
    universe_screen_run_id,pipeline_version,valuation_methodology_version,
    readiness_methodology_version,evaluation_as_of,input_hash,candidate_count,
    decision_ready_count,research_ready_count,building_count,onboarding_count,
    valuation_building_count,metadata
  ) values (
    v_screen.id,
    v_session.run_payload->>'pipeline_version',
    v_session.run_payload->>'valuation_methodology_version',
    v_session.run_payload->>'readiness_methodology_version',
    (v_session.run_payload->>'evaluation_as_of')::timestamptz,
    v_session.input_hash,
    v_session.expected_item_count,
    coalesce((v_session.run_payload->>'decision_ready_count')::integer,0),
    coalesce((v_session.run_payload->>'research_ready_count')::integer,0),
    coalesce((v_session.run_payload->>'building_count')::integer,0),
    coalesce((v_session.run_payload->>'onboarding_count')::integer,0),
    coalesce((v_session.run_payload->>'valuation_building_count')::integer,0),
    coalesce(v_session.run_payload->'metadata','{}'::jsonb) ||
      jsonb_build_object('staged_atomic_publication',true)
  )
  returning id into v_run_id;

  insert into public.research_candidate_pipeline_items(
    research_candidate_pipeline_run_id,universe_screen_result_id,ticker,company_id,
    research_run_id,valuation_input_pack_id,stage,readiness_state,
    valuation_preflight_complete,valuation_base_fair_value,valuation_confidence,
    valuation_confidence_band,base_5y_cagr,decision_score,evidence_confidence,
    source_snapshot_hash,source_snapshot,next_actions,pipeline_output,item_hash
  )
  select
    v_run_id,
    r.universe_screen_result_id,r.ticker,r.company_id,r.research_run_id,
    r.valuation_input_pack_id,r.stage,r.readiness_state,
    r.valuation_preflight_complete,r.valuation_base_fair_value,r.valuation_confidence,
    r.valuation_confidence_band,r.base_5y_cagr,r.decision_score,r.evidence_confidence,
    r.source_snapshot_hash,r.source_snapshot,r.next_actions,r.pipeline_output,r.item_hash
  from public.research_candidate_pipeline_publish_staged_items s
  cross join lateral jsonb_to_record(s.payload) as r(
    universe_screen_result_id uuid,
    ticker text,
    company_id uuid,
    research_run_id uuid,
    valuation_input_pack_id uuid,
    stage text,
    readiness_state text,
    valuation_preflight_complete boolean,
    valuation_base_fair_value numeric,
    valuation_confidence numeric,
    valuation_confidence_band text,
    base_5y_cagr numeric,
    decision_score numeric,
    evidence_confidence numeric,
    source_snapshot_hash text,
    source_snapshot jsonb,
    next_actions jsonb,
    pipeline_output jsonb,
    item_hash text
  )
  where s.publish_session_id=p_publish_session_id
  order by s.ordinal;

  if (
    select count(*)
    from public.research_candidate_pipeline_items
    where research_candidate_pipeline_run_id=v_run_id
  ) <> v_session.expected_item_count then
    raise exception 'atomic candidate pipeline insert count mismatch';
  end if;

  if (
    select count(*) from public.research_candidate_pipeline_items
    where research_candidate_pipeline_run_id=v_run_id and stage='decision_ready'
  ) <> coalesce((v_session.run_payload->>'decision_ready_count')::integer,0)
  or (
    select count(*) from public.research_candidate_pipeline_items
    where research_candidate_pipeline_run_id=v_run_id and stage='research_ready'
  ) <> coalesce((v_session.run_payload->>'research_ready_count')::integer,0)
  or (
    select count(*) from public.research_candidate_pipeline_items
    where research_candidate_pipeline_run_id=v_run_id and stage='research_building'
  ) <> coalesce((v_session.run_payload->>'building_count')::integer,0)
  or (
    select count(*) from public.research_candidate_pipeline_items
    where research_candidate_pipeline_run_id=v_run_id and stage='onboarding'
  ) <> coalesce((v_session.run_payload->>'onboarding_count')::integer,0)
  or (
    select count(*) from public.research_candidate_pipeline_items
    where research_candidate_pipeline_run_id=v_run_id and stage='valuation_building'
  ) <> coalesce((v_session.run_payload->>'valuation_building_count')::integer,0)
  then
    raise exception 'candidate pipeline stage-count summary does not match inserted items';
  end if;

  update public.research_candidate_pipeline_publish_sessions
  set state='finalized',finalized_run_id=v_run_id,finalized_at=now()
  where id=p_publish_session_id;

  delete from public.research_candidate_pipeline_publish_staged_items
  where publish_session_id=p_publish_session_id;

  return v_run_id;
end
$$;

create or replace function public.activate_research_candidate_pipeline_v2_4(
  p_definition_id uuid,
  p_commit_sha text,
  p_implementation_hash text,
  p_validation_bundle_hash text,
  p_actor text default 'research-candidate-pipeline-v2.4-activation'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_definition public.methodology_definitions%rowtype;
  v_state text;
  v_required text;
  v_old record;
begin
  if p_commit_sha is null or p_commit_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'activation requires an exact commit SHA';
  end if;
  if p_implementation_hash is null or p_implementation_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'activation requires implementation hash';
  end if;
  if p_validation_bundle_hash is null or p_validation_bundle_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'activation requires validation bundle hash';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('research-candidate-pipeline-v2.4-activation',0)
  );

  select * into v_definition
  from public.methodology_definitions
  where id=p_definition_id
    and methodology_key='research_candidate_pipeline'
    and version='research-candidate-pipeline-v2.4';

  if not found then raise exception 'V2.4 methodology definition not found'; end if;
  if v_definition.implementation_hash<>p_implementation_hash then
    raise exception 'V2.4 implementation hash mismatch';
  end if;

  select event_type into v_state
  from public.methodology_lifecycle_events
  where methodology_definition_id=v_definition.id
  order by effective_at desc,created_at desc,id desc
  limit 1;

  if v_state='active' then
    if exists (
      select 1 from public.methodology_lifecycle_events
      where methodology_definition_id=v_definition.id
        and event_type='active'
        and commit_sha=p_commit_sha
        and metadata->>'implementation_hash'=p_implementation_hash
        and metadata->>'validation_bundle_hash'=p_validation_bundle_hash
    ) then
      return jsonb_build_object('activated',true,'already_active',true);
    end if;
    raise exception 'V2.4 is already active under a different evidence bundle';
  end if;

  if v_state not in ('candidate','validated') then
    raise exception 'V2.4 must be candidate or validated before activation; state=%',coalesce(v_state,'null');
  end if;

  foreach v_required in array array[
    'unit_tests','build','db_invariant','historical_integrity','manual_review'
  ]
  loop
    if not exists (
      select 1
      from public.methodology_validation_runs
      where methodology_definition_id=v_definition.id
        and validation_type=v_required
        and status='pass'
        and commit_sha=p_commit_sha
        and details->>'implementation_hash'=p_implementation_hash
        and details->>'validation_bundle_hash'=p_validation_bundle_hash
    ) then
      raise exception 'required V2.4 validation evidence missing: %',v_required;
    end if;
  end loop;

  if not exists (
    select 1
    from public.methodology_definitions d
    join lateral (
      select e.event_type
      from public.methodology_lifecycle_events e
      where e.methodology_definition_id=d.id
      order by e.effective_at desc,e.created_at desc,e.id desc
      limit 1
    ) x on true
    where d.methodology_key='universe_screening'
      and d.version='solpient-universe-screen-v2.3'
      and x.event_type='active'
  ) then
    raise exception 'required active dependency missing: universe_screening v2.3';
  end if;

  if not exists (
    select 1
    from public.methodology_definitions d
    join lateral (
      select e.event_type
      from public.methodology_lifecycle_events e
      where e.methodology_definition_id=d.id
      order by e.effective_at desc,e.created_at desc,e.id desc
      limit 1
    ) x on true
    where d.methodology_key='valuation_v3'
      and d.version='solpient-valuation-methodology-v3'
      and x.event_type='active'
  ) then
    raise exception 'required active dependency missing: valuation_v3';
  end if;

  if not exists (
    select 1
    from public.methodology_definitions d
    join lateral (
      select e.event_type
      from public.methodology_lifecycle_events e
      where e.methodology_definition_id=d.id
      order by e.effective_at desc,e.created_at desc,e.id desc
      limit 1
    ) x on true
    where d.methodology_key='decision_readiness'
      and d.version='readiness-v1'
      and x.event_type='active'
  ) then
    raise exception 'required active dependency missing: decision_readiness';
  end if;

  if v_state='candidate' then
    insert into public.methodology_lifecycle_events(
      methodology_definition_id,event_type,reason,actor,commit_sha,metadata,effective_at
    ) values (
      v_definition.id,'validated',
      'V2.4 passed deterministic-time, atomic-publication, database, historical-integrity, build, and manual-review gates.',
      p_actor,p_commit_sha,
      jsonb_build_object(
        'implementation_hash',p_implementation_hash,
        'validation_bundle_hash',p_validation_bundle_hash
      ),
      clock_timestamp()
    );
  end if;

  insert into public.methodology_lifecycle_events(
    methodology_definition_id,event_type,reason,actor,commit_sha,metadata,effective_at
  ) values (
    v_definition.id,'active',
    'Activated Research Candidate Pipeline V2.4 integrity hardening.',
    p_actor,p_commit_sha,
    jsonb_build_object(
      'implementation_hash',p_implementation_hash,
      'validation_bundle_hash',p_validation_bundle_hash,
      'activation_version','research-candidate-pipeline-v2.4-activation-v1',
      'atomic_activation',true
    ),
    clock_timestamp()
  );

  for v_old in
    select d.id,d.version
    from public.methodology_definitions d
    join lateral (
      select e.event_type
      from public.methodology_lifecycle_events e
      where e.methodology_definition_id=d.id
      order by e.effective_at desc,e.created_at desc,e.id desc
      limit 1
    ) x on true
    where d.methodology_key='research_candidate_pipeline'
      and d.id<>v_definition.id
      and x.event_type='active'
  loop
    insert into public.methodology_lifecycle_events(
      methodology_definition_id,event_type,reason,actor,commit_sha,metadata,effective_at
    ) values (
      v_old.id,'superseded',
      'Superseded by research-candidate-pipeline-v2.4.',
      p_actor,p_commit_sha,
      jsonb_build_object(
        'successor_version','research-candidate-pipeline-v2.4',
        'successor_implementation_hash',p_implementation_hash
      ),
      clock_timestamp()
    );
  end loop;

  return jsonb_build_object(
    'activated',true,
    'already_active',false,
    'methodology_key','research_candidate_pipeline',
    'version','research-candidate-pipeline-v2.4'
  );
end
$$;

revoke all on function public.begin_research_candidate_pipeline_publish_v2_4(jsonb)
from public,anon,authenticated;
revoke all on function public.stage_research_candidate_pipeline_items_v2_4(uuid,integer,jsonb)
from public,anon,authenticated;
revoke all on function public.finalize_research_candidate_pipeline_publish_v2_4(uuid)
from public,anon,authenticated;
revoke all on function public.activate_research_candidate_pipeline_v2_4(uuid,text,text,text,text)
from public,anon,authenticated;

grant execute on function public.begin_research_candidate_pipeline_publish_v2_4(jsonb)
to service_role;
grant execute on function public.stage_research_candidate_pipeline_items_v2_4(uuid,integer,jsonb)
to service_role;
grant execute on function public.finalize_research_candidate_pipeline_publish_v2_4(uuid)
to service_role;
grant execute on function public.activate_research_candidate_pipeline_v2_4(uuid,text,text,text,text)
to service_role;

comment on function public.finalize_research_candidate_pipeline_publish_v2_4(uuid) is
  'Atomically publishes a complete deterministic Research Candidate Pipeline V2.4 snapshot from staged service-role-only items.';
comment on function public.activate_research_candidate_pipeline_v2_4(uuid,text,text,text,text) is
  'Atomically activates validated Research Candidate Pipeline V2.4 and supersedes prior active pipeline versions.';
