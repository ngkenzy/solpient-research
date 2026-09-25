-- Group A — Trustworthy Research Foundation V1: schema
-- Additive extension of existing historical-integrity and provenance architecture.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

create table if not exists public.research_coverage_states (
  company_id uuid primary key references public.companies(id) on delete restrict,
  coverage_level text not null,
  methodology_version text not null default 'research-coverage-v1',
  eligibility_evidence jsonb not null default '{}'::jsonb,
  reason text not null,
  evaluated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint research_coverage_states_level_check
    check (coverage_level in ('MONITORED','RESEARCHED','DEEP_COVERAGE'))
);

create table if not exists public.research_coverage_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  from_level text,
  to_level text not null,
  methodology_version text not null,
  eligibility_evidence jsonb not null default '{}'::jsonb,
  transition_reason text not null,
  evaluated_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint research_coverage_history_from_check
    check (from_level is null or from_level in ('MONITORED','RESEARCHED','DEEP_COVERAGE')),
  constraint research_coverage_history_to_check
    check (to_level in ('MONITORED','RESEARCHED','DEEP_COVERAGE'))
);

create index if not exists research_coverage_history_company_time_idx
  on public.research_coverage_history(company_id,evaluated_at desc,created_at desc);

create table if not exists public.research_freshness_policies (
  methodology_version text not null,
  component_key text not null,
  max_check_age interval,
  max_review_age interval,
  evidence_triggers_review boolean not null default false,
  required_for_deep_coverage boolean not null default false,
  description text not null,
  created_at timestamptz not null default now(),
  primary key(methodology_version,component_key)
);

create table if not exists public.research_component_freshness (
  company_id uuid not null references public.companies(id) on delete restrict,
  component_key text not null,
  last_checked_at timestamptz,
  latest_evidence_at timestamptz,
  last_reviewed_at timestamptz,
  last_recalculated_at timestamptz,
  last_published_at timestamptz,
  evidence_since_publication boolean not null default false,
  status text not null default 'UNKNOWN',
  next_due_at timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text,
  policy_version text not null default 'research-freshness-v1',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(company_id,component_key),
  constraint research_component_freshness_status_check
    check (status in ('CURRENT','STALE','REVIEW_DUE','NEW_EVIDENCE','NOT_SUPPORTED','UNKNOWN'))
);

create index if not exists research_component_freshness_status_due_idx
  on public.research_component_freshness(status,next_due_at);
create index if not exists research_component_freshness_company_status_idx
  on public.research_component_freshness(company_id,status);

insert into public.research_freshness_policies(
  methodology_version,component_key,max_check_age,max_review_age,
  evidence_triggers_review,required_for_deep_coverage,description
)
values
  ('research-freshness-v1','market_data',interval '3 days',null,false,true,
   'Latest market observation. Market changes alone do not automatically invalidate the thesis.'),
  ('research-freshness-v1','sec_filings',interval '2 days',null,true,true,
   'SEC filing monitor check state, separate from whether a new filing was found.'),
  ('research-freshness-v1','fundamentals',interval '2 days',null,true,true,
   'Fundamental ingestion/check state and latest normalized operating evidence.'),
  ('research-freshness-v1','earnings_guidance',interval '2 days',null,true,false,
   'Earnings/guidance evidence where a supported source is available.'),
  ('research-freshness-v1','valuation',interval '7 days',interval '30 days',false,true,
   'Point-in-time valuation input/recalculation state.'),
  ('research-freshness-v1','thesis_review',null,interval '90 days',true,true,
   'Reviewed thesis state. New thesis-relevant evidence requires review.'),
  ('research-freshness-v1','published_research',null,interval '180 days',true,true,
   'Latest immutable published Research version and its cutoff.'),
  ('research-freshness-v1','ownership',interval '14 days',null,false,false,
   'Supported insider/institutional/political ownership evidence.'),
  ('research-freshness-v1','capital_allocation',interval '120 days',null,true,false,
   'Capital-allocation history and related normalized evidence.')
on conflict (methodology_version,component_key) do nothing;

create table if not exists public.research_dependency_rules (
  id uuid primary key default gen_random_uuid(),
  methodology_version text not null,
  rule_key text not null,
  match_module text,
  match_metric_key text,
  affected_components text[] not null,
  required_action text not null,
  priority integer not null,
  rationale text not null,
  created_at timestamptz not null default now(),
  unique(methodology_version,rule_key),
  constraint research_dependency_rules_priority_check check (priority between 0 and 100),
  constraint research_dependency_rules_match_check
    check (match_module is not null or match_metric_key is not null),
  constraint research_dependency_rules_action_check
    check (required_action in (
      'market_refresh','evidence_refresh','valuation_review','research_review',
      'ownership_refresh','capital_allocation_review'
    ))
);

insert into public.research_dependency_rules(
  methodology_version,rule_key,match_module,match_metric_key,
  affected_components,required_action,priority,rationale
)
values
  ('research-dependency-v1','revenue',null,'revenue',
   array['fundamentals','thesis_review','valuation'],'research_review',85,
   'Revenue changes can alter growth assumptions, thesis state, and valuation.'),
  ('research-dependency-v1','revenue-growth-1y',null,'revenue_growth_1y',
   array['fundamentals','thesis_review','valuation'],'research_review',85,
   'Revenue-growth changes map directly to growth thesis variables and valuation assumptions.'),
  ('research-dependency-v1','revenue-growth-yoy',null,'revenue_growth_yoy',
   array['fundamentals','thesis_review','valuation'],'research_review',85,
   'Year-over-year growth changes can alter thesis and valuation.'),
  ('research-dependency-v1','free-cash-flow',null,'free_cash_flow',
   array['fundamentals','thesis_review','valuation'],'research_review',85,
   'Free cash flow supports cash-generation thesis and valuation.'),
  ('research-dependency-v1','fcf-margin',null,'fcf_margin',
   array['fundamentals','thesis_review','valuation'],'research_review',85,
   'FCF margin changes can alter quality and valuation conclusions.'),
  ('research-dependency-v1','eps-diluted',null,'eps_diluted',
   array['fundamentals','thesis_review','valuation'],'research_review',80,
   'EPS changes can alter earnings trajectory and valuation.'),
  ('research-dependency-v1','total-debt',null,'total_debt',
   array['fundamentals','thesis_review','valuation'],'research_review',80,
   'Debt changes can affect financial-strength thesis and valuation.'),
  ('research-dependency-v1','debt-to-equity',null,'debt_to_equity',
   array['fundamentals','thesis_review'],'research_review',75,
   'Leverage changes can affect financial-strength thesis.'),
  ('research-dependency-v1','shares-outstanding',null,'shares_outstanding',
   array['fundamentals','capital_allocation','valuation'],'capital_allocation_review',75,
   'Share-count changes can indicate dilution/buybacks and alter per-share valuation.'),
  ('research-dependency-v1','valuation-module','valuation_history',null,
   array['valuation'],'valuation_review',60,
   'Valuation-history changes require targeted valuation review, not full Research regeneration.'),
  ('research-dependency-v1','consensus-module','consensus',null,
   array['earnings_guidance','thesis_review','valuation'],'research_review',75,
   'Consensus changes may alter expectations but remain distinct from reported facts.'),
  ('research-dependency-v1','capital-allocation-module','capital_allocation',null,
   array['capital_allocation','thesis_review'],'capital_allocation_review',70,
   'Capital allocation changes can affect thesis and management assessment.'),
  ('research-dependency-v1','capital-activity-module','capital_activity',null,
   array['ownership'],'ownership_refresh',50,
   'Ownership activity is monitored separately and should not blindly invalidate full Research.'),
  ('research-dependency-v1','intelligence-event-module','intelligence_event',null,
   array['thesis_review'],'research_review',70,
   'Structured intelligence events require thesis relevance review.')
on conflict (methodology_version,rule_key) do nothing;

create table if not exists public.research_component_invalidations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  normalized_fact_id uuid references public.normalized_facts(id) on delete restrict,
  company_change_event_id uuid references public.company_change_events(id) on delete restrict,
  component_key text not null,
  reason text not null,
  severity text not null default 'notable',
  methodology_version text not null default 'research-dependency-v1',
  invalidated_at timestamptz not null default now(),
  status text not null default 'open',
  resolved_at timestamptz,
  resulting_research_run_id uuid references public.research_runs(id) on delete restrict,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint research_component_invalidations_severity_check
    check (severity in ('notable','material','high')),
  constraint research_component_invalidations_status_check
    check (status in ('open','queued','resolved','dismissed')),
  constraint research_component_invalidations_source_check
    check (normalized_fact_id is not null or company_change_event_id is not null)
);

create unique index if not exists research_component_invalidations_fact_component_uniq
  on public.research_component_invalidations(normalized_fact_id,component_key,methodology_version)
  where normalized_fact_id is not null;
create index if not exists research_component_invalidations_company_status_idx
  on public.research_component_invalidations(company_id,status,invalidated_at desc);

create table if not exists public.research_maintenance_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  trigger_type text not null,
  trigger_evidence_type text,
  trigger_evidence_id uuid,
  trigger_payload jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  affected_components text[] not null default '{}'::text[],
  priority integer not null default 50,
  required_action text not null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  resulting_research_run_id uuid references public.research_runs(id) on delete restrict,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint research_maintenance_queue_priority_check check (priority between 0 and 100),
  constraint research_maintenance_queue_action_check check (required_action in (
    'market_refresh','evidence_refresh','valuation_review','research_review',
    'ownership_refresh','capital_allocation_review'
  )),
  constraint research_maintenance_queue_status_check check (
    status in ('queued','running','succeeded','failed','cancelled')
  )
);

create index if not exists research_maintenance_queue_claim_idx
  on public.research_maintenance_queue(status,priority desc,detected_at asc);
create index if not exists research_maintenance_queue_company_idx
  on public.research_maintenance_queue(company_id,status,detected_at desc);

create table if not exists public.research_maintenance_attempts (
  id uuid primary key default gen_random_uuid(),
  queue_item_id uuid not null references public.research_maintenance_queue(id) on delete restrict,
  attempt_number integer not null,
  worker_id text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running',
  error_message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(queue_item_id,attempt_number),
  constraint research_maintenance_attempts_status_check
    check (status in ('running','succeeded','failed','cancelled'))
);

create index if not exists research_maintenance_attempts_item_idx
  on public.research_maintenance_attempts(queue_item_id,attempt_number desc);

alter table public.research_coverage_states enable row level security;
alter table public.research_coverage_history enable row level security;
alter table public.research_freshness_policies enable row level security;
alter table public.research_component_freshness enable row level security;
alter table public.research_dependency_rules enable row level security;
alter table public.research_component_invalidations enable row level security;
alter table public.research_maintenance_queue enable row level security;
alter table public.research_maintenance_attempts enable row level security;

revoke all on table
  public.research_coverage_states,
  public.research_coverage_history,
  public.research_freshness_policies,
  public.research_component_freshness,
  public.research_dependency_rules,
  public.research_component_invalidations,
  public.research_maintenance_queue,
  public.research_maintenance_attempts
from public,anon,authenticated;

grant select,insert,update,delete on table
  public.research_coverage_states,
  public.research_component_freshness,
  public.research_component_invalidations,
  public.research_maintenance_queue,
  public.research_maintenance_attempts
to service_role;

grant select on table
  public.research_freshness_policies,
  public.research_dependency_rules
to service_role;

grant select,insert on table public.research_coverage_history to service_role;

create policy "service role manages research coverage states"
on public.research_coverage_states for all to service_role using (true) with check (true);
create policy "service role reads research coverage history"
on public.research_coverage_history for select to service_role using (true);
create policy "service role inserts research coverage history"
on public.research_coverage_history for insert to service_role with check (true);
create policy "service role reads research freshness policies"
on public.research_freshness_policies for select to service_role using (true);
create policy "service role manages research component freshness"
on public.research_component_freshness for all to service_role using (true) with check (true);
create policy "service role reads research dependency rules"
on public.research_dependency_rules for select to service_role using (true);
create policy "service role manages research component invalidations"
on public.research_component_invalidations for all to service_role using (true) with check (true);
create policy "service role manages research maintenance queue"
on public.research_maintenance_queue for all to service_role using (true) with check (true);
create policy "service role manages research maintenance attempts"
on public.research_maintenance_attempts for all to service_role using (true) with check (true);

drop trigger if exists research_coverage_history_append_only_guard on public.research_coverage_history;
create trigger research_coverage_history_append_only_guard
before update or delete on public.research_coverage_history
for each row execute function private.guard_append_only_history();

drop trigger if exists research_freshness_policies_append_only_guard on public.research_freshness_policies;
create trigger research_freshness_policies_append_only_guard
before update or delete on public.research_freshness_policies
for each row execute function private.guard_append_only_history();

drop trigger if exists research_dependency_rules_append_only_guard on public.research_dependency_rules;
create trigger research_dependency_rules_append_only_guard
before update or delete on public.research_dependency_rules
for each row execute function private.guard_append_only_history();

comment on table public.research_coverage_states is
  'Authoritative current Group A coverage state. Eligibility is deterministic and versioned.';
comment on table public.research_coverage_history is
  'Append-only coverage transition history for historical reconstruction.';
comment on table public.research_component_freshness is
  'Component freshness separates source checks, evidence arrival, review, recalculation, and publication.';
comment on table public.research_component_invalidations is
  'Targeted dependency invalidation caused by changed canonical facts or structured company events.';
comment on table public.research_maintenance_queue is
  'Authoritative targeted Research maintenance queue; full Research regeneration is never the default.';
