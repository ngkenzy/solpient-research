-- Group A database integration test.
-- Run after all migrations. Entire fixture rolls back.
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/group_a_research_foundation.sql

begin;
set local role service_role;

do $test$
declare
  v_company uuid;
  v_ticker text;
  v_fact_a uuid;
  v_fact_b uuid;
  v_level text;
  v_count integer;
  v_value numeric;
  v_queue public.research_maintenance_queue;
  v_failed boolean;
  v_t0 timestamptz := '2026-09-20T12:00:00Z';
  v_t1 timestamptz := '2026-09-21T12:00:00Z';
begin
  insert into public.companies(ticker,company_name)
  values ('GA' || substr(replace(gen_random_uuid()::text,'-',''),1,6),'Group A Integration Test')
  returning id into v_company;
  select c.ticker into v_ticker from public.companies c where c.id=v_company;

  -- Fixture represents a monitorable company: a minimal market-data evidence
  -- base. Zero-evidence companies are UNSUPPORTED per the PRD section 12
  -- coverage taxonomy (mirrored by evaluate_research_coverage_v1), so the
  -- fixture needs at least one evidence source to exercise the MONITORED path.
  insert into public.market_snapshots(company_id,symbol,observed_at,trading_date,price,provider)
  values (v_company,v_ticker,v_t0,v_t0::date,100,'group-a-test-fixture');

  -- Missing reviewed Research prerequisites must remain MONITORED.
  perform public.refresh_research_foundation_state_v1(v_company,v_t0);
  select coverage_level into v_level
  from public.research_coverage_states
  where company_id=v_company;
  if v_level<>'MONITORED' then
    raise exception 'Expected MONITORED, got %.',v_level;
  end if;

  -- Coverage is authoritative: callers cannot promote a company past eligibility.
  v_failed:=false;
  begin
    update public.research_coverage_states
    set coverage_level='RESEARCHED',evaluated_at=v_t0
    where company_id=v_company;
  exception when others then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'Ineligible coverage promotion was not blocked.';
  end if;

  -- Original fact known at t0.
  insert into public.normalized_facts(
    company_id,fact_key,module,metric_key,value_numeric,unit,
    economic_period_end,economic_period_type,known_at,
    normalization_methodology_version,source_confidence_class,
    conflict_state,selection_reason
  ) values (
    v_company,'group-a-fact-a-'||gen_random_uuid()::text,
    'universal','revenue',100,'USD','2026-06-30','quarter',v_t0,
    'group-a-test-v1','primary_regulatory','verified','Integration fixture A.'
  ) returning id into v_fact_a;

  -- Later amended fact supersedes A. Trigger must create targeted invalidation/work.
  insert into public.normalized_facts(
    company_id,fact_key,module,metric_key,value_numeric,unit,
    economic_period_end,economic_period_type,known_at,
    normalization_methodology_version,source_confidence_class,
    conflict_state,selection_reason,supersedes_fact_id,supersession_reason
  ) values (
    v_company,'group-a-fact-b-'||gen_random_uuid()::text,
    'universal','revenue',120,'USD','2026-06-30','quarter',v_t1,
    'group-a-test-v1','primary_regulatory','verified','Integration fixture B.',
    v_fact_a,'Later amended evidence.'
  ) returning id into v_fact_b;

  select value_numeric into v_value
  from public.get_normalized_facts_as_of_v1(v_company,v_t0 + interval '1 hour','revenue');
  if v_value<>100 then
    raise exception 'As-of read leaked future amendment; expected 100, got %.',v_value;
  end if;

  select value_numeric into v_value
  from public.get_normalized_facts_as_of_v1(v_company,v_t1 + interval '1 hour','revenue');
  if v_value<>120 then
    raise exception 'As-of read did not select latest known fact; expected 120, got %.',v_value;
  end if;

  select count(*) into v_count
  from public.research_component_invalidations
  where company_id=v_company
    and normalized_fact_id=v_fact_b
    and component_key in ('fundamentals','thesis_review','valuation')
    and status='queued';
  if v_count<>3 then
    raise exception 'Expected 3 targeted invalidations for revenue change, got %.',v_count;
  end if;

  select * into v_queue
  from public.research_maintenance_queue
  where company_id=v_company and trigger_evidence_id=v_fact_b
  limit 1;
  if v_queue.id is null then
    raise exception 'Changed normalized fact did not create maintenance work.';
  end if;
  if v_queue.required_action<>'research_review' or v_queue.priority<>85 then
    raise exception 'Unexpected queue mapping: action %, priority %.',v_queue.required_action,v_queue.priority;
  end if;
  if not (v_queue.affected_components @> array['fundamentals','thesis_review','valuation']) then
    raise exception 'Queue does not retain all affected components.';
  end if;

  -- Quiet checks remain CURRENT until the check clock expires.
  perform public.record_research_component_check_v1(
    v_company,'market_data',v_t1,v_t1,null,null,null,true,v_t1
  );
  select status into v_level
  from public.research_component_freshness
  where company_id=v_company and component_key='market_data';
  if v_level<>'CURRENT' then
    raise exception 'Fresh market check expected CURRENT, got %.',v_level;
  end if;

  perform public.record_research_component_check_v1(
    v_company,'market_data',null,null,null,null,null,true,v_t1 + interval '4 days'
  );
  select status into v_level
  from public.research_component_freshness
  where company_id=v_company and component_key='market_data';
  if v_level<>'STALE' then
    raise exception 'Expired market check expected STALE, got %.',v_level;
  end if;

  -- Coverage history must remain append-only.
  v_failed:=false;
  begin
    update public.research_coverage_history
    set transition_reason='mutated'
    where company_id=v_company;
  exception when others then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'Coverage history update was not blocked.';
  end if;
end
$test$;

-- RLS/grants must keep Group A operational state internal.
set local role authenticated;
do $security$
declare
  v_failed boolean := false;
begin
  begin
    perform count(*) from public.research_maintenance_queue;
  exception when insufficient_privilege then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'Authenticated role unexpectedly read internal maintenance queue.';
  end if;
end
$security$;

set local role service_role;
rollback;

