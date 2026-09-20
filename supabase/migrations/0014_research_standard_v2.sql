create table if not exists public.company_metric_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  module text not null default 'universal',
  metric_key text not null,
  label text not null,
  period_end date not null,
  fiscal_year integer,
  period_type text not null,
  value_numeric numeric,
  value_text text,
  unit text,
  basis text not null default 'reported',
  source_type text,
  source_title text,
  source_url text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(company_id,module,metric_key,period_end,period_type)
);

create table if not exists public.valuation_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  trading_date date not null,
  pe numeric,
  forward_pe numeric,
  ev_to_ebitda numeric,
  price_to_fcf numeric,
  fcf_yield numeric,
  market_cap numeric,
  enterprise_value numeric,
  provider text,
  source_url text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(company_id,trading_date,provider)
);

create table if not exists public.company_peers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  peer_ticker text not null,
  peer_name text,
  peer_module text,
  relationship_type text not null default 'primary',
  rationale text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,peer_ticker)
);

create table if not exists public.peer_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  peer_ticker text not null,
  metric_key text not null,
  as_of_date date not null,
  value_numeric numeric,
  value_text text,
  unit text,
  provider text,
  source_url text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(company_id,peer_ticker,metric_key,as_of_date)
);

create table if not exists public.capital_allocation_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  period_end date not null,
  fiscal_year integer,
  dividends_paid numeric,
  buybacks numeric,
  stock_based_compensation numeric,
  acquisitions numeric,
  debt_issued numeric,
  debt_repaid numeric,
  ending_share_count numeric,
  retained_earnings numeric,
  source_title text,
  source_url text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(company_id,period_end)
);

create table if not exists public.research_freshness (
  company_id uuid primary key references public.companies(id) on delete cascade,
  market_updated_at timestamptz,
  fundamentals_updated_at timestamptz,
  research_reviewed_at timestamptz,
  thesis_changed_at timestamptz,
  peers_updated_at timestamptz,
  historical_valuation_updated_at timestamptz,
  checklist_updated_at timestamptz,
  last_full_refresh_at timestamptz,
  next_review_due_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.research_update_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  as_of_date date not null,
  action text not null,
  priority integer not null default 0,
  reasons jsonb not null default '[]'::jsonb,
  latest_market_date date,
  latest_fundamental_period_end date,
  latest_filing_date date,
  research_reviewed_at timestamptz,
  price_at_research numeric,
  latest_price numeric,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(company_id,as_of_date),
  constraint research_update_plans_action_check
    check (action in ('no_action','market_refresh','valuation_review','fundamentals_refresh','deep_research_refresh')),
  constraint research_update_plans_status_check
    check (status in ('pending','completed','ignored')),
  constraint research_update_plans_priority_check
    check (priority between 0 and 100)
);

create table if not exists public.investor_checklist_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  label text not null,
  category text not null,
  metric_key text,
  evaluation_mode text not null,
  comparison_operator text,
  threshold_value numeric,
  threshold_unit text,
  excluded_modules jsonb not null default '[]'::jsonb,
  hard_filter boolean not null default false,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  constraint investor_checklist_rules_mode_check
    check (evaluation_mode in ('threshold','trend','manual','applicability'))
);

create table if not exists public.investor_checklist_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  rule_id uuid not null references public.investor_checklist_rules(id) on delete cascade,
  as_of_date date not null,
  value_numeric numeric,
  value_text text,
  assessment text not null,
  trend text,
  applicability text not null default 'medium',
  reasoning text,
  source_url text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(company_id,rule_id,as_of_date),
  constraint investor_checklist_results_assessment_check
    check (assessment in ('pass','fail','watch','not_applicable','not_available')),
  constraint investor_checklist_results_applicability_check
    check (applicability in ('high','medium','low','not_applicable'))
);

create table if not exists public.research_v2_sections (
  research_run_id uuid primary key references public.research_runs(id) on delete cascade,
  investment_thesis jsonb not null default '{}'::jsonb,
  financial_quality jsonb not null default '{}'::jsonb,
  fundamental_scorecard jsonb not null default '[]'::jsonb,
  competitive_position jsonb not null default '{}'::jsonb,
  valuation_analysis jsonb not null default '{}'::jsonb,
  historical_valuation jsonb not null default '{}'::jsonb,
  investment_lenses jsonb not null default '{}'::jsonb,
  decision_dashboard jsonb not null default '{}'::jsonb,
  final_conclusion jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists company_metric_history_company_period_idx on public.company_metric_history(company_id,period_end desc);
create index if not exists valuation_history_company_date_idx on public.valuation_history(company_id,trading_date desc);
create index if not exists company_peers_company_active_idx on public.company_peers(company_id,is_active);
create index if not exists peer_metric_snapshots_company_date_idx on public.peer_metric_snapshots(company_id,as_of_date desc);
create index if not exists capital_allocation_history_company_period_idx on public.capital_allocation_history(company_id,period_end desc);
create index if not exists research_update_plans_action_date_idx on public.research_update_plans(action,as_of_date desc);
create index if not exists investor_checklist_results_company_date_idx on public.investor_checklist_results(company_id,as_of_date desc);

alter table public.company_metric_history enable row level security;
alter table public.valuation_history enable row level security;
alter table public.company_peers enable row level security;
alter table public.peer_metric_snapshots enable row level security;
alter table public.capital_allocation_history enable row level security;
alter table public.research_freshness enable row level security;
alter table public.research_update_plans enable row level security;
alter table public.investor_checklist_rules enable row level security;
alter table public.investor_checklist_results enable row level security;
alter table public.research_v2_sections enable row level security;

revoke all on table public.company_metric_history from public,anon,authenticated;
revoke all on table public.valuation_history from public,anon,authenticated;
revoke all on table public.company_peers from public,anon,authenticated;
revoke all on table public.peer_metric_snapshots from public,anon,authenticated;
revoke all on table public.capital_allocation_history from public,anon,authenticated;
revoke all on table public.research_freshness from public,anon,authenticated;
revoke all on table public.research_update_plans from public,anon,authenticated;
revoke all on table public.investor_checklist_rules from public,anon,authenticated;
revoke all on table public.investor_checklist_results from public,anon,authenticated;
revoke all on table public.research_v2_sections from public,anon,authenticated;

grant all on table public.company_metric_history to service_role;
grant all on table public.valuation_history to service_role;
grant all on table public.company_peers to service_role;
grant all on table public.peer_metric_snapshots to service_role;
grant all on table public.capital_allocation_history to service_role;
grant all on table public.research_freshness to service_role;
grant all on table public.research_update_plans to service_role;
grant all on table public.investor_checklist_rules to service_role;
grant all on table public.investor_checklist_results to service_role;
grant all on table public.research_v2_sections to service_role;

insert into public.investor_checklist_rules
(rule_key,label,category,metric_key,evaluation_mode,comparison_operator,threshold_value,threshold_unit,excluded_modules,hard_filter,sort_order,notes)
values
('peg_lt_1','PEG < 1','valuation','peg','threshold','<',1,'x','[]'::jsonb,false,10,'Use only when earnings growth is sufficiently stable.'),
('debt_equity_lt_05','Debt / Equity < 0.5','balance_sheet','debt_to_equity','threshold','<',0.5,'x','["financial_bank"]'::jsonb,false,20,'Industry-conditioned; not a bank capital test.'),
('payout_lt_60','Dividend payout ratio < 60%','capital_return','payout_ratio','threshold','<',60,'percent','[]'::jsonb,false,30,'Mark not applicable for companies without a regular dividend.'),
('dividend_increasing','Dividend increasing','capital_return','dividend_growth','trend',null,null,'percent','[]'::jsonb,false,40,'Evaluate multi-year dividend trend where applicable.'),
('eps_increasing','EPS increasing','growth','eps_growth_1y','trend',null,null,'percent','[]'::jsonb,false,50,'Prefer multi-year and per-share trend rather than one quarter.'),
('current_ratio_gt_15','Current ratio > 1.5','liquidity','current_ratio','threshold','>',1.5,'x','["financial_bank"]'::jsonb,false,60,'Contextual liquidity check, not a universal rejection rule.'),
('quick_ratio_gt_05','Quick ratio > 0.5','liquidity','quick_ratio','threshold','>',0.5,'x','["financial_bank"]'::jsonb,false,70,'Contextual liquidity check.'),
('gross_margin_gt_40','Gross margin > 40%','profitability','gross_margin','threshold','>',40,'percent','["financial_bank"]'::jsonb,false,80,'Compare with company history and industry economics.'),
('net_margin_gt_20','Net margin > 20%','profitability','net_margin','threshold','>',20,'percent','[]'::jsonb,false,90,'Industry-conditioned; not a hard filter.'),
('retained_earnings_increasing','Retained earnings increasing','capital_compounding','retained_earnings','trend',null,null,'USD','[]'::jsonb,false,100,'Interpret alongside buybacks, dividends and acquisitions.'),
('roe_gt_10','ROE > 10%','returns','roe','threshold','>',10,'percent','[]'::jsonb,false,110,'Interpret with leverage and ROIC where available.')
on conflict (rule_key) do update set
  label=excluded.label,category=excluded.category,metric_key=excluded.metric_key,
  evaluation_mode=excluded.evaluation_mode,comparison_operator=excluded.comparison_operator,
  threshold_value=excluded.threshold_value,threshold_unit=excluded.threshold_unit,
  excluded_modules=excluded.excluded_modules,hard_filter=excluded.hard_filter,
  sort_order=excluded.sort_order,notes=excluded.notes,enabled=true;

insert into public.research_freshness(company_id,market_updated_at,fundamentals_updated_at,research_reviewed_at,last_full_refresh_at,updated_at)
select c.id,
  (select max(ms.observed_at) from public.market_snapshots ms where ms.company_id=c.id),
  (select max(fs.observed_at) from public.fundamental_snapshots fs where fs.company_id=c.id),
  (select max(rr.researched_at) from public.research_runs rr where rr.company_id=c.id and rr.status='published'),
  (select max(rr.researched_at) from public.research_runs rr where rr.company_id=c.id and rr.status='published'),
  now()
from public.companies c
on conflict (company_id) do update set
  market_updated_at=excluded.market_updated_at,
  fundamentals_updated_at=excluded.fundamentals_updated_at,
  research_reviewed_at=coalesce(public.research_freshness.research_reviewed_at,excluded.research_reviewed_at),
  last_full_refresh_at=coalesce(public.research_freshness.last_full_refresh_at,excluded.last_full_refresh_at),
  updated_at=now();
