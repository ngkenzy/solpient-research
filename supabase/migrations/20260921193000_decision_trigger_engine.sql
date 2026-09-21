create table if not exists public.decision_triggers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  trigger_key text not null,
  trigger_group text not null check (trigger_group in ('valuation','return','thesis','data_quality')),
  label text not null,
  metric_key text,
  comparator text check (comparator is null or comparator in ('<=','>=','<','>','=','manual')),
  threshold_value numeric,
  threshold_unit text,
  current_value numeric,
  current_text text,
  decision_effect text not null check (decision_effect in ('more_attractive','re_evaluate','thesis_breaker','monitor')),
  severity text not null check (severity in ('info','material','high')),
  evaluation_status text not null check (evaluation_status in ('armed','triggered','monitor','needs_review','unavailable')),
  rationale text not null,
  source_kind text not null,
  source_ref text,
  metadata jsonb not null default '{}'::jsonb,
  first_triggered_at timestamptz,
  last_evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(research_run_id,trigger_key)
);

create index if not exists decision_triggers_company_status_idx
  on public.decision_triggers(company_id,evaluation_status,severity,updated_at desc);
create index if not exists decision_triggers_effect_idx
  on public.decision_triggers(decision_effect,evaluation_status,updated_at desc);

alter table public.decision_triggers enable row level security;

grant select on public.decision_triggers to anon, authenticated;
grant select,insert,update,delete on public.decision_triggers to service_role;

drop policy if exists "public read decision triggers" on public.decision_triggers;
create policy "public read decision triggers"
on public.decision_triggers for select
to anon,authenticated using (true);

drop policy if exists "service role manages decision triggers" on public.decision_triggers;
create policy "service role manages decision triggers"
on public.decision_triggers for all
to service_role using (true) with check (true);
