-- Evidence provenance concurrency hardening.
-- Immutable canonical identities are deterministic. Concurrent workers may race
-- to insert the same source/observation/fact; identical identities are safe
-- no-ops, while mismatched key/id pairs remain hard failures.

create or replace function public.ingest_evidence_batch_v1(
  p_sources jsonb,
  p_observations jsonb,
  p_facts jsonb,
  p_fact_observations jsonb default '[]'::jsonb,
  p_fact_inputs jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_source_count integer:=0;
  v_observation_count integer:=0;
  v_fact_count integer:=0;
  v_link_count integer:=0;
  v_input_count integer:=0;
begin
  if pg_catalog.jsonb_typeof(coalesce(p_sources,'[]'::jsonb))<>'array'
     or pg_catalog.jsonb_typeof(coalesce(p_observations,'[]'::jsonb))<>'array'
     or pg_catalog.jsonb_typeof(coalesce(p_facts,'[]'::jsonb))<>'array'
     or pg_catalog.jsonb_typeof(coalesce(p_fact_observations,'[]'::jsonb))<>'array'
     or pg_catalog.jsonb_typeof(coalesce(p_fact_inputs,'[]'::jsonb))<>'array' then
    raise exception 'Evidence batch arguments must be JSON arrays.';
  end if;

  insert into public.evidence_sources
  select (pg_catalog.jsonb_populate_record(null::public.evidence_sources,elem)).*
  from pg_catalog.jsonb_array_elements(coalesce(p_sources,'[]'::jsonb)) elem
  on conflict do nothing;
  get diagnostics v_source_count=row_count;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(p_sources,'[]'::jsonb)) elem
    where nullif(elem->>'id','') is null
       or nullif(elem->>'source_key','') is null
       or not exists (
         select 1
         from public.evidence_sources es
         where es.id=(elem->>'id')::uuid
           and es.source_key=elem->>'source_key'
       )
  ) then
    raise exception 'Evidence source identity collision or unresolved concurrent insert.';
  end if;

  insert into public.evidence_observations
  select (pg_catalog.jsonb_populate_record(null::public.evidence_observations,elem)).*
  from pg_catalog.jsonb_array_elements(coalesce(p_observations,'[]'::jsonb)) elem
  on conflict do nothing;
  get diagnostics v_observation_count=row_count;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(p_observations,'[]'::jsonb)) elem
    where nullif(elem->>'id','') is null
       or nullif(elem->>'observation_key','') is null
       or not exists (
         select 1
         from public.evidence_observations eo
         where eo.id=(elem->>'id')::uuid
           and eo.observation_key=elem->>'observation_key'
       )
  ) then
    raise exception 'Evidence observation identity collision or unresolved concurrent insert.';
  end if;

  insert into public.normalized_facts
  select (pg_catalog.jsonb_populate_record(null::public.normalized_facts,elem)).*
  from pg_catalog.jsonb_array_elements(coalesce(p_facts,'[]'::jsonb)) elem
  on conflict do nothing;
  get diagnostics v_fact_count=row_count;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(p_facts,'[]'::jsonb)) elem
    where nullif(elem->>'id','') is null
       or nullif(elem->>'fact_key','') is null
       or not exists (
         select 1
         from public.normalized_facts nf
         where nf.id=(elem->>'id')::uuid
           and nf.fact_key=elem->>'fact_key'
       )
  ) then
    raise exception 'Normalized fact identity collision or unresolved concurrent insert.';
  end if;

  insert into public.normalized_fact_observations
  select (pg_catalog.jsonb_populate_record(null::public.normalized_fact_observations,elem)).*
  from pg_catalog.jsonb_array_elements(coalesce(p_fact_observations,'[]'::jsonb)) elem
  on conflict do nothing;
  get diagnostics v_link_count=row_count;

  insert into public.normalized_fact_inputs
  select (pg_catalog.jsonb_populate_record(null::public.normalized_fact_inputs,elem)).*
  from pg_catalog.jsonb_array_elements(coalesce(p_fact_inputs,'[]'::jsonb)) elem
  on conflict do nothing;
  get diagnostics v_input_count=row_count;

  return pg_catalog.jsonb_build_object(
    'sources',v_source_count,
    'observations',v_observation_count,
    'facts',v_fact_count,
    'fact_observation_links',v_link_count,
    'fact_inputs',v_input_count
  );
end $$;

revoke all on function public.ingest_evidence_batch_v1(jsonb,jsonb,jsonb,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.ingest_evidence_batch_v1(jsonb,jsonb,jsonb,jsonb,jsonb)
  to service_role;

comment on function public.ingest_evidence_batch_v1(jsonb,jsonb,jsonb,jsonb,jsonb) is
  'Append-only canonical evidence ingestion. Identical deterministic concurrent inserts are idempotent; mismatched identity collisions fail closed.';
