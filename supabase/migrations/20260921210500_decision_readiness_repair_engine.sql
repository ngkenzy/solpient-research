-- Decision Readiness Repair Engine
-- Internal operational planner. No public read policy.

create table if not exists public.decision_readiness_repair_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  research_run_id uuid references public.research_runs(id) on delete set null,
  ranking_history_id uuid references public.ranking_history(id) on delete set null,
  methodology_version text not null,
  ranking_ranked_at timestamptz,
  current_state text not null check (current_state in ('building','research_ready','decision_ready')),
  next_state text not null check (next_state in ('research_ready','decision_ready')),
  decision_score numeric,
  evidence_confidence numeric,
  company_priority integer not null check (company_priority between 0 and 100),
  research_ready_reachable boolean not null default false,
  decision_ready_reachable boolean not null default false,
  research_ready_plan jsonb not null default '{}'::jsonb,
  decision_ready_plan jsonb not null default '{}'::jsonb,
  plan_hash text not null,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id)
);

create table if not exists public.decision_readiness_repair_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  repair_key text not null,
  layer text not null,
  field text not null,
  repair_type text not null,
  automation_mode text not null check (automation_mode in ('auto','scheduled','manual','monitor')),
  runner text,
  target_state text not null check (target_state in ('research_ready','decision_ready')),
  current_value jsonb,
  target_value jsonb,
  direct_gate boolean not null default false,
  phase2_sensitive boolean not null default false,
  priority integer not null check (priority between 0 and 100),
  sequence_to_next integer,
  sequence_to_decision integer,
  estimated_evidence_gain numeric,
  projected_evidence_confidence numeric,
  projected_readiness_state text,
  instruction text not null,
  linked_repair_job_id uuid references public.research_repair_jobs(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,repair_key)
);

create index if not exists decision_readiness_plans_priority_idx
  on public.decision_readiness_repair_plans(current_state,company_priority desc,updated_at desc);
create index if not exists decision_readiness_items_priority_idx
  on public.decision_readiness_repair_items(priority desc,automation_mode,updated_at desc);
create index if not exists decision_readiness_items_company_idx
  on public.decision_readiness_repair_items(company_id,sequence_to_next,sequence_to_decision);

alter table public.decision_readiness_repair_plans enable row level security;
alter table public.decision_readiness_repair_items enable row level security;

grant select,insert,update,delete on public.decision_readiness_repair_plans to service_role;
grant select,insert,update,delete on public.decision_readiness_repair_items to service_role;

drop policy if exists "service role manages decision readiness repair plans" on public.decision_readiness_repair_plans;
create policy "service role manages decision readiness repair plans"
on public.decision_readiness_repair_plans for all
to service_role using (true) with check (true);

drop policy if exists "service role manages decision readiness repair items" on public.decision_readiness_repair_items;
create policy "service role manages decision readiness repair items"
on public.decision_readiness_repair_items for all
to service_role using (true) with check (true);

comment on table public.decision_readiness_repair_plans is
  'Internal current-state plans that translate Phase 3 readiness gates into ordered evidence repair paths.';
comment on table public.decision_readiness_repair_items is
  'Internal prioritized evidence repair actions linked to existing research_repair_jobs when possible.';
