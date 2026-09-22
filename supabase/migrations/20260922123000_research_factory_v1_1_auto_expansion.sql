-- Research Factory V1.1 Automatic Queue Expansion
-- Adds transactional ranked claiming, stale-claim recovery, batch audit history,
-- and run-completion reconciliation for the existing Research Factory V1 queue.

create table if not exists public.research_factory_worker_runs (
  id uuid primary key default gen_random_uuid(),
  research_factory_run_id uuid not null
    references public.research_factory_runs(id) on delete restrict,
  automation_version text not null,
  status text not null default 'running'
    check (status in ('running','completed','partial','noop','failed')),
  max_companies integer not null check (max_companies between 1 and 10),
  selected_count integer not null default 0 check (selected_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  selected_tickers jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.research_factory_items
  add column if not exists worker_batch_id uuid
    references public.research_factory_worker_runs(id) on delete set null,
  add column if not exists worker_claimed_at timestamptz,
  add column if not exists worker_attempt_count integer not null default 0
    check (worker_attempt_count >= 0);

create index if not exists research_factory_worker_runs_run_idx
  on public.research_factory_worker_runs(research_factory_run_id,started_at desc);

create index if not exists research_factory_items_worker_batch_idx
  on public.research_factory_items(worker_batch_id)
  where worker_batch_id is not null;

create index if not exists research_factory_items_auto_queue_idx
  on public.research_factory_items(
    research_factory_run_id,status,stage,ordinal
  );

alter table public.research_factory_worker_runs enable row level security;

revoke all on table public.research_factory_worker_runs
from public,anon,authenticated;

grant select,insert,update on table public.research_factory_worker_runs
to service_role;

drop policy if exists "service role manages research factory worker runs"
  on public.research_factory_worker_runs;
create policy "service role manages research factory worker runs"
on public.research_factory_worker_runs
for all to service_role
using (true)
with check (true);

create or replace function public.claim_research_factory_batch_v1_1(
  p_research_factory_run_id uuid,
  p_max_companies integer default 10,
  p_ticker text default null,
  p_automation_version text default 'research-factory-v1.1'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_run public.research_factory_runs%rowtype;
  v_batch_id uuid;
  v_limit integer;
  v_items jsonb := '[]'::jsonb;
  v_selected_count integer := 0;
begin
  v_limit := greatest(1,least(coalesce(p_max_companies,10),10));

  if p_automation_version <> 'research-factory-v1.1' then
    raise exception 'unsupported Research Factory automation version: %',p_automation_version;
  end if;

  select * into v_run
  from public.research_factory_runs
  where id=p_research_factory_run_id
  for update;

  if not found then
    raise exception 'Research Factory run not found';
  end if;

  if v_run.factory_version <> 'research-factory-v1' then
    raise exception 'Research Factory V1.1 requires a research-factory-v1 run';
  end if;

  if v_run.status='completed' then
    return jsonb_build_object(
      'status','factory_complete',
      'batch_id',null,
      'selected_count',0,
      'items','[]'::jsonb
    );
  end if;

  -- Recover stale claims left by an interrupted worker. Only automatic stages
  -- can be reclaimed; human-review and blocked states are never touched.
  with stale as (
    select id,ticker,state_hash,worker_batch_id
    from public.research_factory_items
    where research_factory_run_id=v_run.id
      and status='running'
      and stage in ('evidence_ingestion','baseline_draft','research_draft')
      and coalesce(manual_review_count,0)=0
      and worker_claimed_at < clock_timestamp()-interval '6 hours'
    for update
  ),
  recovered as (
    update public.research_factory_items i
    set
      status='queued',
      worker_batch_id=null,
      worker_claimed_at=null,
      updated_at=clock_timestamp()
    from stale s
    where i.id=s.id
    returning i.id,i.ticker,i.state_hash,s.worker_batch_id
  )
  insert into public.research_factory_events(
    research_factory_run_id,research_factory_item_id,ticker,event_type,
    from_stage,to_stage,payload,payload_hash
  )
  select
    v_run.id,
    r.id,
    r.ticker,
    'automation_claim_recovered',
    null,
    null,
    jsonb_build_object(
      'automation_version',p_automation_version,
      'previous_worker_batch_id',r.worker_batch_id,
      'reason','stale running claim older than 6 hours'
    ),
    r.state_hash
  from recovered r;

  insert into public.research_factory_worker_runs(
    research_factory_run_id,automation_version,status,max_companies
  ) values (
    v_run.id,p_automation_version,'running',v_limit
  )
  returning id into v_batch_id;

  with candidates as (
    select i.id
    from public.research_factory_items i
    where i.research_factory_run_id=v_run.id
      and i.stage in ('evidence_ingestion','baseline_draft','research_draft')
      and i.status='queued'
      and coalesce(i.manual_review_count,0)=0
      and (p_ticker is null or upper(i.ticker)=upper(p_ticker))
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(i.next_actions,'[]'::jsonb)) action
        where action->>'type' in (
          'identity_review','industry_module_review','repair_review'
        )
      )
    order by i.ordinal,i.ticker
    for update skip locked
    limit v_limit
  ),
  claimed as (
    update public.research_factory_items i
    set
      status='running',
      worker_batch_id=v_batch_id,
      worker_claimed_at=clock_timestamp(),
      worker_attempt_count=i.worker_attempt_count+1,
      started_at=coalesce(i.started_at,clock_timestamp()),
      updated_at=clock_timestamp()
    from candidates c
    where i.id=c.id
    returning
      i.id,i.ticker,i.ordinal,i.stage,i.status,
      i.company_id,i.source_pipeline_item_id,i.source_screen_result_id,
      i.worker_attempt_count,i.state_hash
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',c.id,
          'ticker',c.ticker,
          'ordinal',c.ordinal,
          'stage',c.stage,
          'status',c.status,
          'company_id',c.company_id,
          'source_pipeline_item_id',c.source_pipeline_item_id,
          'source_screen_result_id',c.source_screen_result_id,
          'worker_attempt_count',c.worker_attempt_count
        )
        order by c.ordinal,c.ticker
      ),
      '[]'::jsonb
    ),
    count(*)::integer
  into v_items,v_selected_count
  from claimed c;

  update public.research_factory_worker_runs
  set
    selected_count=v_selected_count,
    selected_tickers=(
      select coalesce(
        jsonb_agg(x->>'ticker' order by (x->>'ordinal')::integer),
        '[]'::jsonb
      )
      from jsonb_array_elements(v_items) x
    ),
    status=case when v_selected_count=0 then 'noop' else 'running' end,
    completed_at=case when v_selected_count=0 then clock_timestamp() else null end
  where id=v_batch_id;

  insert into public.research_factory_events(
    research_factory_run_id,research_factory_item_id,ticker,event_type,
    from_stage,to_stage,payload,payload_hash
  )
  select
    v_run.id,
    i.id,
    i.ticker,
    'automation_batch_claimed',
    i.stage,
    i.stage,
    jsonb_build_object(
      'automation_version',p_automation_version,
      'worker_batch_id',v_batch_id,
      'ordinal',i.ordinal,
      'attempt',i.worker_attempt_count
    ),
    i.state_hash
  from public.research_factory_items i
  where i.worker_batch_id=v_batch_id;

  return jsonb_build_object(
    'status',case when v_selected_count=0 then 'noop' else 'claimed' end,
    'batch_id',v_batch_id,
    'selected_count',v_selected_count,
    'items',v_items
  );
end
$$;

create or replace function public.complete_research_factory_batch_v1_1(
  p_worker_batch_id uuid,
  p_summary jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_batch public.research_factory_worker_runs%rowtype;
  v_run public.research_factory_runs%rowtype;
  v_processed integer;
  v_batch_running integer;
  v_safe integer;
  v_review integer;
  v_blocked integer;
  v_running integer;
  v_candidate_count integer;
  v_batch_status text;
  v_run_completed boolean;
begin
  select * into v_batch
  from public.research_factory_worker_runs
  where id=p_worker_batch_id
  for update;

  if not found then raise exception 'Research Factory worker batch not found'; end if;

  select * into v_run
  from public.research_factory_runs
  where id=v_batch.research_factory_run_id
  for update;

  select
    count(*) filter (where status<>'running')::integer,
    count(*) filter (where status='running')::integer
  into v_processed,v_batch_running
  from public.research_factory_items
  where worker_batch_id=v_batch.id;

  select
    count(*) filter (
      where
        stage in ('evidence_ingestion','baseline_draft','research_draft')
        and status in ('queued','running')
        and coalesce(manual_review_count,0)=0
        and not exists (
          select 1
          from jsonb_array_elements(coalesce(next_actions,'[]'::jsonb)) action
          where action->>'type' in (
            'identity_review','industry_module_review','repair_review'
          )
        )
    )::integer,
    count(*) filter (
      where
        status='complete'
        or stage='complete'
        or stage='pipeline_refresh'
        or (
          status='needs_review'
          and (
            stage in ('valuation_review','research_review')
            or exists (
              select 1
              from jsonb_array_elements(coalesce(next_actions,'[]'::jsonb)) action
              where action->>'type' in (
                'identity_review','industry_module_review','repair_review'
              )
            )
          )
        )
    )::integer,
    count(*) filter (where status='blocked')::integer,
    count(*) filter (where status='running')::integer,
    count(*)::integer
  into v_safe,v_review,v_blocked,v_running,v_candidate_count
  from public.research_factory_items
  where research_factory_run_id=v_run.id;

  v_run_completed :=
    v_candidate_count=v_run.candidate_count
    and v_review=v_candidate_count
    and v_safe=0
    and v_blocked=0
    and v_running=0;

  v_batch_status := case
    when v_batch.selected_count=0 then 'noop'
    when v_batch_running>0 then 'partial'
    when coalesce((p_summary->>'failed_tickers')::integer,0)>0 then 'partial'
    else 'completed'
  end;

  update public.research_factory_worker_runs
  set
    status=v_batch_status,
    processed_count=coalesce(v_processed,0),
    summary=coalesce(p_summary,'{}'::jsonb) || jsonb_build_object(
      'safe_queue_count_after',v_safe,
      'review_gate_count_after',v_review,
      'blocked_count_after',v_blocked,
      'running_count_after',v_running,
      'candidate_count',v_candidate_count,
      'factory_completed',v_run_completed
    ),
    completed_at=clock_timestamp()
  where id=v_batch.id;

  update public.research_factory_runs
  set
    status=case when v_run_completed then 'completed' else 'active' end,
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'automation_version','research-factory-v1.1',
      'last_worker_batch_id',v_batch.id,
      'last_automatic_run_at',clock_timestamp(),
      'safe_queue_count',v_safe,
      'review_gate_count',v_review,
      'blocked_count',v_blocked,
      'all_at_review_gate',v_run_completed
    ),
    updated_at=clock_timestamp()
  where id=v_run.id;

  return jsonb_build_object(
    'worker_batch_id',v_batch.id,
    'batch_status',v_batch_status,
    'selected_count',v_batch.selected_count,
    'processed_count',coalesce(v_processed,0),
    'safe_queue_count_after',v_safe,
    'review_gate_count_after',v_review,
    'blocked_count_after',v_blocked,
    'running_count_after',v_running,
    'candidate_count',v_candidate_count,
    'factory_completed',v_run_completed
  );
end
$$;

revoke all on function public.claim_research_factory_batch_v1_1(uuid,integer,text,text)
from public,anon,authenticated;
revoke all on function public.complete_research_factory_batch_v1_1(uuid,jsonb)
from public,anon,authenticated;

grant execute on function public.claim_research_factory_batch_v1_1(uuid,integer,text,text)
to service_role;
grant execute on function public.complete_research_factory_batch_v1_1(uuid,jsonb)
to service_role;

comment on table public.research_factory_worker_runs is
  'Auditable automatic queue-expansion batches for Research Factory V1.1.';
comment on function public.claim_research_factory_batch_v1_1(uuid,integer,text,text) is
  'Atomically claims the next ranked safe automatic Research Factory items, excluding human-review actions.';
comment on function public.complete_research_factory_batch_v1_1(uuid,jsonb) is
  'Reconciles one automatic batch and marks the factory run complete only when every candidate is at a genuine review/post-review gate.';
