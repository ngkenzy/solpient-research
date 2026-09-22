-- Universe Screen Staged Publication V1.2
-- Avoids oversized Data API requests while preserving one-transaction immutable publication.

create table if not exists public.universe_screen_publish_sessions (
  id uuid primary key default gen_random_uuid(),
  input_hash text not null unique,
  run_payload jsonb not null,
  expected_result_count integer not null check (expected_result_count >= 0),
  state text not null default 'staging' check (state in ('staging','finalized')),
  finalized_run_id uuid references public.universe_screen_runs(id) on delete restrict,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  constraint universe_screen_publish_sessions_input_hash_check
    check (input_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.universe_screen_publish_staged_results (
  publish_session_id uuid not null
    references public.universe_screen_publish_sessions(id) on delete cascade,
  ordinal integer not null check (ordinal > 0),
  ticker text not null,
  result_hash text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (publish_session_id, ordinal),
  unique (publish_session_id, ticker),
  constraint universe_screen_publish_staged_results_hash_check
    check (result_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists universe_screen_publish_sessions_state_idx
  on public.universe_screen_publish_sessions(state,created_at);

alter table public.universe_screen_publish_sessions enable row level security;
alter table public.universe_screen_publish_staged_results enable row level security;

revoke all on table
  public.universe_screen_publish_sessions,
  public.universe_screen_publish_staged_results
from public,anon,authenticated;

grant select,insert,update,delete on table
  public.universe_screen_publish_sessions,
  public.universe_screen_publish_staged_results
to service_role;

drop policy if exists "service role manages universe screen publish sessions"
  on public.universe_screen_publish_sessions;
create policy "service role manages universe screen publish sessions"
on public.universe_screen_publish_sessions
for all to service_role
using (true)
with check (true);

drop policy if exists "service role manages universe screen staged results"
  on public.universe_screen_publish_staged_results;
create policy "service role manages universe screen staged results"
on public.universe_screen_publish_staged_results
for all to service_role
using (true)
with check (true);

create or replace function public.begin_universe_screen_publish_v1_2(
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
  v_existing_run public.universe_screen_runs%rowtype;
  v_session public.universe_screen_publish_sessions%rowtype;
begin
  if jsonb_typeof(p_run) <> 'object' then
    raise exception 'p_run must be a JSON object';
  end if;

  v_input_hash := p_run->>'input_hash';
  v_expected_count := coalesce((p_run->>'result_count')::integer,-1);

  if coalesce(v_input_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid universe screen input hash';
  end if;
  if v_expected_count < 0 then
    raise exception 'invalid expected result count';
  end if;
  if coalesce(p_run->'metadata'->>'validation_hash','') !~ '^[0-9a-f]{64}$' then
    raise exception 'screen run requires validation_hash metadata';
  end if;
  if coalesce(p_run->'metadata'->>'universe_input_hash','') !~ '^[0-9a-f]{64}$' then
    raise exception 'screen run requires universe_input_hash metadata';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('solpient-universe-screen-publish:'||v_input_hash,0));

  select * into v_existing_run
  from public.universe_screen_runs
  where input_hash=v_input_hash;

  if found then
    if v_existing_run.result_count <> (
      select count(*) from public.universe_screen_results r
      where r.universe_screen_run_id=v_existing_run.id
    ) or v_existing_run.result_count <> v_expected_count
       or v_existing_run.metadata->>'validation_hash' <> p_run->'metadata'->>'validation_hash'
       or v_existing_run.metadata->>'universe_input_hash' <> p_run->'metadata'->>'universe_input_hash'
    then
      raise exception 'existing immutable screen run is incomplete or does not match requested package';
    end if;

    return jsonb_build_object(
      'status','already_published',
      'run_id',v_existing_run.id,
      'publish_session_id',null
    );
  end if;

  select * into v_session
  from public.universe_screen_publish_sessions
  where input_hash=v_input_hash;

  if found then
    if v_session.run_payload <> p_run
       or v_session.expected_result_count <> v_expected_count then
      raise exception 'existing staging session does not match requested run payload';
    end if;

    return jsonb_build_object(
      'status',v_session.state,
      'run_id',v_session.finalized_run_id,
      'publish_session_id',v_session.id,
      'staged_result_count',(
        select count(*) from public.universe_screen_publish_staged_results s
        where s.publish_session_id=v_session.id
      )
    );
  end if;

  insert into public.universe_screen_publish_sessions(
    input_hash,run_payload,expected_result_count
  ) values (
    v_input_hash,p_run,v_expected_count
  )
  returning * into v_session;

  return jsonb_build_object(
    'status','staging',
    'run_id',null,
    'publish_session_id',v_session.id,
    'staged_result_count',0
  );
end
$$;

create or replace function public.stage_universe_screen_results_v1_2(
  p_publish_session_id uuid,
  p_start_ordinal integer,
  p_results jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session public.universe_screen_publish_sessions%rowtype;
  v_item jsonb;
  v_ordinal integer;
  v_ticker text;
  v_hash text;
  v_existing public.universe_screen_publish_staged_results%rowtype;
  v_chunk_count integer;
begin
  if p_start_ordinal is null or p_start_ordinal < 1 then
    raise exception 'p_start_ordinal must be >= 1';
  end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results)=0 then
    raise exception 'p_results must be a nonempty JSON array';
  end if;
  if jsonb_array_length(p_results) > 50 then
    raise exception 'staging chunk exceeds 50 results';
  end if;

  select * into v_session
  from public.universe_screen_publish_sessions
  where id=p_publish_session_id
  for update;

  if not found then
    raise exception 'publish session not found';
  end if;
  if v_session.state <> 'staging' then
    raise exception 'publish session is not staging';
  end if;

  v_chunk_count := jsonb_array_length(p_results);
  if p_start_ordinal + v_chunk_count - 1 > v_session.expected_result_count then
    raise exception 'staging chunk exceeds expected result count';
  end if;

  for v_item,v_ordinal in
    select value, p_start_ordinal + ordinality::integer - 1
    from jsonb_array_elements(p_results) with ordinality
  loop
    v_ticker := upper(trim(coalesce(v_item->>'ticker','')));
    v_hash := v_item->>'result_hash';

    if v_ticker='' then
      raise exception 'staged result missing ticker at ordinal %',v_ordinal;
    end if;
    if coalesce(v_hash,'') !~ '^[0-9a-f]{64}$' then
      raise exception 'staged result has invalid result_hash at ordinal %',v_ordinal;
    end if;

    select * into v_existing
    from public.universe_screen_publish_staged_results
    where publish_session_id=p_publish_session_id
      and ordinal=v_ordinal;

    if found then
      if v_existing.payload <> v_item
         or v_existing.ticker <> v_ticker
         or v_existing.result_hash <> v_hash then
        raise exception 'non-idempotent staged result retry at ordinal %',v_ordinal;
      end if;
    else
      insert into public.universe_screen_publish_staged_results(
        publish_session_id,ordinal,ticker,result_hash,payload
      ) values (
        p_publish_session_id,v_ordinal,v_ticker,v_hash,v_item
      );
    end if;
  end loop;

  return jsonb_build_object(
    'publish_session_id',p_publish_session_id,
    'chunk_start_ordinal',p_start_ordinal,
    'chunk_result_count',v_chunk_count,
    'staged_result_count',(
      select count(*)
      from public.universe_screen_publish_staged_results
      where publish_session_id=p_publish_session_id
    )
  );
end
$$;

create or replace function public.finalize_universe_screen_publish_v1_2(
  p_publish_session_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session public.universe_screen_publish_sessions%rowtype;
  v_run_id uuid;
  v_existing public.universe_screen_runs%rowtype;
  v_staged_count integer;
  v_min_ordinal integer;
  v_max_ordinal integer;
begin
  select * into v_session
  from public.universe_screen_publish_sessions
  where id=p_publish_session_id
  for update;

  if not found then
    raise exception 'publish session not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('solpient-universe-screen-publish:'||v_session.input_hash,0)
  );

  if v_session.state='finalized' then
    if v_session.finalized_run_id is null then
      raise exception 'finalized publish session is missing finalized_run_id';
    end if;
    return v_session.finalized_run_id;
  end if;

  select count(*),min(ordinal),max(ordinal)
    into v_staged_count,v_min_ordinal,v_max_ordinal
  from public.universe_screen_publish_staged_results
  where publish_session_id=p_publish_session_id;

  if v_staged_count <> v_session.expected_result_count
     or (v_session.expected_result_count>0 and v_min_ordinal<>1)
     or (v_session.expected_result_count>0 and v_max_ordinal<>v_session.expected_result_count)
  then
    raise exception
      'staged result set is incomplete: staged=% expected=% min=% max=%',
      v_staged_count,v_session.expected_result_count,v_min_ordinal,v_max_ordinal;
  end if;

  select * into v_existing
  from public.universe_screen_runs
  where input_hash=v_session.input_hash;

  if found then
    if v_existing.result_count <> (
      select count(*) from public.universe_screen_results r
      where r.universe_screen_run_id=v_existing.id
    ) or v_existing.result_count <> v_session.expected_result_count
       or v_existing.metadata->>'validation_hash' <>
          v_session.run_payload->'metadata'->>'validation_hash'
       or v_existing.metadata->>'universe_input_hash' <>
          v_session.run_payload->'metadata'->>'universe_input_hash'
    then
      raise exception 'existing immutable screen run is incomplete or mismatched';
    end if;

    update public.universe_screen_publish_sessions
    set state='finalized',finalized_run_id=v_existing.id,finalized_at=now()
    where id=p_publish_session_id;

    delete from public.universe_screen_publish_staged_results
    where publish_session_id=p_publish_session_id;

    return v_existing.id;
  end if;

  insert into public.universe_screen_runs(
    as_of_at,methodology_version,selection_version,provider,input_hash,
    input_count,result_count,excluded_count,watch_count,research_candidate_count,
    solpient_100_candidate_count,proposed_deep_research_count,metadata
  ) values (
    (v_session.run_payload->>'as_of_at')::timestamptz,
    v_session.run_payload->>'methodology_version',
    v_session.run_payload->>'selection_version',
    v_session.run_payload->>'provider',
    v_session.run_payload->>'input_hash',
    (v_session.run_payload->>'input_count')::integer,
    v_session.expected_result_count,
    coalesce((v_session.run_payload->>'excluded_count')::integer,0),
    coalesce((v_session.run_payload->>'watch_count')::integer,0),
    coalesce((v_session.run_payload->>'research_candidate_count')::integer,0),
    coalesce((v_session.run_payload->>'solpient_100_candidate_count')::integer,0),
    coalesce((v_session.run_payload->>'proposed_deep_research_count')::integer,0),
    coalesce(v_session.run_payload->'metadata','{}'::jsonb) ||
      jsonb_build_object('staged_atomic_publication',true)
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
  from public.universe_screen_publish_staged_results s
  cross join lateral jsonb_to_record(s.payload) as r(
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
  )
  where s.publish_session_id=p_publish_session_id
  order by s.ordinal;

  if (
    select count(*)
    from public.universe_screen_results
    where universe_screen_run_id=v_run_id
  ) <> v_session.expected_result_count then
    raise exception 'atomic universe screen insert count mismatch';
  end if;

  update public.universe_screen_publish_sessions
  set state='finalized',finalized_run_id=v_run_id,finalized_at=now()
  where id=p_publish_session_id;

  delete from public.universe_screen_publish_staged_results
  where publish_session_id=p_publish_session_id;

  return v_run_id;
end
$$;

revoke all on function public.begin_universe_screen_publish_v1_2(jsonb)
from public,anon,authenticated;
revoke all on function public.stage_universe_screen_results_v1_2(uuid,integer,jsonb)
from public,anon,authenticated;
revoke all on function public.finalize_universe_screen_publish_v1_2(uuid)
from public,anon,authenticated;

grant execute on function public.begin_universe_screen_publish_v1_2(jsonb)
to service_role;
grant execute on function public.stage_universe_screen_results_v1_2(uuid,integer,jsonb)
to service_role;
grant execute on function public.finalize_universe_screen_publish_v1_2(uuid)
to service_role;

comment on table public.universe_screen_publish_sessions is
  'Ephemeral service-role staging headers for chunked immutable universe-screen publication.';
comment on table public.universe_screen_publish_staged_results is
  'Ephemeral service-role staging rows. Final immutable screen publication occurs only in finalize_universe_screen_publish_v1_2.';
comment on function public.begin_universe_screen_publish_v1_2(jsonb) is
  'Creates or resumes an idempotent chunked screen publication session.';
comment on function public.stage_universe_screen_results_v1_2(uuid,integer,jsonb) is
  'Stages at most 50 immutable result payloads per request with idempotent ordinal checks.';
comment on function public.finalize_universe_screen_publish_v1_2(uuid) is
  'Atomically converts a complete staged result set into one immutable universe screen run and all result rows.';
