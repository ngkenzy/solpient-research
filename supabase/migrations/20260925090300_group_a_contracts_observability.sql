-- Group A — stable Group B research contract and operational observability.

create or replace function public.get_company_research_contract_v1(
  p_company_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path=''
as $$
declare
  v_company public.companies;
  v_run public.research_runs;
  v_coverage jsonb;
  v_cutoff timestamptz;
begin
  select * into v_company from public.companies where id=p_company_id;
  if not found then
    raise exception 'Unknown company %.',p_company_id;
  end if;

  select * into v_run
  from public.research_runs rr
  where rr.company_id=p_company_id
    and rr.status='published'
    and coalesce(rr.published_at,rr.researched_at)<=p_as_of
  order by rr.version desc
  limit 1;

  v_cutoff:=v_run.data_cutoff_at;

  select to_jsonb(h) into v_coverage
  from (
    select ch.to_level as coverage_level,
           ch.methodology_version,
           ch.eligibility_evidence,
           ch.transition_reason as reason,
           ch.evaluated_at
    from public.research_coverage_history ch
    where ch.company_id=p_company_id
      and ch.evaluated_at<=p_as_of
    order by ch.evaluated_at desc,ch.created_at desc
    limit 1
  ) h;

  if v_coverage is null and p_as_of>=now()-interval '5 minutes' then
    select to_jsonb(cs) into v_coverage
    from public.research_coverage_states cs
    where cs.company_id=p_company_id;
  end if;

  return jsonb_build_object(
    'contract_version','group-b-research-contract-v1',
    'as_of',p_as_of,
    'company',jsonb_build_object(
      'id',v_company.id,
      'ticker',v_company.ticker,
      'company_name',v_company.company_name,
      'cik',v_company.cik,
      'exchange',v_company.exchange,
      'sector',v_company.sector,
      'industry',v_company.industry
    ),
    'coverage',coalesce(v_coverage,'{}'::jsonb),
    'current_research',case when v_run.id is null then null else jsonb_build_object(
      'id',v_run.id,
      'version',v_run.version,
      'researched_at',v_run.researched_at,
      'published_at',v_run.published_at,
      'data_cutoff_at',v_run.data_cutoff_at,
      'methodology_version',v_run.methodology_version,
      'standard_version',v_run.standard_version,
      'standard_status',v_run.standard_status,
      'summary',v_run.summary,
      'input_manifest_hash',v_run.input_manifest_hash,
      'integrity_version',v_run.integrity_version
    ) end,
    'research_history',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',rr.id,
        'version',rr.version,
        'published_at',rr.published_at,
        'researched_at',rr.researched_at,
        'data_cutoff_at',rr.data_cutoff_at,
        'supersedes_id',rr.supersedes_id,
        'methodology_version',rr.methodology_version
      ) order by rr.version desc),'[]'::jsonb)
      from public.research_runs rr
      where rr.company_id=p_company_id
        and rr.status='published'
        and coalesce(rr.published_at,rr.researched_at)<=p_as_of
    ),
    'canonical_thesis_variables',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',tv.id,
        'variable_name',tv.variable_name,
        'metric_key',tv.metric_key,
        'expectation',tv.expectation,
        'observed_value',tv.observed_value,
        'status',tv.status,
        'comparator',tv.comparator,
        'threshold_value',tv.threshold_value,
        'threshold_unit',tv.threshold_unit,
        'review_frequency',tv.review_frequency,
        'breaker_condition',tv.breaker_condition
      ) order by tv.variable_name),'[]'::jsonb)
      from public.thesis_variables tv
      where v_run.id is not null
        and tv.research_run_id=v_run.id
    ),
    'freshness',(
      select coalesce(jsonb_object_agg(
        f.component_key,
        jsonb_build_object(
          'status',f.status,
          'last_checked_at',f.last_checked_at,
          'latest_evidence_at',f.latest_evidence_at,
          'last_reviewed_at',f.last_reviewed_at,
          'last_recalculated_at',f.last_recalculated_at,
          'last_published_at',f.last_published_at,
          'evidence_since_publication',f.evidence_since_publication,
          'next_due_at',f.next_due_at,
          'invalidated_at',f.invalidated_at
        )
      ),'{}'::jsonb)
      from public.research_component_freshness f
      where f.company_id=p_company_id
    ),
    'new_evidence',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'fact_id',nf.id,
        'module',nf.module,
        'metric_key',nf.metric_key,
        'economic_period_end',nf.economic_period_end,
        'known_at',nf.known_at,
        'source_confidence_class',nf.source_confidence_class,
        'conflict_state',nf.conflict_state
      ) order by nf.known_at desc),'[]'::jsonb)
      from public.normalized_facts nf
      where nf.company_id=p_company_id
        and nf.known_at<=p_as_of
        and (v_cutoff is null or nf.known_at>v_cutoff)
    ),
    'invalidated_components',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',i.id,
        'component_key',i.component_key,
        'severity',i.severity,
        'reason',i.reason,
        'invalidated_at',i.invalidated_at,
        'status',i.status
      ) order by i.invalidated_at desc),'[]'::jsonb)
      from public.research_component_invalidations i
      where i.company_id=p_company_id
        and i.status in ('open','queued')
    ),
    'evidence_manifest',(
      select case when rim.id is null then null else jsonb_build_object(
        'id',rim.id,
        'cutoff_at',rim.cutoff_at,
        'manifest_version',rim.manifest_version,
        'manifest_hash',rim.manifest_hash,
        'provenance_status',rim.provenance_status,
        'confidence_summary',rim.confidence_summary
      ) end
      from public.research_input_manifests rim
      where v_run.id is not null
        and rim.research_run_id=v_run.id
      limit 1
    )
  );
end $$;

create or replace function public.get_research_foundation_operational_status_v1(
  p_as_of timestamptz default now()
)
returns jsonb
language sql
stable
set search_path=''
as $$
  select jsonb_build_object(
    'as_of',p_as_of,
    'coverage_counts',(
      select coalesce(jsonb_object_agg(x.coverage_level,x.n),'{}'::jsonb)
      from (
        select coverage_level,count(*) n
        from public.research_coverage_states
        group by coverage_level
      ) x
    ),
    'freshness_counts',(
      select coalesce(jsonb_object_agg(x.status,x.n),'{}'::jsonb)
      from (
        select status,count(*) n
        from public.research_component_freshness
        group by status
      ) x
    ),
    'open_invalidations',(
      select count(*)
      from public.research_component_invalidations
      where status in ('open','queued')
    ),
    'queue_counts',(
      select coalesce(jsonb_object_agg(x.status,x.n),'{}'::jsonb)
      from (
        select status,count(*) n
        from public.research_maintenance_queue
        group by status
      ) x
    ),
    'failed_queue_items',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',q.id,
        'company_id',q.company_id,
        'required_action',q.required_action,
        'attempt_count',q.attempt_count,
        'last_error',q.last_error,
        'updated_at',q.updated_at
      ) order by q.updated_at desc),'[]'::jsonb)
      from public.research_maintenance_queue q
      where q.status='failed'
    )
  );
$$;

revoke all on function public.get_company_research_contract_v1(uuid,timestamptz)
  from public,anon,authenticated;
revoke all on function public.get_research_foundation_operational_status_v1(timestamptz)
  from public,anon,authenticated;

grant execute on function public.get_company_research_contract_v1(uuid,timestamptz) to service_role;
grant execute on function public.get_research_foundation_operational_status_v1(timestamptz) to service_role;
