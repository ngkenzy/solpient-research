-- Solpient Money V0.3 read contract.
-- Published research fields are frozen to the latest published research run.
-- Ranking evidence-confidence and coverage fields are current and separately timestamped.

create or replace view public.money_research_snapshots_v1
with (security_invoker = true)
as
with latest_published as (
  select *
  from (
    select
      c.id as company_id,
      c.ticker,
      c.company_name,
      c.sector,
      c.industry,
      r.id as research_run_id,
      r.version as research_version,
      r.researched_at,
      r.published_at,
      r.data_cutoff_at,
      r.standard_version,
      r.standard_status,
      r.completeness_pct,
      r.methodology_version,
      r.publication_path,
      r.evidence_hash,
      r.published_output_hash,
      r.price_at_research,
      r.summary as research_summary,
      row_number() over (
        partition by c.id
        order by r.version desc, coalesce(r.published_at, r.researched_at) desc, r.created_at desc
      ) as rn
    from public.companies c
    join public.research_runs r on r.company_id = c.id
    where r.status = 'published'
  ) ranked
  where rn = 1
)
select
  l.company_id, l.ticker, l.company_name, l.sector, l.industry,
  l.research_run_id, l.research_version, l.researched_at, l.published_at,
  l.data_cutoff_at, l.standard_version, l.standard_status, l.completeness_pct,
  l.methodology_version, l.publication_path, l.evidence_hash, l.published_output_hash,
  l.price_at_research, l.research_summary,
  s.overall_score, s.quality_score, s.growth_score, s.valuation_score,
  s.financial_strength_score, s.moat_score, s.thesis_integrity_score,
  v.dcf_value, v.owner_earnings_value, v.earnings_multiple_value,
  v.historical_multiple_value, v.peer_value, v.bear_value, v.base_value,
  v.bull_value, v.mos_25_price, v.mos_35_price, v.mos_50_price,
  case
    when l.price_at_research is not null and l.price_at_research <> 0 and v.base_value is not null
    then round(((v.base_value / l.price_at_research) - 1) * 100, 2)
    else null
  end as base_value_gap_pct,
  rv.investment_thesis, rv.decision_dashboard, rv.final_conclusion,
  coalesce(tv.thesis_health, 'not_tracked') as thesis_health,
  coalesce(tv.strengthened_count, 0) as thesis_strengthened_count,
  coalesce(tv.weakened_count, 0) as thesis_weakened_count,
  coalesce(tv.unchanged_count, 0) as thesis_unchanged_count,
  coalesce(tv.monitor_count, 0) as thesis_monitor_count,
  coalesce(tv.items, '[]'::jsonb) as thesis_variables,
  coalesce(risks.items, '[]'::jsonb) as risks,
  coalesce(changes.items, '[]'::jsonb) as what_changed,
  ranking.evidence_confidence_score,
  ranking.evidence_component_coverage_pct,
  ranking.readiness_state,
  ranking.readiness_tier,
  ranking.ranking_methodology_version,
  ranking.ranked_at as evidence_confidence_as_of,
  coverage.overall_pct as current_coverage_pct,
  coverage.decision_readiness_pct as current_decision_readiness_pct,
  coverage.fundamentals_pct as current_fundamentals_coverage_pct,
  coverage.industry_pct as current_industry_coverage_pct,
  coverage.peer_pct as current_peer_coverage_pct,
  coverage.valuation_history_pct as current_valuation_history_coverage_pct,
  coverage.capital_allocation_pct as current_capital_allocation_coverage_pct,
  coverage.research_structure_pct as current_research_structure_coverage_pct,
  coverage.engine_version as coverage_engine_version,
  coverage.as_of_date as coverage_as_of_date
from latest_published l
left join public.scores s on s.research_run_id = l.research_run_id
left join public.valuations v on v.research_run_id = l.research_run_id
left join public.research_v2_sections rv on rv.research_run_id = l.research_run_id
left join lateral (
  select
    case
      when count(*) filter (where t.status = 'weakened') > 0 then 'watch'
      when count(*) filter (where t.status in ('monitor','unknown')) > 0 then 'monitor'
      when count(*) filter (where t.status = 'strengthened') > 0 then 'strong'
      when count(*) filter (where t.status = 'unchanged') > 0 then 'stable'
      else 'not_tracked'
    end as thesis_health,
    count(*) filter (where t.status = 'strengthened')::int as strengthened_count,
    count(*) filter (where t.status = 'weakened')::int as weakened_count,
    count(*) filter (where t.status = 'unchanged')::int as unchanged_count,
    count(*) filter (where t.status in ('monitor','unknown'))::int as monitor_count,
    jsonb_agg(
      jsonb_build_object(
        'variable_name', t.variable_name,
        'status', t.status,
        'expectation', t.expectation,
        'observed_value', t.observed_value,
        'evidence', t.evidence,
        'breaker_condition', t.breaker_condition
      )
      order by t.created_at, t.variable_name
    ) as items
  from public.thesis_variables t
  where t.research_run_id = l.research_run_id
) tv on true
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'risk_key', x.risk_key,
      'title', x.title,
      'category', x.category,
      'probability', x.probability,
      'severity', x.severity,
      'description', x.description,
      'leading_indicators', x.leading_indicators,
      'thesis_breaker', x.thesis_breaker,
      'evidence', x.evidence
    )
    order by
      case lower(coalesce(x.severity,'')) when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end,
      x.created_at, x.title
  ) as items
  from public.risk_register x
  where x.research_run_id = l.research_run_id
) risks on true
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'category', x.category, 'change_type', x.change_type, 'metric_key', x.metric_key,
      'label', x.label, 'old_value', x.old_value, 'new_value', x.new_value,
      'delta_value', x.delta_value, 'delta_percent', x.delta_percent,
      'old_text', x.old_text, 'new_text', x.new_text, 'direction', x.direction,
      'materiality', x.materiality, 'summary', x.summary, 'created_at', x.created_at
    )
    order by x.created_at desc, x.label
  ) as items
  from (
    select rc.*
    from public.research_changes rc
    where rc.current_run_id = l.research_run_id
    order by rc.created_at desc
    limit 8
  ) x
) changes on true
left join lateral (
  select
    rh.evidence_confidence_score,
    rh.evidence_component_coverage_pct,
    rh.readiness_state,
    rh.readiness_tier,
    rh.methodology_version as ranking_methodology_version,
    rh.ranked_at
  from public.ranking_history rh
  where rh.company_id = l.company_id
  order by rh.ranked_at desc, rh.created_at desc
  limit 1
) ranking on true
left join lateral (
  select
    d.overall_pct, d.decision_readiness_pct, d.fundamentals_pct, d.industry_pct,
    d.peer_pct, d.valuation_history_pct, d.capital_allocation_pct,
    d.research_structure_pct, d.engine_version, d.as_of_date
  from public.data_coverage_reports d
  where d.company_id = l.company_id
  order by d.as_of_date desc, d.generated_at desc, d.created_at desc
  limit 1
) coverage on true;

revoke all on public.money_research_snapshots_v1 from public, anon, authenticated;
grant select on public.money_research_snapshots_v1 to anon, authenticated;

comment on view public.money_research_snapshots_v1 is
  'Read-only Solpient Money integration contract. Published research fields are frozen to the latest published run; ranking evidence-confidence and coverage fields are explicitly current and timestamped separately.';
