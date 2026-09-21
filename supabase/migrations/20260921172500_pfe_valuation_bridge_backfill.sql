with p as (
  select rr.id as research_run_id,
         rr.company_id,
         v.dcf_value,
         v.base_value,
         fm.free_cash_flow,
         fm.shares_outstanding
  from public.research_runs rr
  join public.companies c on c.id=rr.company_id
  left join public.valuations v on v.research_run_id=rr.id
  left join public.financial_metrics fm on fm.research_run_id=rr.id
  where c.ticker='PFE' and rr.status='published'
  order by rr.version desc
  limit 1
),
peer as (
  select percentile_cont(0.5) within group (order by x.value_numeric) as median_pfcf
  from (
    select distinct on (pms.peer_ticker)
      pms.peer_ticker,pms.value_numeric
    from public.peer_metric_snapshots pms,p
    where pms.company_id=p.company_id
      and pms.metric_key='price_to_fcf'
      and pms.value_numeric is not null
    order by pms.peer_ticker,pms.as_of_date desc
  ) x
),
calc as (
  select p.*,
         case when p.shares_outstanding<>0 then p.free_cash_flow/p.shares_outstanding end as fcf_per_share,
         peer.median_pfcf
  from p cross join peer
)
update public.research_v2_sections rvs
set valuation_analysis = jsonb_set(
  coalesce(rvs.valuation_analysis,'{}'::jsonb),
  '{valuation_bridge}',
  jsonb_build_object(
    'formula','median_of_applicable_anchors',
    'explanation','Bear, base and bull fair values are the median of the applicable normalized-multiple, DCF and normalized peer-FCF anchors. Missing anchors are excluded rather than imputed.',
    'primary_per_share_metric','price_to_fcf',
    'primary_per_share_label','FCF/share',
    'primary_per_share_value',calc.fcf_per_share,
    'peer_fcf_multiple',calc.median_pfcf,
    'normalized_fcf_per_share',calc.fcf_per_share,
    'components',jsonb_build_object(
      'base',jsonb_build_object(
        'normalized_multiple',null,
        'dcf',calc.dcf_value,
        'normalized_peer_fcf',calc.fcf_per_share*calc.median_pfcf,
        'result',calc.base_value
      )
    )
  ),
  true
)
from calc
where rvs.research_run_id=calc.research_run_id;
