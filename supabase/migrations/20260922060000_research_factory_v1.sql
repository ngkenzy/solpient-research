-- Research Factory V1
-- Operational orchestration for the immutable Research Candidate Pipeline shortlist.
-- This layer does not publish research and does not change screening, valuation, or readiness methodology.

create table if not exists public.research_factory_runs (
  id uuid primary key default gen_random_uuid(),
  source_pipeline_run_id uuid not null
    references public.research_candidate_pipeline_runs(id) on delete restrict,
  factory_version text not null,
  input_hash text not null unique,
  status text not null default 'active'
    check (status in ('active','completed','blocked')),
  candidate_count integer not null check (candidate_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_pipeline_run_id,factory_version),
  constraint research_factory_runs_hash_check
    check (input_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.research_factory_items (
  id uuid primary key default gen_random_uuid(),
  research_factory_run_id uuid not null
    references public.research_factory_runs(id) on delete restrict,
  source_pipeline_item_id uuid not null
    references public.research_candidate_pipeline_items(id) on delete restrict,
  source_screen_result_id uuid not null
    references public.universe_screen_results(id) on delete restrict,
  ticker text not null,
  company_id uuid references public.companies(id) on delete restrict,
  ordinal integer not null check (ordinal > 0),
  stage text not null check (
    stage in (
      'onboarding',
      'evidence_ingestion',
      'baseline_draft',
      'research_draft',
      'valuation_review',
      'research_review',
      'pipeline_refresh',
      'complete'
    )
  ),
  status text not null default 'queued' check (
    status in ('queued','running','needs_review','blocked','complete')
  ),
  coverage_report_id uuid references public.data_coverage_reports(id) on delete set null,
  baseline_draft_id uuid references public.baseline_drafts(id) on delete set null,
  composition_id uuid references public.research_compositions(id) on delete set null,
  coverage_pct numeric,
  repair_job_count integer not null default 0 check (repair_job_count >= 0),
  manual_review_count integer not null default 0 check (manual_review_count >= 0),
  next_actions jsonb not null default '[]'::jsonb,
  state_snapshot jsonb not null default '{}'::jsonb,
  state_hash text not null,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(research_factory_run_id,ticker),
  unique(research_factory_run_id,source_pipeline_item_id),
  constraint research_factory_items_hash_check
    check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint research_factory_items_coverage_check
    check (coverage_pct is null or coverage_pct between 0 and 100)
);

create table if not exists public.research_factory_valuation_drafts (
  id uuid primary key default gen_random_uuid(),
  research_factory_item_id uuid not null
    references public.research_factory_items(id) on delete restrict,
  company_id uuid references public.companies(id) on delete restrict,
  source_screen_result_id uuid not null
    references public.universe_screen_results(id) on delete restrict,
  ticker text not null,
  factory_version text not null,
  industry_module text,
  status text not null default 'draft'
    check (status in ('draft','superseded','rejected')),
  valuation_input jsonb not null default '{}'::jsonb,
  preflight jsonb not null default '{}'::jsonb,
  missing_fields jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  input_hash text not null,
  created_at timestamptz not null default now(),
  unique(research_factory_item_id,input_hash),
  constraint research_factory_valuation_drafts_hash_check
    check (input_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.research_factory_events (
  id uuid primary key default gen_random_uuid(),
  research_factory_run_id uuid not null
    references public.research_factory_runs(id) on delete restrict,
  research_factory_item_id uuid
    references public.research_factory_items(id) on delete restrict,
  ticker text,
  event_type text not null,
  from_stage text,
  to_stage text,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  created_at timestamptz not null default now(),
  constraint research_factory_events_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists research_factory_runs_pipeline_idx
  on public.research_factory_runs(source_pipeline_run_id,created_at desc);
create index if not exists research_factory_items_stage_idx
  on public.research_factory_items(research_factory_run_id,status,stage,ordinal);
create index if not exists research_factory_items_company_idx
  on public.research_factory_items(company_id,updated_at desc);
create index if not exists research_factory_items_screen_result_idx
  on public.research_factory_items(source_screen_result_id);
create index if not exists research_factory_items_coverage_idx
  on public.research_factory_items(coverage_report_id);
create index if not exists research_factory_items_baseline_idx
  on public.research_factory_items(baseline_draft_id);
create index if not exists research_factory_items_composition_idx
  on public.research_factory_items(composition_id);
create index if not exists research_factory_valuation_drafts_item_idx
  on public.research_factory_valuation_drafts(research_factory_item_id,created_at desc);
create index if not exists research_factory_valuation_drafts_company_idx
  on public.research_factory_valuation_drafts(company_id,created_at desc);
create index if not exists research_factory_valuation_drafts_screen_idx
  on public.research_factory_valuation_drafts(source_screen_result_id);
create index if not exists research_factory_events_item_idx
  on public.research_factory_events(research_factory_item_id,created_at desc);
create index if not exists research_factory_events_run_idx
  on public.research_factory_events(research_factory_run_id,created_at desc);

alter table public.research_factory_runs enable row level security;
alter table public.research_factory_items enable row level security;
alter table public.research_factory_valuation_drafts enable row level security;
alter table public.research_factory_events enable row level security;

revoke all on table
  public.research_factory_runs,
  public.research_factory_items,
  public.research_factory_valuation_drafts,
  public.research_factory_events
from public,anon,authenticated;

grant select,insert,update,delete on table
  public.research_factory_runs,
  public.research_factory_items
to service_role;

grant select,insert on table
  public.research_factory_valuation_drafts,
  public.research_factory_events
to service_role;

revoke update,delete,truncate on table
  public.research_factory_valuation_drafts,
  public.research_factory_events
from service_role;

drop policy if exists "service role manages research factory runs"
  on public.research_factory_runs;
create policy "service role manages research factory runs"
on public.research_factory_runs
for all to service_role
using (true)
with check (true);

drop policy if exists "service role manages research factory items"
  on public.research_factory_items;
create policy "service role manages research factory items"
on public.research_factory_items
for all to service_role
using (true)
with check (true);

drop policy if exists "service role reads research factory valuation drafts"
  on public.research_factory_valuation_drafts;
create policy "service role reads research factory valuation drafts"
on public.research_factory_valuation_drafts
for select to service_role
using (true);

drop policy if exists "service role inserts research factory valuation drafts"
  on public.research_factory_valuation_drafts;
create policy "service role inserts research factory valuation drafts"
on public.research_factory_valuation_drafts
for insert to service_role
with check (true);

drop policy if exists "service role reads research factory events"
  on public.research_factory_events;
create policy "service role reads research factory events"
on public.research_factory_events
for select to service_role
using (true);

drop policy if exists "service role inserts research factory events"
  on public.research_factory_events;
create policy "service role inserts research factory events"
on public.research_factory_events
for insert to service_role
with check (true);

drop trigger if exists research_factory_valuation_drafts_append_only_guard
  on public.research_factory_valuation_drafts;
create trigger research_factory_valuation_drafts_append_only_guard
before update or delete on public.research_factory_valuation_drafts
for each row execute function private.guard_append_only_history();

drop trigger if exists research_factory_events_append_only_guard
  on public.research_factory_events;
create trigger research_factory_events_append_only_guard
before update or delete on public.research_factory_events
for each row execute function private.guard_append_only_history();

create or replace function public.create_research_factory_run_v1(
  p_run jsonb,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_source_run public.research_candidate_pipeline_runs%rowtype;
  v_existing public.research_factory_runs%rowtype;
  v_run_id uuid;
  v_expected integer;
  v_inserted integer;
begin
  if jsonb_typeof(p_run)<>'object' then
    raise exception 'p_run must be an object';
  end if;
  if jsonb_typeof(p_items)<>'array' then
    raise exception 'p_items must be an array';
  end if;
  if p_run->>'factory_version'<>'research-factory-v1' then
    raise exception 'Research Factory V1 requires factory_version=research-factory-v1';
  end if;
  if coalesce(p_run->>'input_hash','') !~ '^[0-9a-f]{64}$' then
    raise exception 'Research Factory V1 requires a valid input hash';
  end if;

  select * into v_source_run
  from public.research_candidate_pipeline_runs
  where id=(p_run->>'source_pipeline_run_id')::uuid;

  if not found then raise exception 'source candidate-pipeline run not found'; end if;
  if v_source_run.pipeline_version<>'research-candidate-pipeline-v2.4' then
    raise exception 'Research Factory V1 requires a Pipeline V2.4 source run';
  end if;

  v_expected := jsonb_array_length(p_items);
  if v_expected<>v_source_run.candidate_count
     or v_expected<>coalesce((p_run->>'candidate_count')::integer,-1) then
    raise exception
      'Research Factory candidate count mismatch: source=% payload=% items=%',
      v_source_run.candidate_count,p_run->>'candidate_count',v_expected;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('research-factory-v1:'||(p_run->>'input_hash'),0)
  );

  select * into v_existing
  from public.research_factory_runs
  where input_hash=p_run->>'input_hash';

  if found then
    if v_existing.source_pipeline_run_id<>v_source_run.id
       or v_existing.candidate_count<>v_expected
       or (
         select count(*)
         from public.research_factory_items i
         where i.research_factory_run_id=v_existing.id
       )<>v_expected then
      raise exception 'existing Research Factory V1 run is incomplete or mismatched';
    end if;
    return v_existing.id;
  end if;

  insert into public.research_factory_runs(
    source_pipeline_run_id,factory_version,input_hash,status,
    candidate_count,metadata
  ) values (
    v_source_run.id,
    p_run->>'factory_version',
    p_run->>'input_hash',
    'active',
    v_expected,
    coalesce(p_run->'metadata','{}'::jsonb)
  )
  returning id into v_run_id;

  insert into public.research_factory_items(
    research_factory_run_id,source_pipeline_item_id,source_screen_result_id,
    ticker,company_id,ordinal,stage,status,coverage_pct,repair_job_count,
    manual_review_count,next_actions,state_snapshot,state_hash,last_error
  )
  select
    v_run_id,
    x.source_pipeline_item_id,
    x.source_screen_result_id,
    upper(x.ticker),
    x.company_id,
    x.ordinal,
    x.stage,
    x.status,
    x.coverage_pct,
    coalesce(x.repair_job_count,0),
    coalesce(x.manual_review_count,0),
    coalesce(x.next_actions,'[]'::jsonb),
    coalesce(x.state_snapshot,'{}'::jsonb),
    x.state_hash,
    x.last_error
  from jsonb_to_recordset(p_items) as x(
    source_pipeline_item_id uuid,
    source_screen_result_id uuid,
    ticker text,
    company_id uuid,
    ordinal integer,
    stage text,
    status text,
    coverage_pct numeric,
    repair_job_count integer,
    manual_review_count integer,
    next_actions jsonb,
    state_snapshot jsonb,
    state_hash text,
    last_error text
  );

  get diagnostics v_inserted = row_count;
  if v_inserted<>v_expected then
    raise exception 'Research Factory V1 item insert mismatch';
  end if;

  if exists (
    select 1
    from public.research_factory_items f
    left join public.research_candidate_pipeline_items p
      on p.id=f.source_pipeline_item_id
    where f.research_factory_run_id=v_run_id
      and (
        p.id is null
        or p.research_candidate_pipeline_run_id<>v_source_run.id
        or upper(p.ticker)<>f.ticker
        or p.universe_screen_result_id<>f.source_screen_result_id
      )
  ) then
    raise exception 'Research Factory V1 item is not bound to the selected pipeline run';
  end if;

  insert into public.research_factory_events(
    research_factory_run_id,research_factory_item_id,ticker,event_type,
    from_stage,to_stage,payload,payload_hash
  )
  select
    v_run_id,
    f.id,
    f.ticker,
    'factory_item_created',
    null,
    f.stage,
    jsonb_build_object(
      'source_pipeline_item_id',f.source_pipeline_item_id,
      'source_screen_result_id',f.source_screen_result_id,
      'state_hash',f.state_hash
    ),
    encode(
      digest(
        convert_to(
          jsonb_build_object(
            'event_type','factory_item_created',
            'ticker',f.ticker,
            'state_hash',f.state_hash
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  from public.research_factory_items f
  where f.research_factory_run_id=v_run_id;

  return v_run_id;
end
$$;

create or replace function public.transition_research_factory_item_v1(
  p_item_id uuid,
  p_stage text,
  p_status text,
  p_company_id uuid,
  p_coverage_report_id uuid,
  p_baseline_draft_id uuid,
  p_composition_id uuid,
  p_coverage_pct numeric,
  p_repair_job_count integer,
  p_manual_review_count integer,
  p_next_actions jsonb,
  p_state_snapshot jsonb,
  p_state_hash text,
  p_last_error text,
  p_event_type text default 'state_refreshed'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_item public.research_factory_items%rowtype;
  v_from text;
  v_payload jsonb;
begin
  if coalesce(p_state_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'Research Factory transition requires a valid state hash';
  end if;

  select * into v_item
  from public.research_factory_items
  where id=p_item_id
  for update;

  if not found then raise exception 'Research Factory item not found'; end if;
  v_from:=v_item.stage;

  update public.research_factory_items
  set
    stage=p_stage,
    status=p_status,
    company_id=p_company_id,
    coverage_report_id=p_coverage_report_id,
    baseline_draft_id=p_baseline_draft_id,
    composition_id=p_composition_id,
    coverage_pct=p_coverage_pct,
    repair_job_count=coalesce(p_repair_job_count,0),
    manual_review_count=coalesce(p_manual_review_count,0),
    next_actions=coalesce(p_next_actions,'[]'::jsonb),
    state_snapshot=coalesce(p_state_snapshot,'{}'::jsonb),
    state_hash=p_state_hash,
    last_error=p_last_error,
    started_at=case
      when v_item.started_at is null and p_status='running' then clock_timestamp()
      else v_item.started_at
    end,
    completed_at=case
      when p_status='complete' then coalesce(v_item.completed_at,clock_timestamp())
      else null
    end,
    updated_at=clock_timestamp()
  where id=p_item_id;

  v_payload:=jsonb_build_object(
    'event_type',p_event_type,
    'from_stage',v_from,
    'to_stage',p_stage,
    'status',p_status,
    'company_id',p_company_id,
    'coverage_pct',p_coverage_pct,
    'repair_job_count',coalesce(p_repair_job_count,0),
    'manual_review_count',coalesce(p_manual_review_count,0),
    'state_hash',p_state_hash,
    'last_error',p_last_error
  );

  insert into public.research_factory_events(
    research_factory_run_id,research_factory_item_id,ticker,event_type,
    from_stage,to_stage,payload,payload_hash
  ) values (
    v_item.research_factory_run_id,
    v_item.id,
    v_item.ticker,
    p_event_type,
    v_from,
    p_stage,
    v_payload,
    encode(digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex')
  );

  return jsonb_build_object(
    'item_id',v_item.id,
    'ticker',v_item.ticker,
    'from_stage',v_from,
    'to_stage',p_stage,
    'status',p_status
  );
end
$$;

revoke all on function public.create_research_factory_run_v1(jsonb,jsonb)
from public,anon,authenticated;
revoke all on function public.transition_research_factory_item_v1(
  uuid,text,text,uuid,uuid,uuid,uuid,numeric,integer,integer,jsonb,jsonb,text,text,text
) from public,anon,authenticated;

grant execute on function public.create_research_factory_run_v1(jsonb,jsonb)
to service_role;
grant execute on function public.transition_research_factory_item_v1(
  uuid,text,text,uuid,uuid,uuid,uuid,numeric,integer,integer,jsonb,jsonb,text,text,text
) to service_role;

comment on table public.research_factory_runs is
  'Operational Research Factory batches bound to immutable Research Candidate Pipeline snapshots. Never a research publication.';
comment on table public.research_factory_items is
  'Mutable current work state for each factory candidate; all transitions are mirrored into append-only research_factory_events.';
comment on table public.research_factory_valuation_drafts is
  'Append-only evidence-prefilled valuation drafts. A draft is never equivalent to a reviewed Valuation V3 input pack.';
comment on function public.create_research_factory_run_v1(jsonb,jsonb) is
  'Atomically materializes a Research Factory V1 work queue from one immutable Pipeline V2.4 run.';
