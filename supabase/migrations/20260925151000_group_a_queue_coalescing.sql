-- Group A — coalesce redundant normalized-fact queue work while preserving per-fact invalidation history.

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
  v_queue_key text;
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

  v_queue_key :=
    'fact-batch:'||new.company_id::text||':'||
    coalesce(v_action,'research_review')||':'||now()::date::text;

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
      'new_value_text',new.value_text,
      'coalesced',true,
      'latest_fact_id',new.id
    ),
    new.known_at,v_components,coalesce(v_priority,40),coalesce(v_action,'research_review'),
    'queued',v_queue_key
  )
  on conflict(dedupe_key) do update set
    affected_components=(
      select array_agg(distinct component order by component)
      from unnest(
        public.research_maintenance_queue.affected_components||
        excluded.affected_components
      ) component
    ),
    priority=greatest(public.research_maintenance_queue.priority,excluded.priority),
    detected_at=least(public.research_maintenance_queue.detected_at,excluded.detected_at),
    trigger_payload=
      coalesce(public.research_maintenance_queue.trigger_payload,'{}'::jsonb)||
      jsonb_build_object(
        'coalesced',true,
        'latest_metric_key',new.metric_key,
        'latest_fact_id',new.id,
        'latest_known_at',new.known_at
      ),
    status=case
      when public.research_maintenance_queue.status in ('succeeded','failed','cancelled')
        then 'queued'
      else public.research_maintenance_queue.status
    end,
    completed_at=case
      when public.research_maintenance_queue.status in ('succeeded','failed','cancelled')
        then null
      else public.research_maintenance_queue.completed_at
    end,
    last_error=case
      when public.research_maintenance_queue.status in ('succeeded','failed','cancelled')
        then null
      else public.research_maintenance_queue.last_error
    end,
    updated_at=now();

  update public.research_component_invalidations
  set status='queued',updated_at=now()
  where normalized_fact_id=new.id and status='open';

  return new;
end $$;

-- Coalesce already-queued per-fact work without deleting any audit row.
-- The oldest queue item in each company/action/day becomes the keeper.
with grouped as (
  select
    q.company_id,
    q.required_action,
    q.detected_at::date as batch_date,
    (array_agg(q.id order by q.detected_at,q.id))[1] as keeper_id,
    count(distinct q.id) as item_count,
    max(q.priority) as max_priority,
    array_agg(distinct component order by component) as components
  from public.research_maintenance_queue q
  cross join lateral unnest(q.affected_components) component
  where q.status='queued'
    and q.trigger_type='normalized_fact_change'
  group by q.company_id,q.required_action,q.detected_at::date
  having count(distinct q.id)>1
)
update public.research_maintenance_queue q
set affected_components=g.components,
    priority=g.max_priority,
    dedupe_key='fact-batch:'||g.company_id::text||':'||g.required_action||':'||g.batch_date::text,
    trigger_payload=
      coalesce(q.trigger_payload,'{}'::jsonb)||
      jsonb_build_object(
        'coalesced_recovery',true,
        'coalesced_item_count',g.item_count
      ),
    updated_at=now()
from grouped g
where q.id=g.keeper_id;

with grouped as (
  select
    q.company_id,
    q.required_action,
    q.detected_at::date as batch_date,
    (array_agg(q.id order by q.detected_at,q.id))[1] as keeper_id
  from public.research_maintenance_queue q
  where q.status='queued'
    and q.trigger_type='normalized_fact_change'
  group by q.company_id,q.required_action,q.detected_at::date
  having count(*)>1
)
update public.research_maintenance_queue q
set status='cancelled',
    completed_at=now(),
    trigger_payload=
      coalesce(q.trigger_payload,'{}'::jsonb)||
      jsonb_build_object(
        'coalesced_recovery',true,
        'coalesced_into_queue_item',g.keeper_id
      ),
    updated_at=now()
from grouped g
where q.company_id=g.company_id
  and q.required_action=g.required_action
  and q.detected_at::date=g.batch_date
  and q.trigger_type='normalized_fact_change'
  and q.status='queued'
  and q.id<>g.keeper_id;

comment on function private.invalidate_research_from_fact_v1() is
  'Preserves per-fact invalidations while coalescing normalized-fact maintenance work by company/action/day.';
