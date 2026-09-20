-- SOLPIENT intelligence loop: normalized capital activity, evidence review queue, and explainable rankings.

create table if not exists public.capital_activity (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  activity_type text not null check (activity_type in ('insider','institutional','political')),
  actor_name text not null,
  actor_detail text,
  action text not null,
  shares numeric,
  price numeric,
  value numeric,
  change_pct numeric,
  amount_range text,
  transaction_date date,
  disclosure_date date,
  position_date date,
  source_url text,
  provider text not null default 'manual',
  source_key text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(provider, source_key)
);

create index if not exists capital_activity_company_disclosure_idx
  on public.capital_activity(company_id, disclosure_date desc);
create index if not exists capital_activity_type_disclosure_idx
  on public.capital_activity(activity_type, disclosure_date desc);
create index if not exists capital_activity_position_idx
  on public.capital_activity(company_id, position_date desc);

create table if not exists public.intelligence_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_kind text not null check (source_kind in ('filing','capital_activity','research_change','manual')),
  source_id text not null,
  event_type text not null,
  occurred_at date,
  disclosed_at timestamptz,
  title text not null,
  summary text,
  materiality text not null default 'review' check (materiality in ('info','review','high')),
  review_status text not null default 'open' check (review_status in ('open','reviewed','incorporated','dismissed')),
  research_run_id uuid references public.research_runs(id) on delete set null,
  source_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_kind, source_id)
);

create index if not exists intelligence_events_review_idx
  on public.intelligence_events(review_status, disclosed_at desc);
create index if not exists intelligence_events_company_idx
  on public.intelligence_events(company_id, disclosed_at desc);

create table if not exists public.ranking_explanations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ranking_history_id uuid not null references public.ranking_history(id) on delete cascade,
  previous_rank integer,
  rank_delta integer,
  score_delta numeric,
  price_delta_pct numeric,
  valuation_gap_delta_pct numeric,
  explanation text not null,
  drivers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(ranking_history_id)
);

create index if not exists ranking_explanations_company_idx
  on public.ranking_explanations(company_id, created_at desc);

alter table public.capital_activity enable row level security;
alter table public.intelligence_events enable row level security;
alter table public.ranking_explanations enable row level security;

drop policy if exists "public read capital activity" on public.capital_activity;
create policy "public read capital activity"
  on public.capital_activity for select to anon, authenticated using (true);

drop policy if exists "public read intelligence events" on public.intelligence_events;
create policy "public read intelligence events"
  on public.intelligence_events for select to anon, authenticated using (true);

drop policy if exists "public read ranking explanations" on public.ranking_explanations;
create policy "public read ranking explanations"
  on public.ranking_explanations for select to anon, authenticated using (true);

revoke all on table public.capital_activity from anon, authenticated;
revoke all on table public.intelligence_events from anon, authenticated;
revoke all on table public.ranking_explanations from anon, authenticated;

grant select on table public.capital_activity to anon, authenticated;
grant select on table public.intelligence_events to anon, authenticated;
grant select on table public.ranking_explanations to anon, authenticated;

grant all on table public.capital_activity to service_role;
grant all on table public.intelligence_events to service_role;
grant all on table public.ranking_explanations to service_role;
