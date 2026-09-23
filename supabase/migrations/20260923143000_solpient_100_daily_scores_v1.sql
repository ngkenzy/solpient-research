-- Solpient 100 Daily Analysis Score V1
-- Private ledger for the same Phase 3 decision-ranking methodology before publication.
-- No public SELECT policy is intentionally created.

create table if not exists public.solpient_100_daily_scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ticker text not null,
  scored_at timestamptz not null,
  rank integer not null check (rank > 0),
  source_kind text not null check (source_kind in ('published','private_review','building')),
  source_research_run_id uuid references public.research_runs(id) on delete set null,
  source_draft_id uuid references public.baseline_drafts(id) on delete set null,
  source_composition_id uuid references public.research_compositions(id) on delete set null,
  methodology_version text not null,
  readiness_methodology_version text not null,
  decision_score numeric check (decision_score between 0 and 100),
  business_quality_score numeric check (business_quality_score between 0 and 100),
  business_quality_coverage_pct numeric check (business_quality_coverage_pct between 0 and 100),
  investment_opportunity_score numeric check (investment_opportunity_score between 0 and 100),
  opportunity_coverage_pct numeric check (opportunity_coverage_pct between 0 and 100),
  evidence_confidence_score numeric check (evidence_confidence_score between 0 and 100),
  evidence_component_coverage_pct numeric check (evidence_component_coverage_pct between 0 and 100),
  readiness_state text not null check (readiness_state in ('building','research_ready','decision_ready')),
  readiness_tier integer not null check (readiness_tier in (0,1,2)),
  price numeric,
  base_fair_value numeric,
  score_inputs jsonb not null default '{}'::jsonb,
  readiness_reasons jsonb not null default '{}'::jsonb,
  analysis_summary jsonb not null default '{}'::jsonb,
  snapshot_hash text not null,
  created_at timestamptz not null default now(),
  unique(company_id, scored_at)
);

create index if not exists solpient_100_daily_scores_latest_idx
  on public.solpient_100_daily_scores(scored_at desc,rank asc);

create index if not exists solpient_100_daily_scores_company_idx
  on public.solpient_100_daily_scores(company_id,scored_at desc);

alter table public.solpient_100_daily_scores enable row level security;

comment on table public.solpient_100_daily_scores is
  'Private daily score ledger for all governed Solpient 100 members. Uses decision-ranking-v1; unreleased research stays outside public ranking_history.';
comment on column public.solpient_100_daily_scores.source_kind is
  'published uses the latest immutable research run; private_review uses the latest private Composer V2 review package; building means analysis is not yet sufficient to score.';
comment on column public.solpient_100_daily_scores.analysis_summary is
  'Compact private analysis snapshot for the review workbench. Full research remains in the governed draft/review package.';
