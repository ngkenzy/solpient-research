-- Solpient 100 Phase 2: Canonical Evidence + Provenance + Point-in-Time Correctness
-- Additive to Phase 1. Does not weaken historical-integrity guards or publication RPC contracts.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Canonical evidence ledger
-- ---------------------------------------------------------------------------

create table if not exists public.evidence_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete restrict,
  source_key text not null unique,
  provider text not null,
  source_type text not null,
  title text,
  source_url text,
  accession_number text,
  form_type text,
  publication_at timestamptz,
  retrieved_at timestamptz not null,
  document_identifier text,
  source_version text,
  source_quality_class text not null,
  visibility text not null default 'internal',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint evidence_sources_quality_check check (
    source_quality_class in (
      'primary_regulatory',
      'company_direct',
      'structured_provider',
      'verified_secondary',
      'derived_calculation',
      'analyst_assumption'
    )
  ),
  constraint evidence_sources_visibility_check check (visibility in ('internal','public'))
);

create table if not exists public.evidence_observations (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.evidence_sources(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  observation_key text not null unique,
  module text not null default 'universal',
  metric_key text not null,
  raw_value_numeric numeric,
  raw_value_text text,
  unit text,
  economic_period_start date,
  economic_period_end date,
  economic_period_type text,
  observation_at timestamptz not null,
  known_at timestamptz not null,
  provider text not null,
  basis text not null,
  source_locator jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  visibility text not null default 'internal',
  created_at timestamptz not null default now(),
  constraint evidence_observations_basis_check check (
    basis in ('reported','estimated','derived','assumption')
  ),
  constraint evidence_observations_visibility_check check (visibility in ('internal','public')),
  constraint evidence_observations_value_check check (
    raw_value_numeric is not null or raw_value_text is not null
  )
);

create table if not exists public.normalized_facts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  fact_key text not null unique,
  module text not null default 'universal',
  metric_key text not null,
  value_numeric numeric,
  value_text text,
  unit text,
  economic_period_start date,
  economic_period_end date,
  economic_period_type text,
  known_at timestamptz not null,
  normalization_methodology_version text not null,
  selected_observation_id uuid references public.evidence_observations(id) on delete restrict,
  source_confidence_class text not null,
  conflict_state text not null default 'provisional',
  selection_reason text not null,
  derivation_basis text,
  formula_identifier text,
  calculation_engine_version text,
  calculated_at timestamptz,
  confidence_metadata jsonb not null default '{}'::jsonb,
  derivation_metadata jsonb not null default '{}'::jsonb,
  visibility text not null default 'internal',
  created_at timestamptz not null default now(),
  constraint normalized_facts_confidence_check check (
    source_confidence_class in (
      'primary_regulatory',
      'company_direct',
      'structured_provider',
      'verified_secondary',
      'derived_calculation',
      'analyst_assumption'
    )
  ),
  constraint normalized_facts_conflict_check check (
    conflict_state in ('verified','provisional','conflicting','superseded','unavailable')
  ),
  constraint normalized_facts_visibility_check check (visibility in ('internal','public')),
  constraint normalized_facts_value_check check (
    conflict_state='unavailable' or value_numeric is not null or value_text is not null
  )
);

create table if not exists public.normalized_fact_observations (
  normalized_fact_id uuid not null references public.normalized_facts(id) on delete restrict,
  observation_id uuid not null references public.evidence_observations(id) on delete restrict,
  observation_role text not null,
  created_at timestamptz not null default now(),
  primary key(normalized_fact_id,observation_id),
  constraint normalized_fact_observations_role_check check (
    observation_role in ('selected','supporting','conflicting')
  )
);

create table if not exists public.normalized_fact_inputs (
  normalized_fact_id uuid not null references public.normalized_facts(id) on delete restrict,
  input_fact_id uuid not null references public.normalized_facts(id) on delete restrict,
  input_role text not null,
  input_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key(normalized_fact_id,input_fact_id,input_role)
);

create table if not exists public.evidence_resolution_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  module text not null default 'universal',
  metric_key text not null,
  economic_period_start date,
  economic_period_end date,
  economic_period_type text,
  selected_observation_id uuid not null references public.evidence_observations(id) on delete restrict,
  decision_reason text not null,
  methodology_version text not null default 'source-resolution-v1',
  decided_at timestamptz not null default now(),
  supersedes_id uuid references public.evidence_resolution_decisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint evidence_resolution_decisions_reason_check check (length(btrim(decision_reason)) >= 8)
);

-- ---------------------------------------------------------------------------
-- Frozen research-input manifest
-- ---------------------------------------------------------------------------

create table if not exists public.research_input_manifest_staging (
  draft_id uuid primary key references public.baseline_drafts(id) on delete restrict,
  composition_id uuid not null references public.research_compositions(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  context_pack_id uuid references public.research_context_packs(id) on delete restrict,
  cutoff_at timestamptz not null,
  manifest_version text not null,
  manifest_hash text not null,
  provenance_status text not null,
  items jsonb not null default '[]'::jsonb,
  confidence_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint research_input_manifest_staging_status_check check (
    provenance_status in ('complete','partial','legacy_provenance_partial')
  ),
  constraint research_input_manifest_staging_hash_check check (
    manifest_hash ~ '^[0-9a-f]{64}$'
  )
);

create table if not exists public.research_input_manifests (
  id uuid primary key default gen_random_uuid(),
  research_run_id uuid not null unique references public.research_runs(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  context_pack_id uuid references public.research_context_packs(id) on delete restrict,
  cutoff_at timestamptz not null,
  manifest_version text not null,
  manifest_hash text not null,
  provenance_status text not null,
  confidence_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint research_input_manifests_status_check check (
    provenance_status in ('complete','partial','legacy_provenance_partial')
  ),
  constraint research_input_manifests_hash_check check (
    manifest_hash ~ '^[0-9a-f]{64}$'
  )
);

create table if not exists public.research_input_manifest_items (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references public.research_input_manifests(id) on delete restrict,
  normalized_fact_id uuid references public.normalized_facts(id) on delete restrict,
  input_role text not null default 'research_metric',
  module text not null default 'universal',
  metric_key text not null,
  value_numeric numeric,
  value_text text,
  unit text,
  economic_period_start date,
  economic_period_end date,
  economic_period_type text,
  known_at timestamptz,
  basis text not null,
  source_confidence_class text,
  conflict_state text,
  provenance_status text not null,
  derivation_basis text,
  source_lineage jsonb not null default '[]'::jsonb,
  lineage_metadata jsonb not null default '{}'::jsonb,
  input_hash text not null,
  created_at timestamptz not null default now(),
  constraint research_input_manifest_items_status_check check (
    provenance_status in ('complete','provisional','explicit_assumption','legacy_provenance_partial')
  ),
  constraint research_input_manifest_items_hash_check check (
    input_hash ~ '^[0-9a-f]{64}$'
  )
);

-- ---------------------------------------------------------------------------
-- Point-in-time publication/context metadata
-- ---------------------------------------------------------------------------

alter table public.research_runs
  add column if not exists source_context_pack_id uuid references public.research_context_packs(id) on delete restrict,
  add column if not exists provenance_version text,
  add column if not exists input_manifest_hash text;

alter table public.research_context_packs
  add column if not exists knowledge_cutoff_at timestamptz,
  add column if not exists input_hash text,
  add column if not exists provenance_status text not null default 'legacy_provenance_partial';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='research_runs_input_manifest_hash_check'
  ) then
    alter table public.research_runs
      add constraint research_runs_input_manifest_hash_check
      check (input_manifest_hash is null or input_manifest_hash ~ '^[0-9a-f]{64}$') not valid;
  end if;
  if not exists (
    select 1 from pg_constraint where conname='research_context_packs_provenance_status_check'
  ) then
    alter table public.research_context_packs
      add constraint research_context_packs_provenance_status_check
      check (provenance_status in ('complete','partial','legacy_provenance_partial')) not valid;
  end if;
end $$;

-- Published compositions must retain their exact context pack.
alter table public.research_compositions
  drop constraint if exists research_compositions_context_pack_id_fkey;
alter table public.research_compositions
  add constraint research_compositions_context_pack_id_fkey
  foreign key(context_pack_id) references public.research_context_packs(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Indexes for Solpient 100 point-in-time and lineage queries
-- ---------------------------------------------------------------------------

create index if not exists evidence_sources_company_provider_idx
  on public.evidence_sources(company_id,provider,retrieved_at desc);
create index if not exists evidence_sources_document_idx
  on public.evidence_sources(document_identifier,source_version);
create index if not exists evidence_observations_company_metric_known_idx
  on public.evidence_observations(company_id,module,metric_key,known_at desc);
create index if not exists evidence_observations_period_idx
  on public.evidence_observations(company_id,metric_key,economic_period_end desc,known_at desc);
create index if not exists evidence_observations_source_idx
  on public.evidence_observations(source_id);
create index if not exists normalized_facts_company_metric_known_idx
  on public.normalized_facts(company_id,module,metric_key,known_at desc);
create index if not exists normalized_facts_period_known_idx
  on public.normalized_facts(company_id,metric_key,economic_period_end desc,known_at desc);
create index if not exists normalized_facts_selected_observation_idx
  on public.normalized_facts(selected_observation_id);
create index if not exists normalized_fact_observations_observation_idx
  on public.normalized_fact_observations(observation_id);
create index if not exists normalized_fact_inputs_input_idx
  on public.normalized_fact_inputs(input_fact_id);
create index if not exists evidence_resolution_decisions_lookup_idx
  on public.evidence_resolution_decisions(company_id,module,metric_key,economic_period_end,decided_at desc);
create unique index if not exists evidence_resolution_decisions_supersedes_once_idx
  on public.evidence_resolution_decisions(supersedes_id) where supersedes_id is not null;
create index if not exists research_input_manifest_items_manifest_metric_idx
  on public.research_input_manifest_items(manifest_id,module,metric_key);
create index if not exists research_input_manifest_items_fact_idx
  on public.research_input_manifest_items(normalized_fact_id);
create index if not exists research_runs_context_pack_idx
  on public.research_runs(source_context_pack_id);
create index if not exists research_context_packs_company_cutoff_idx
  on public.research_context_packs(company_id,knowledge_cutoff_at desc,generated_at desc);

-- ---------------------------------------------------------------------------
-- Security: provenance is internal by default. No raw provider payload is exposed.
-- ---------------------------------------------------------------------------

alter table public.evidence_sources enable row level security;
alter table public.evidence_observations enable row level security;
alter table public.normalized_facts enable row level security;
alter table public.normalized_fact_observations enable row level security;
alter table public.normalized_fact_inputs enable row level security;
alter table public.evidence_resolution_decisions enable row level security;
alter table public.research_input_manifest_staging enable row level security;
alter table public.research_input_manifests enable row level security;
alter table public.research_input_manifest_items enable row level security;

revoke all on table
  public.evidence_sources,
  public.evidence_observations,
  public.normalized_facts,
  public.normalized_fact_observations,
  public.normalized_fact_inputs,
  public.evidence_resolution_decisions,
  public.research_input_manifest_staging,
  public.research_input_manifests,
  public.research_input_manifest_items
from public,anon,authenticated;

grant all on table
  public.evidence_sources,
  public.evidence_observations,
  public.normalized_facts,
  public.normalized_fact_observations,
  public.normalized_fact_inputs,
  public.evidence_resolution_decisions,
  public.research_input_manifest_staging,
  public.research_input_manifests,
  public.research_input_manifest_items
to service_role;

-- Frozen published manifests are safe public provenance read models.
-- Raw sources/observations/facts and internal resolution notes remain service-role only.
grant select on table public.research_input_manifests,public.research_input_manifest_items
to anon,authenticated;

drop policy if exists "public read published research input manifests" on public.research_input_manifests;
create policy "public read published research input manifests"
on public.research_input_manifests for select to anon,authenticated
using (
  exists (
    select 1 from public.research_runs rr
    where rr.id=research_run_id and rr.status='published'
  )
);

drop policy if exists "public read published research input manifest items" on public.research_input_manifest_items;
create policy "public read published research input manifest items"
on public.research_input_manifest_items for select to anon,authenticated
using (
  exists (
    select 1
    from public.research_input_manifests rim
    join public.research_runs rr on rr.id=rim.research_run_id
    where rim.id=manifest_id and rr.status='published'
  )
);

-- ---------------------------------------------------------------------------
-- Append-only provenance history
-- ---------------------------------------------------------------------------

do $$
declare rec text;
begin
  foreach rec in array array[
    'evidence_sources',
    'evidence_observations',
    'normalized_facts',
    'normalized_fact_observations',
    'normalized_fact_inputs',
    'evidence_resolution_decisions',
    'research_input_manifests',
    'research_input_manifest_items'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I',rec||'_append_only_guard',rec);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function private.guard_append_only_history()',
      rec||'_append_only_guard',rec
    );
  end loop;
end $$;

-- Staging remains editable before publication but is sealed after use.
create or replace function private.guard_manifest_staging_after_publication()
returns trigger language plpgsql set search_path='' as $$
begin
  if exists (
    select 1 from public.research_runs rr
    where rr.source_draft_id=old.draft_id and rr.status='published'
  ) then
    raise exception 'Published research input staging is sealed; create a new draft/composition.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists research_input_manifest_staging_seal on public.research_input_manifest_staging;
create trigger research_input_manifest_staging_seal
before update or delete on public.research_input_manifest_staging
for each row execute function private.guard_manifest_staging_after_publication();

-- Context packs used by published research are immutable.
create or replace function private.guard_published_context_pack()
returns trigger language plpgsql set search_path='' as $$
begin
  if exists (
    select 1
    from public.research_runs rr
    left join public.research_compositions rc on rc.id=rr.source_composition_id
    where rr.status='published'
      and (rr.source_context_pack_id=old.id or rc.context_pack_id=old.id)
  ) then
    raise exception 'A context pack used by published research is immutable; create a new context pack.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists research_context_packs_publication_seal on public.research_context_packs;
create trigger research_context_packs_publication_seal
before update or delete on public.research_context_packs
for each row execute function private.guard_published_context_pack();

-- ---------------------------------------------------------------------------
-- Publication provenance hook.
-- This augments, not replaces, Phase 1 publish_reviewed_research_v2().
-- ---------------------------------------------------------------------------

create or replace function private.prepare_research_run_provenance()
returns trigger language plpgsql set search_path='' as $$
declare
  v_context_id uuid;
  v_stage public.research_input_manifest_staging;
  v_item jsonb;
  v_fact public.normalized_facts;
begin
  if new.status<>'published' then return new; end if;

  if new.source_composition_id is not null then
    select context_pack_id into v_context_id
    from public.research_compositions
    where id=new.source_composition_id;
    new.source_context_pack_id:=v_context_id;
  end if;

  select * into v_stage
  from public.research_input_manifest_staging
  where draft_id=new.source_draft_id
    and composition_id=new.source_composition_id
    and company_id=new.company_id;

  -- Phase 1 and legacy callers without a Phase 2 manifest keep the original RPC contract.
  -- The Phase 2 application path always stages a manifest before invoking the same RPC.
  if not found then
    return new;
  end if;

  if new.data_cutoff_at is null then
    raise exception 'Phase 2 publication requires data_cutoff_at.';
  end if;

  if v_stage.cutoff_at is distinct from new.data_cutoff_at then
    raise exception 'Research-input manifest cutoff does not match research data cutoff.';
  end if;

  if pg_catalog.jsonb_typeof(v_stage.items)<>'array' or pg_catalog.jsonb_array_length(v_stage.items)=0 then
    raise exception 'Phase 2 publication requires at least one research-input manifest item.';
  end if;

  for v_item in select * from pg_catalog.jsonb_array_elements(v_stage.items)
  loop
    if nullif(v_item->>'known_at','') is not null
       and (v_item->>'known_at')::timestamptz > new.data_cutoff_at then
      raise exception 'Research input known_at exceeds research cutoff for metric %.', v_item->>'metric_key';
    end if;

    if nullif(v_item->>'normalized_fact_id','') is not null then
      select * into v_fact
      from public.normalized_facts
      where id=(v_item->>'normalized_fact_id')::uuid;
      if not found then
        raise exception 'Research-input manifest references a missing normalized fact.';
      end if;
      if v_fact.company_id<>new.company_id then
        raise exception 'Research-input manifest fact belongs to a different company.';
      end if;
      if v_fact.known_at>new.data_cutoff_at then
        raise exception 'Normalized fact known_at exceeds research cutoff.';
      end if;
    elsif coalesce(v_item->>'provenance_status','') not in ('explicit_assumption','legacy_provenance_partial') then
      raise exception 'Non-assumption research input lacks normalized fact lineage for metric %.', v_item->>'metric_key';
    end if;
  end loop;

  if new.source_context_pack_id is not null and exists (
    select 1 from public.research_context_packs cp
    where cp.id=new.source_context_pack_id
      and cp.knowledge_cutoff_at is not null
      and cp.knowledge_cutoff_at>new.data_cutoff_at
  ) then
    raise exception 'Context pack knowledge cutoff exceeds research cutoff.';
  end if;

  new.provenance_version:=v_stage.manifest_version;
  new.input_manifest_hash:=v_stage.manifest_hash;
  return new;
end $$;

drop trigger if exists aa_research_runs_provenance_prepare on public.research_runs;
create trigger aa_research_runs_provenance_prepare
before insert on public.research_runs
for each row execute function private.prepare_research_run_provenance();

create or replace function private.freeze_research_input_manifest()
returns trigger language plpgsql set search_path='' as $$
declare
  v_stage public.research_input_manifest_staging;
  v_manifest_id uuid;
  v_item jsonb;
begin
  if new.status<>'published' then
    return new;
  end if;

  select * into v_stage
  from public.research_input_manifest_staging
  where draft_id=new.source_draft_id
    and composition_id=new.source_composition_id
    and company_id=new.company_id;

  if not found then
    return new;
  end if;

  insert into public.research_input_manifests(
    research_run_id,company_id,context_pack_id,cutoff_at,manifest_version,
    manifest_hash,provenance_status,confidence_summary,created_at
  ) values (
    new.id,new.company_id,new.source_context_pack_id,v_stage.cutoff_at,v_stage.manifest_version,
    v_stage.manifest_hash,v_stage.provenance_status,v_stage.confidence_summary,coalesce(new.published_at,now())
  )
  returning id into v_manifest_id;

  for v_item in select * from pg_catalog.jsonb_array_elements(v_stage.items)
  loop
    insert into public.research_input_manifest_items(
      manifest_id,normalized_fact_id,input_role,module,metric_key,value_numeric,value_text,unit,
      economic_period_start,economic_period_end,economic_period_type,known_at,basis,
      source_confidence_class,conflict_state,provenance_status,derivation_basis,
      source_lineage,lineage_metadata,input_hash,created_at
    ) values (
      v_manifest_id,
      nullif(v_item->>'normalized_fact_id','')::uuid,
      coalesce(nullif(v_item->>'input_role',''),'research_metric'),
      coalesce(nullif(v_item->>'module',''),'universal'),
      v_item->>'metric_key',
      nullif(v_item->>'value_numeric','')::numeric,
      v_item->>'value_text',
      v_item->>'unit',
      nullif(v_item->>'economic_period_start','')::date,
      nullif(v_item->>'economic_period_end','')::date,
      v_item->>'economic_period_type',
      nullif(v_item->>'known_at','')::timestamptz,
      coalesce(nullif(v_item->>'basis',''),'reported'),
      v_item->>'source_confidence_class',
      v_item->>'conflict_state',
      coalesce(nullif(v_item->>'provenance_status',''),'provisional'),
      v_item->>'derivation_basis',
      coalesce(v_item->'source_lineage','[]'::jsonb),
      coalesce(v_item->'lineage_metadata','{}'::jsonb),
      v_item->>'input_hash',
      coalesce(new.published_at,now())
    );
  end loop;

  return new;
end $$;

drop trigger if exists zz_research_runs_provenance_freeze on public.research_runs;
create trigger zz_research_runs_provenance_freeze
after insert on public.research_runs
for each row execute function private.freeze_research_input_manifest();

-- ---------------------------------------------------------------------------
-- Fundamental projection capture.
-- The projection table may upsert a provider/period row; the canonical ledger does not.
-- ---------------------------------------------------------------------------

create or replace function private.capture_fundamental_snapshot_row(
  p_row public.fundamental_snapshots,
  p_known_at timestamptz
) returns void
language plpgsql set search_path='' as $
declare
  v_source_key text;
  v_source_id uuid;
  v_quality text;
  v_metric record;
  v_observation_key text;
begin
  if p_row.id is null or p_row.company_id is null then return; end if;
  p_known_at:=coalesce(p_known_at,p_row.observed_at,p_row.created_at,clock_timestamp());
  v_quality:=case
    when lower(coalesce(p_row.provider,'')) like '%sec%'
      or lower(coalesce(p_row.source_url,'')) like '%sec.gov%' then 'primary_regulatory'
    else 'structured_provider'
  end;

  v_source_key:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'origin','fundamental_snapshot_trigger_v1',
      'company_id',p_row.company_id,'provider',p_row.provider,'form',p_row.form,
      'period_end',p_row.period_end,'fiscal_year',p_row.fiscal_year,
      'fiscal_period',p_row.fiscal_period,'source_url',p_row.source_url,
      'filed_at',p_row.filed_at,'known_at',p_known_at
    )::text,'UTF8'),'sha256'),'hex');

  insert into public.evidence_sources(
    company_id,source_key,provider,source_type,title,source_url,form_type,
    publication_at,retrieved_at,document_identifier,source_version,
    source_quality_class,visibility,metadata,created_at
  ) values (
    p_row.company_id,v_source_key,coalesce(p_row.provider,'unknown'),
    coalesce(p_row.form,'Fundamental snapshot'),
    concat_ws(' · ',upper(coalesce(p_row.provider,'provider')),p_row.form,p_row.fiscal_period,p_row.fiscal_year),
    p_row.source_url,p_row.form,
    case when p_row.filed_at is null then null else p_row.filed_at::timestamptz end,
    p_known_at,coalesce(p_row.source_url,p_row.id::text),p_known_at::text,
    v_quality,'internal',
    pg_catalog.jsonb_build_object('projection_table','fundamental_snapshots','projection_id',p_row.id),
    p_known_at
  )
  on conflict(source_key) do nothing;

  select id into v_source_id from public.evidence_sources where source_key=v_source_key;
  if v_source_id is null then raise exception 'Could not resolve canonical evidence source for fundamental snapshot.'; end if;

  for v_metric in
    select * from (values
      ('revenue',p_row.revenue,'USD'),
      ('net_income',p_row.net_income,'USD'),
      ('operating_cash_flow',p_row.operating_cash_flow,'USD'),
      ('capital_expenditure',p_row.capital_expenditure,'USD'),
      ('free_cash_flow',p_row.free_cash_flow,'USD'),
      ('shares_outstanding',p_row.shares_outstanding,'shares'),
      ('eps_diluted',p_row.eps_diluted,'USD/share')
    ) as x(metric_key,value_numeric,unit)
  loop
    if v_metric.value_numeric is null then continue; end if;
    v_observation_key:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'source_key',v_source_key,'metric_key',v_metric.metric_key,
        'value',v_metric.value_numeric,'unit',v_metric.unit,
        'period_end',p_row.period_end,'period_type',p_row.fiscal_period,
        'known_at',p_known_at
      )::text,'UTF8'),'sha256'),'hex');

    insert into public.evidence_observations(
      source_id,company_id,observation_key,module,metric_key,raw_value_numeric,unit,
      economic_period_end,economic_period_type,observation_at,known_at,provider,basis,
      source_locator,raw_payload,visibility,created_at
    ) values (
      v_source_id,p_row.company_id,v_observation_key,'universal',v_metric.metric_key,
      v_metric.value_numeric,v_metric.unit,p_row.period_end,
      lower(coalesce(p_row.fiscal_period,p_row.form,'period')),
      p_known_at,p_known_at,coalesce(p_row.provider,'unknown'),'reported',
      pg_catalog.jsonb_build_object('source_url',p_row.source_url,'form',p_row.form),
      pg_catalog.jsonb_build_object('fundamental_snapshot_id',p_row.id),
      'internal',p_known_at
    )
    on conflict(observation_key) do nothing;
  end loop;
end $;

create or replace function private.capture_fundamental_snapshot_provenance()
returns trigger language plpgsql set search_path='' as $
declare
  v_changed boolean;
begin
  if tg_op='INSERT' then
    perform private.capture_fundamental_snapshot_row(new,coalesce(new.observed_at,new.created_at,clock_timestamp()));
    return new;
  end if;

  -- Ensure the pre-update provider state exists even if Phase 2 was installed immediately
  -- before the first correction.
  perform private.capture_fundamental_snapshot_row(old,coalesce(old.observed_at,old.created_at,clock_timestamp()));

  v_changed:=(
    pg_catalog.jsonb_build_object(
      'revenue',new.revenue,'net_income',new.net_income,'operating_cash_flow',new.operating_cash_flow,
      'capital_expenditure',new.capital_expenditure,'free_cash_flow',new.free_cash_flow,
      'shares_outstanding',new.shares_outstanding,'eps_diluted',new.eps_diluted,
      'raw_payload',new.raw_payload,'source_url',new.source_url,'filed_at',new.filed_at
    )
    is distinct from
    pg_catalog.jsonb_build_object(
      'revenue',old.revenue,'net_income',old.net_income,'operating_cash_flow',old.operating_cash_flow,
      'capital_expenditure',old.capital_expenditure,'free_cash_flow',old.free_cash_flow,
      'shares_outstanding',old.shares_outstanding,'eps_diluted',old.eps_diluted,
      'raw_payload',old.raw_payload,'source_url',old.source_url,'filed_at',old.filed_at
    )
  );
  if v_changed then
    perform private.capture_fundamental_snapshot_row(new,clock_timestamp());
  end if;
  return new;
end $;

drop trigger if exists fundamental_snapshots_provenance_capture on public.fundamental_snapshots;
create trigger fundamental_snapshots_provenance_capture
after insert or update on public.fundamental_snapshots
for each row execute function private.capture_fundamental_snapshot_provenance();

-- ---------------------------------------------------------------------------
-- Canonical evidence batch ingestion. Service role only, append-only.
-- ---------------------------------------------------------------------------

create or replace function public.ingest_evidence_batch_v1(
  p_sources jsonb,
  p_observations jsonb,
  p_facts jsonb,
  p_fact_observations jsonb default '[]'::jsonb,
  p_fact_inputs jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
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
  on conflict(source_key) do nothing;
  get diagnostics v_source_count=row_count;

  insert into public.evidence_observations
  select (pg_catalog.jsonb_populate_record(null::public.evidence_observations,elem)).*
  from pg_catalog.jsonb_array_elements(coalesce(p_observations,'[]'::jsonb)) elem
  on conflict(observation_key) do nothing;
  get diagnostics v_observation_count=row_count;

  insert into public.normalized_facts
  select (pg_catalog.jsonb_populate_record(null::public.normalized_facts,elem)).*
  from pg_catalog.jsonb_array_elements(coalesce(p_facts,'[]'::jsonb)) elem
  on conflict(fact_key) do nothing;
  get diagnostics v_fact_count=row_count;

  insert into public.normalized_fact_observations
  select (pg_catalog.jsonb_populate_record(null::public.normalized_fact_observations,elem)).*
  from pg_catalog.jsonb_array_elements(coalesce(p_fact_observations,'[]'::jsonb)) elem
  on conflict(normalized_fact_id,observation_id) do nothing;
  get diagnostics v_link_count=row_count;

  insert into public.normalized_fact_inputs
  select (pg_catalog.jsonb_populate_record(null::public.normalized_fact_inputs,elem)).*
  from pg_catalog.jsonb_array_elements(coalesce(p_fact_inputs,'[]'::jsonb)) elem
  on conflict(normalized_fact_id,input_fact_id,input_role) do nothing;
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

comment on table public.evidence_sources is
  'Append-only canonical source-document ledger. Raw provider secrets remain internal.';
comment on table public.evidence_observations is
  'Append-only statements/values exactly as observed from a source, with economic and knowledge time.';
comment on table public.normalized_facts is
  'Append-only canonical Solpient facts. Multiple knowledge-time versions may exist for the same economic period.';
comment on table public.research_input_manifests is
  'Immutable manifest of the exact fact/context inputs frozen with a published research version.';
comment on column public.research_runs.source_context_pack_id is
  'Exact context pack frozen for this publication. Legacy rows may be null and must use conservative as-of fallback.';
