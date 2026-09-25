-- Group A — targeted invalidation and authoritative maintenance queue.

create or replace function private.invalidate_research_from_fact_v1()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_prior public.normalized_facts;
  v_components text[];
  v_component text;
  v_priority integer;
  v_action text;
  v_rule_count integer;
  v_changed boolean;
begin
  if new.supersedes_fact_id is null then
    return new;
  end if;

  select * into v_prior
  from public.normalized_facts
  where id=new.supersedes_fact_id;

  if not found then
    return new;
  end if;

  v_changed :=
    new.value_numeric is distinct from v_prior.value_numeric
    or new.value_text is distinct from v_prior.value_text
    or new.unit is distinct from v_prior.unit
    or new.conflict_state is distinct from v_prior.conflict_state;

  if not v_changed then
    return new;
  end if;

  select
    array_agg(distinct component),
    max(r.priority),
    count(*)
  into v_components,v_priority,v_rule_count
  from public.research_dependency_rules r
  cross join lateral unnest(r.affected_components) component
  where r.methodology_version='research-dependency-v1'
    and (r.match_module is null or r.match_module=new.module)
    and (r.match_metric_key is null or r.match_metric_key=new.metric_key);

  if coalesce(v_rule_count,0)=0 then
    v_components:=array['thesis_review'];
    v_priority:=40;
    v_action:='research_review';
  else
    select r.required_action into v_action
    from public.research_dependency_rules r
    where r.methodology_version='research-dependency-v1'
      and (r.match_module is null or r.match_module=new.module)
      and (r.match_metric_key is null or r.match_metric_key=new.metric_key)
    order by r.priority desc,r.rule_key
    limit 1;
  end if;

  foreach v_component in array v_components
  loop
    insert into public.research_component_invalidations(
      company_id,normalized_fact_id,component_key,reason,severity,
      methodology_version,invalidated_at,status,updated_at
    ) values (
      new.company_id,new.id,v_component,
      'Normalized fact '||new.metric_key||' changed from a prior known version.',
      case when v_priority>=85 then 'high' when v_priority>=65 then 'material' else 'notable' end,
      'research-dependency-v1',new.known_at,'open',now()
    )
    on conflict (normalized_fact_id,component_key,methodology_version)
      where normalized_fact_id is not null
    do nothing;

    insert into public.research_component_freshness(
      company_id,component_key,status,next_due_at,invalidated_at,invalidation_reason,
      policy_version,updated_at
    )
    select new.company_id,v_component,'REVIEW_DUE',new.known_at,new.known_at,
      'Changed normalized fact: '||new.metric_key,'research-freshness-v1',now()
    where exists (
      select 1 from public.research_freshness_policies p
      where p.methodology_version='research-freshness-v1'
        and p.component_key=v_component
    )
    on conflict(company_id,component_key) do update set
      status=case
        when public.research_component_freshness.status='NEW_EVIDENCE' then 'NEW_EVIDENCE'
        else 'REVIEW_DUE'
      end,
      next_due_at=least(
        coalesce(public.research_component_freshness.next_due_at,excluded.next_due_at),
        excluded.next_due_at
      ),
      invalidated_at=greatest(public.research_component_freshness.invalidated_at,excluded.invalidated_at),
      invalidation_reason=excluded.invalidation_reason,
      updated_at=excluded.updated_at;
  end loop;

  insert into public.research_maintenance_queue(
    company_id,trigger_type,trigger_evidence_type,trigger_evidence_id,trigger_payload,
    detected_at,affected_components,priority,required_action,status,dedupe_key
  ) values (
    new.company_id,'normalized_fact_change','normalized_fact',new.id,
    jsonb_build_object(
      'module',new.module,
      'metric_key',new.metric_key,
      'known_at',new.known_at,
      'supersedes_fact_id',new.supersedes_fact_id,
      'prior_value_numeric',v_prior.value_numeric,
      'new_value_numeric',new.value_numeric,
      'prior_value_text',v_prior.value_text,
      'new_value_text',new.value_text
    ),
    new.known_at,v_components,coalesce(v_priority,40),coalesce(v_action,'research_review'),
    'queued','fact:'||new.id::text
  )
  on conflict(dedupe_key) do nothing;

  update public.research_component_invalidations
  set status='queued',updated_at=now()
  where normalized_fact_id=new.id and status='open';

  return new;
end $$;

drop trigger if exists zz_normalized_facts_research_invalidation on public.normalized_facts;
create trigger zz_normalized_facts_research_invalidation
after insert on public.normalized_facts
for each row execute function private.invalidate_research_from_fact_v1();

create or replace function public.enqueue_due_research_maintenance_v1(
  p_company_id uuid,
  p_as_of timestamptz default now()
)
returns integer
language plpgsql
set search_path=''
as $$
declare
  v_row public.research_component_freshness;
  v_action text;
  v_priority integer;
  v_key text;
  v_count integer := 0;
begin
  for v_row in
    select *
    from public.research_component_freshness f
    where f.company_id=p_company_id
      and f.status in ('STALE','REVIEW_DUE','NEW_EVIDENCE')
  loop
    v_action:=case v_row.component_key
      when 'market_data' then 'market_refresh'
      when 'valuation' then 'valuation_review'
      when 'ownership' then 'ownership_refresh'
      when 'capital_allocation' then 'capital_allocation_review'
      when 'sec_filings' then 'evidence_refresh'
      when 'fundamentals' then 'evidence_refresh'
      else 'research_review'
    end;

    v_priority:=case v_row.status
      when 'NEW_EVIDENCE' then 85
      when 'REVIEW_DUE' then 70
      else 55
    end;

    v_key:='freshness:'||p_company_id::text||':'||v_row.component_key||':'||
      v_row.status||':'||
      coalesce(v_row.invalidated_at::date,v_row.next_due_at::date,p_as_of::date)::text;

    insert into public.research_maintenance_queue(
      company_id,trigger_type,trigger_payload,detected_at,affected_components,
      priority,required_action,status,dedupe_key
    ) values (
      p_company_id,'freshness_state',
      jsonb_build_object(
        'component_key',v_row.component_key,
        'status',v_row.status,
        'next_due_at',v_row.next_due_at,
        'latest_evidence_at',v_row.latest_evidence_at
      ),
      p_as_of,array[v_row.component_key],v_priority,v_action,'queued',v_key
    )
    on conflict(dedupe_key) do nothing;

    if found then
      v_count:=v_count+1;
    end if;
  end loop;

  return v_count;
end $$;

create or replace function public.claim_research_maintenance_batch_v1(
  p_limit integer default 20,
  p_worker_id text default null,
  p_actions text[] default null
)
returns setof public.research_maintenance_queue
language plpgsql
set search_path=''
as $$
declare
  v_item public.research_maintenance_queue;
  v_attempt integer;
begin
  if p_limit<1 or p_limit>200 then
    raise exception 'p_limit must be between 1 and 200.';
  end if;

  for v_item in
    select *
    from public.research_maintenance_queue q
    where q.status in ('queued','failed')
      and q.attempt_count<3
      and (p_actions is null or q.required_action=any(p_actions))
    order by q.priority desc,q.detected_at asc,q.id
    for update skip locked
    limit p_limit
  loop
    v_attempt:=v_item.attempt_count+1;

    update public.research_maintenance_queue
    set status='running',
        attempt_count=v_attempt,
        started_at=now(),
        completed_at=null,
        last_error=null,
        updated_at=now()
    where id=v_item.id
    returning * into v_item;

    insert into public.research_maintenance_attempts(
      queue_item_id,attempt_number,worker_id,started_at,status
    ) values(v_item.id,v_attempt,p_worker_id,now(),'running');

    return next v_item;
  end loop;
end $$;

create or replace function public.complete_research_maintenance_item_v1(
  p_queue_item_id uuid,
  p_status text,
  p_resulting_research_run_id uuid default null,
  p_error_message text default null,
  p_details jsonb default '{}'::jsonb
)
returns public.research_maintenance_queue
language plpgsql
set search_path=''
as $$
declare
  v_item public.research_maintenance_queue;
begin
  if p_status not in ('succeeded','failed','cancelled') then
    raise exception 'Completion status must be succeeded, failed, or cancelled.';
  end if;

  select * into v_item
  from public.research_maintenance_queue
  where id=p_queue_item_id
  for update;

  if not found then
    raise exception 'Unknown maintenance queue item %.',p_queue_item_id;
  end if;

  if v_item.status<>'running' then
    raise exception 'Maintenance item % is %, not running.',p_queue_item_id,v_item.status;
  end if;

  update public.research_maintenance_attempts
  set completed_at=now(),
      status=p_status,
      error_message=p_error_message,
      details=coalesce(p_details,'{}'::jsonb)
  where queue_item_id=p_queue_item_id
    and attempt_number=v_item.attempt_count;

  update public.research_maintenance_queue
  set status=p_status,
      completed_at=now(),
      last_error=p_error_message,
      resulting_research_run_id=p_resulting_research_run_id,
      updated_at=now()
  where id=p_queue_item_id
  returning * into v_item;

  if p_status='succeeded' then
    update public.research_component_invalidations
    set status='resolved',
        resolved_at=now(),
        resulting_research_run_id=p_resulting_research_run_id,
        resolution_note='Resolved by research maintenance queue item '||p_queue_item_id::text,
        updated_at=now()
    where company_id=v_item.company_id
      and status in ('open','queued')
      and component_key=any(v_item.affected_components);

    update public.research_component_freshness
    set invalidated_at=null,
        invalidation_reason=null,
        evidence_since_publication=false,
        updated_at=now()
    where company_id=v_item.company_id
      and component_key=any(v_item.affected_components);
  end if;

  return v_item;
end $$;

revoke all on function public.enqueue_due_research_maintenance_v1(uuid,timestamptz)
  from public,anon,authenticated;
revoke all on function public.claim_research_maintenance_batch_v1(integer,text,text[])
  from public,anon,authenticated;
revoke all on function public.complete_research_maintenance_item_v1(uuid,text,uuid,text,jsonb)
  from public,anon,authenticated;

grant execute on function public.enqueue_due_research_maintenance_v1(uuid,timestamptz) to service_role;
grant execute on function public.claim_research_maintenance_batch_v1(integer,text,text[]) to service_role;
grant execute on function public.complete_research_maintenance_item_v1(uuid,text,uuid,text,jsonb) to service_role;
