-- Group A — temporal reads, freshness, and deterministic coverage.

create or replace function public.get_normalized_facts_as_of_v1(
  p_company_id uuid,
  p_cutoff timestamptz,
  p_metric_key text default null
)
returns setof public.normalized_facts
language sql
stable
set search_path=''
as $$
  select distinct on (
    nf.company_id,nf.module,nf.metric_key,
    nf.economic_period_start,nf.economic_period_end,nf.economic_period_type
  ) nf.*
  from public.normalized_facts nf
  where nf.company_id=p_company_id
    and nf.known_at<=p_cutoff
    and (p_metric_key is null or nf.metric_key=p_metric_key)
  order by
    nf.company_id,nf.module,nf.metric_key,
    nf.economic_period_start,nf.economic_period_end,nf.economic_period_type,
    nf.known_at desc,nf.created_at desc,nf.id desc;
$$;

create or replace function public.record_research_component_check_v1(
  p_company_id uuid,
  p_component_key text,
  p_last_checked_at timestamptz,
  p_latest_evidence_at timestamptz default null,
  p_last_reviewed_at timestamptz default null,
  p_last_recalculated_at timestamptz default null,
  p_last_published_at timestamptz default null,
  p_supported boolean default true,
  p_as_of timestamptz default now()
)
returns public.research_component_freshness
language plpgsql
set search_path=''
as $$
declare
  v_policy public.research_freshness_policies;
  v_existing public.research_component_freshness;
  v_cutoff timestamptz;
  v_checked timestamptz;
  v_evidence timestamptz;
  v_reviewed timestamptz;
  v_recalculated timestamptz;
  v_published timestamptz;
  v_status text;
  v_evidence_since boolean := false;
  v_next_due timestamptz;
  v_open_invalidation timestamptz;
  v_result public.research_component_freshness;
begin
  if not exists(select 1 from public.companies c where c.id=p_company_id) then
    raise exception 'Unknown company %.',p_company_id;
  end if;

  select * into v_policy
  from public.research_freshness_policies
  where methodology_version='research-freshness-v1'
    and component_key=p_component_key;
  if not found then
    raise exception 'Unknown research freshness component %.',p_component_key;
  end if;

  select * into v_existing
  from public.research_component_freshness
  where company_id=p_company_id and component_key=p_component_key;

  v_checked:=greatest(v_existing.last_checked_at,p_last_checked_at);
  v_evidence:=greatest(v_existing.latest_evidence_at,p_latest_evidence_at);
  v_reviewed:=greatest(v_existing.last_reviewed_at,p_last_reviewed_at);
  v_recalculated:=greatest(v_existing.last_recalculated_at,p_last_recalculated_at);
  v_published:=greatest(v_existing.last_published_at,p_last_published_at);

  select rr.data_cutoff_at into v_cutoff
  from public.research_runs rr
  where rr.company_id=p_company_id
    and rr.status='published'
    and coalesce(rr.published_at,rr.researched_at)<=p_as_of
  order by rr.version desc
  limit 1;

  select max(i.invalidated_at) into v_open_invalidation
  from public.research_component_invalidations i
  where i.company_id=p_company_id
    and i.component_key=p_component_key
    and i.status in ('open','queued')
    and i.invalidated_at<=p_as_of;

  v_evidence_since :=
    v_policy.evidence_triggers_review
    and v_evidence is not null
    and (v_cutoff is null or v_evidence>v_cutoff);

  if not p_supported then
    v_status:='NOT_SUPPORTED';
    v_next_due:=null;
  elsif v_evidence_since then
    v_status:='NEW_EVIDENCE';
    v_next_due:=p_as_of;
  elsif v_open_invalidation is not null then
    v_status:='REVIEW_DUE';
    v_next_due:=p_as_of;
  elsif v_policy.max_review_age is not null
        and coalesce(v_reviewed,v_recalculated,v_published) is null then
    v_status:='UNKNOWN';
    v_next_due:=p_as_of;
  elsif v_policy.max_review_age is not null
        and coalesce(v_reviewed,v_recalculated,v_published)+v_policy.max_review_age<p_as_of then
    v_status:='REVIEW_DUE';
    v_next_due:=coalesce(v_reviewed,v_recalculated,v_published)+v_policy.max_review_age;
  elsif v_policy.max_check_age is not null and v_checked is null then
    v_status:='UNKNOWN';
    v_next_due:=p_as_of;
  elsif v_policy.max_check_age is not null and v_checked+v_policy.max_check_age<p_as_of then
    v_status:='STALE';
    v_next_due:=v_checked+v_policy.max_check_age;
  else
    v_status:='CURRENT';
    if v_policy.max_check_age is not null and v_checked is not null then
      v_next_due:=v_checked+v_policy.max_check_age;
    elsif v_policy.max_review_age is not null then
      v_next_due:=coalesce(v_reviewed,v_recalculated,v_published)+v_policy.max_review_age;
    else
      v_next_due:=null;
    end if;
  end if;

  insert into public.research_component_freshness(
    company_id,component_key,last_checked_at,latest_evidence_at,last_reviewed_at,
    last_recalculated_at,last_published_at,evidence_since_publication,status,next_due_at,
    invalidated_at,invalidation_reason,policy_version,metadata,updated_at
  )
  values(
    p_company_id,p_component_key,v_checked,v_evidence,v_reviewed,v_recalculated,v_published,
    v_evidence_since,v_status,v_next_due,
    greatest(v_existing.invalidated_at,v_open_invalidation),
    case when v_open_invalidation is not null then 'Open dependency invalidation requires review.' else null end,
    'research-freshness-v1',
    coalesce(v_existing.metadata,'{}'::jsonb),
    p_as_of
  )
  on conflict(company_id,component_key) do update set
    last_checked_at=excluded.last_checked_at,
    latest_evidence_at=excluded.latest_evidence_at,
    last_reviewed_at=excluded.last_reviewed_at,
    last_recalculated_at=excluded.last_recalculated_at,
    last_published_at=excluded.last_published_at,
    evidence_since_publication=excluded.evidence_since_publication,
    status=excluded.status,
    next_due_at=excluded.next_due_at,
    invalidated_at=excluded.invalidated_at,
    invalidation_reason=excluded.invalidation_reason,
    policy_version=excluded.policy_version,
    updated_at=excluded.updated_at
  returning * into v_result;

  return v_result;
end $$;

create or replace function public.evaluate_research_coverage_v1(
  p_company_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path=''
as $$
declare
  v_run_id uuid;
  v_published_at timestamptz;
  v_published_count integer := 0;
  v_business_count integer := 0;
  v_thesis_count integer := 0;
  v_valuation_count integer := 0;
  v_risk_count integer := 0;
  v_manifest_count integer := 0;
  v_prediction_count integer := 0;
  v_valuation_history_count integer := 0;
  v_capital_years integer := 0;
  v_required_fresh integer := 0;
  v_required_total integer := 0;
  v_researched boolean := false;
  v_deep boolean := false;
  v_level text := 'MONITORED';
  v_reason text;
begin
  if not exists(select 1 from public.companies c where c.id=p_company_id) then
    raise exception 'Unknown company %.',p_company_id;
  end if;

  select rr.id,coalesce(rr.published_at,rr.researched_at)
    into v_run_id,v_published_at
  from public.research_runs rr
  where rr.company_id=p_company_id
    and rr.status='published'
    and coalesce(rr.published_at,rr.researched_at)<=p_as_of
  order by rr.version desc
  limit 1;

  select count(*) into v_published_count
  from public.research_runs rr
  where rr.company_id=p_company_id
    and rr.status='published'
    and coalesce(rr.published_at,rr.researched_at)<=p_as_of;

  if v_run_id is not null then
    select count(*) into v_business_count from public.business_assessments where research_run_id=v_run_id;
    select count(*) into v_thesis_count from public.thesis_variables where research_run_id=v_run_id;
    select count(*) into v_valuation_count from public.valuations where research_run_id=v_run_id;
    select count(*) into v_risk_count from public.risk_register where research_run_id=v_run_id;
    select count(*) into v_manifest_count from public.research_input_manifests where research_run_id=v_run_id;
  end if;

  v_researched :=
    v_run_id is not null
    and v_business_count>0
    and v_thesis_count>0
    and v_valuation_count>0
    and v_risk_count>0
    and v_manifest_count>0;

  select count(*) into v_prediction_count
  from public.prediction_snapshots ps
  where ps.company_id=p_company_id
    and ps.locked_at is not null
    and ps.predicted_at<=p_as_of;

  select count(*) into v_valuation_history_count
  from public.valuation_history vh
  where vh.company_id=p_company_id
    and vh.trading_date<=p_as_of::date;

  select count(distinct cah.fiscal_year) into v_capital_years
  from public.capital_allocation_history cah
  where cah.company_id=p_company_id
    and cah.fiscal_year is not null
    and cah.period_end<=p_as_of::date;

  select count(*) into v_required_total
  from public.research_freshness_policies p
  where p.methodology_version='research-freshness-v1'
    and p.required_for_deep_coverage;

  select count(*) into v_required_fresh
  from public.research_freshness_policies p
  join public.research_component_freshness f
    on f.company_id=p_company_id and f.component_key=p.component_key
  where p.methodology_version='research-freshness-v1'
    and p.required_for_deep_coverage
    and f.status='CURRENT';

  v_deep :=
    v_researched
    and v_published_count>=2
    and v_prediction_count>=1
    and v_valuation_history_count>=12
    and v_capital_years>=3
    and v_required_total>0
    and v_required_fresh=v_required_total;

  if v_deep then
    v_level:='DEEP_COVERAGE';
    v_reason:='Reviewed Research plus historical depth, locked prediction history, capital allocation, valuation history, and all required freshness components are current.';
  elsif v_researched then
    v_level:='RESEARCHED';
    v_reason:='Latest published Research contains reviewed business assessment, thesis variables, valuation, risks, and frozen evidence manifest.';
  else
    v_level:='MONITORED';
    v_reason:='Canonical company is monitorable, but deterministic reviewed-Research prerequisites are not all satisfied.';
  end if;

  return jsonb_build_object(
    'coverage_level',v_level,
    'methodology_version','research-coverage-v1',
    'reason',v_reason,
    'latest_research_run_id',v_run_id,
    'latest_published_at',v_published_at,
    'prerequisites',jsonb_build_object(
      'published_research_versions',v_published_count,
      'business_assessment',v_business_count>0,
      'thesis_variables',v_thesis_count,
      'valuation',v_valuation_count>0,
      'risks',v_risk_count,
      'frozen_input_manifest',v_manifest_count>0,
      'locked_predictions',v_prediction_count,
      'valuation_history_observations',v_valuation_history_count,
      'capital_allocation_years',v_capital_years,
      'required_fresh_components',v_required_fresh,
      'required_fresh_components_total',v_required_total
    )
  );
end $$;

create or replace function private.guard_research_coverage_state_v1()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_expected jsonb;
begin
  v_expected:=public.evaluate_research_coverage_v1(new.company_id,new.evaluated_at);
  if new.coverage_level<>(v_expected->>'coverage_level') then
    raise exception 'Coverage state % is not currently eligible; deterministic eligibility is %.',
      new.coverage_level,v_expected->>'coverage_level';
  end if;
  if new.methodology_version<>'research-coverage-v1' then
    raise exception 'Unsupported coverage methodology version %.',new.methodology_version;
  end if;
  return new;
end $$;

drop trigger if exists research_coverage_state_guard on public.research_coverage_states;
create trigger research_coverage_state_guard
before insert or update on public.research_coverage_states
for each row execute function private.guard_research_coverage_state_v1();

create or replace function public.refresh_research_coverage_v1(
  p_company_id uuid,
  p_as_of timestamptz default now()
)
returns public.research_coverage_states
language plpgsql
set search_path=''
as $$
declare
  v_eval jsonb;
  v_old public.research_coverage_states;
  v_result public.research_coverage_states;
begin
  v_eval:=public.evaluate_research_coverage_v1(p_company_id,p_as_of);
  select * into v_old from public.research_coverage_states where company_id=p_company_id;

  insert into public.research_coverage_states(
    company_id,coverage_level,methodology_version,eligibility_evidence,reason,evaluated_at,updated_at
  ) values (
    p_company_id,v_eval->>'coverage_level','research-coverage-v1',v_eval,v_eval->>'reason',p_as_of,p_as_of
  )
  on conflict(company_id) do update set
    coverage_level=excluded.coverage_level,
    methodology_version=excluded.methodology_version,
    eligibility_evidence=excluded.eligibility_evidence,
    reason=excluded.reason,
    evaluated_at=excluded.evaluated_at,
    updated_at=excluded.updated_at
  returning * into v_result;

  if v_old.company_id is null or v_old.coverage_level is distinct from v_result.coverage_level then
    insert into public.research_coverage_history(
      company_id,from_level,to_level,methodology_version,eligibility_evidence,
      transition_reason,evaluated_at
    ) values (
      p_company_id,v_old.coverage_level,v_result.coverage_level,
      v_result.methodology_version,v_result.eligibility_evidence,
      case when v_old.company_id is null
        then 'Initial deterministic coverage evaluation.'
        else 'Deterministic coverage eligibility changed from '||v_old.coverage_level||' to '||v_result.coverage_level||'.'
      end,
      p_as_of
    );
  end if;

  return v_result;
end $$;

create or replace function public.refresh_research_foundation_state_v1(
  p_company_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
set search_path=''
as $$
declare
  v_market timestamptz;
  v_fundamentals timestamptz;
  v_filings timestamptz;
  v_guidance timestamptz;
  v_valuation timestamptz;
  v_ownership timestamptz;
  v_capital timestamptz;
  v_research timestamptz;
  v_coverage public.research_coverage_states;
begin
  select max(ms.observed_at) into v_market
  from public.market_snapshots ms where ms.company_id=p_company_id;

  select max(fs.observed_at) into v_fundamentals
  from public.fundamental_snapshots fs where fs.company_id=p_company_id;

  select max(coalesce(fe.accepted_at,fe.created_at)) into v_filings
  from public.filing_events fe where fe.company_id=p_company_id;

  select max(eo.known_at) into v_guidance
  from public.evidence_observations eo
  where eo.company_id=p_company_id
    and (eo.module='consensus' or eo.metric_key ilike '%guidance%');

  select max(vh.observed_at) into v_valuation
  from public.valuation_history vh where vh.company_id=p_company_id;

  select max(coalesce(ca.verified_at,ca.created_at)) into v_ownership
  from public.capital_activity ca where ca.company_id=p_company_id;

  select max(cah.observed_at) into v_capital
  from public.capital_allocation_history cah where cah.company_id=p_company_id;

  select coalesce(rr.published_at,rr.researched_at)
    into v_research
  from public.research_runs rr
  where rr.company_id=p_company_id
    and rr.status='published'
    and coalesce(rr.published_at,rr.researched_at)<=p_as_of
  order by rr.version desc
  limit 1;

  perform public.record_research_component_check_v1(
    p_company_id,'market_data',v_market,v_market,null,null,null,true,p_as_of
  );

  perform public.record_research_component_check_v1(
    p_company_id,'fundamentals',v_fundamentals,
    greatest(v_fundamentals,(
      select max(nf.known_at) from public.normalized_facts nf
      where nf.company_id=p_company_id and nf.module='universal'
    )),
    null,null,null,true,p_as_of
  );

  if v_filings is not null then
    perform public.record_research_component_check_v1(
      p_company_id,'sec_filings',v_filings,v_filings,null,null,null,true,p_as_of
    );
  elsif not exists(
    select 1 from public.research_component_freshness f
    where f.company_id=p_company_id and f.component_key='sec_filings'
  ) then
    perform public.record_research_component_check_v1(
      p_company_id,'sec_filings',null,null,null,null,null,true,p_as_of
    );
  end if;

  if v_guidance is not null then
    perform public.record_research_component_check_v1(
      p_company_id,'earnings_guidance',v_guidance,v_guidance,null,null,null,true,p_as_of
    );
  elsif not exists(
    select 1 from public.research_component_freshness f
    where f.company_id=p_company_id and f.component_key='earnings_guidance'
  ) then
    perform public.record_research_component_check_v1(
      p_company_id,'earnings_guidance',null,null,null,null,null,false,p_as_of
    );
  end if;

  perform public.record_research_component_check_v1(
    p_company_id,'valuation',v_valuation,v_valuation,null,v_valuation,null,true,p_as_of
  );

  perform public.record_research_component_check_v1(
    p_company_id,'thesis_review',v_research,
    (select max(nf.known_at) from public.normalized_facts nf where nf.company_id=p_company_id),
    v_research,null,null,v_research is not null,p_as_of
  );

  perform public.record_research_component_check_v1(
    p_company_id,'published_research',v_research,
    (select max(nf.known_at) from public.normalized_facts nf where nf.company_id=p_company_id),
    v_research,null,v_research,v_research is not null,p_as_of
  );

  if v_ownership is not null then
    perform public.record_research_component_check_v1(
      p_company_id,'ownership',v_ownership,v_ownership,null,null,null,true,p_as_of
    );
  elsif not exists(
    select 1 from public.research_component_freshness f
    where f.company_id=p_company_id and f.component_key='ownership'
  ) then
    perform public.record_research_component_check_v1(
      p_company_id,'ownership',null,null,null,null,null,false,p_as_of
    );
  end if;

  if v_capital is not null then
    perform public.record_research_component_check_v1(
      p_company_id,'capital_allocation',v_capital,v_capital,null,null,null,true,p_as_of
    );
  elsif not exists(
    select 1 from public.research_component_freshness f
    where f.company_id=p_company_id and f.component_key='capital_allocation'
  ) then
    perform public.record_research_component_check_v1(
      p_company_id,'capital_allocation',null,null,null,null,null,false,p_as_of
    );
  end if;

  insert into public.research_freshness(
    company_id,market_updated_at,fundamentals_updated_at,research_reviewed_at,
    historical_valuation_updated_at,last_full_refresh_at,next_review_due_at,updated_at
  ) values (
    p_company_id,v_market,v_fundamentals,v_research,v_valuation,v_research,
    (select min(f.next_due_at) from public.research_component_freshness f
      where f.company_id=p_company_id and f.next_due_at is not null),
    p_as_of
  )
  on conflict(company_id) do update set
    market_updated_at=greatest(public.research_freshness.market_updated_at,excluded.market_updated_at),
    fundamentals_updated_at=greatest(public.research_freshness.fundamentals_updated_at,excluded.fundamentals_updated_at),
    research_reviewed_at=greatest(public.research_freshness.research_reviewed_at,excluded.research_reviewed_at),
    historical_valuation_updated_at=greatest(public.research_freshness.historical_valuation_updated_at,excluded.historical_valuation_updated_at),
    last_full_refresh_at=greatest(public.research_freshness.last_full_refresh_at,excluded.last_full_refresh_at),
    next_review_due_at=excluded.next_review_due_at,
    updated_at=excluded.updated_at;

  v_coverage:=public.refresh_research_coverage_v1(p_company_id,p_as_of);

  return jsonb_build_object(
    'company_id',p_company_id,
    'as_of',p_as_of,
    'coverage_level',v_coverage.coverage_level,
    'freshness',(
      select coalesce(jsonb_object_agg(f.component_key,jsonb_build_object(
        'status',f.status,
        'last_checked_at',f.last_checked_at,
        'latest_evidence_at',f.latest_evidence_at,
        'last_reviewed_at',f.last_reviewed_at,
        'last_recalculated_at',f.last_recalculated_at,
        'last_published_at',f.last_published_at,
        'evidence_since_publication',f.evidence_since_publication,
        'next_due_at',f.next_due_at,
        'invalidated_at',f.invalidated_at
      )),'{}'::jsonb)
      from public.research_component_freshness f
      where f.company_id=p_company_id
    )
  );
end $$;

revoke all on function public.get_normalized_facts_as_of_v1(uuid,timestamptz,text)
  from public,anon,authenticated;
revoke all on function public.record_research_component_check_v1(uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,boolean,timestamptz)
  from public,anon,authenticated;
revoke all on function public.evaluate_research_coverage_v1(uuid,timestamptz)
  from public,anon,authenticated;
revoke all on function public.refresh_research_coverage_v1(uuid,timestamptz)
  from public,anon,authenticated;
revoke all on function public.refresh_research_foundation_state_v1(uuid,timestamptz)
  from public,anon,authenticated;

grant execute on function public.get_normalized_facts_as_of_v1(uuid,timestamptz,text) to service_role;
grant execute on function public.record_research_component_check_v1(uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,boolean,timestamptz) to service_role;
grant execute on function public.evaluate_research_coverage_v1(uuid,timestamptz) to service_role;
grant execute on function public.refresh_research_coverage_v1(uuid,timestamptz) to service_role;
grant execute on function public.refresh_research_foundation_state_v1(uuid,timestamptz) to service_role;
