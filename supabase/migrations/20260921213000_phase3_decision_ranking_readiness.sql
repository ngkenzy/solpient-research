-- Solpient 100 Phase 3: Decision Ranking + Readiness
-- Extends the existing immutable ranking_history ledger; does not replace legacy overall_score.

alter table public.ranking_history
  add column if not exists business_quality_score numeric,
  add column if not exists business_quality_coverage_pct numeric,
  add column if not exists investment_opportunity_score numeric,
  add column if not exists opportunity_coverage_pct numeric,
  add column if not exists evidence_confidence_score numeric,
  add column if not exists evidence_component_coverage_pct numeric,
  add column if not exists decision_score numeric,
  add column if not exists readiness_state text,
  add column if not exists readiness_tier integer,
  add column if not exists readiness_methodology_version text,
  add column if not exists score_inputs jsonb not null default '{}'::jsonb,
  add column if not exists readiness_reasons jsonb not null default '{}'::jsonb;

alter table public.ranking_explanations
  add column if not exists decision_score_delta numeric,
  add column if not exists business_quality_delta numeric,
  add column if not exists opportunity_delta numeric,
  add column if not exists evidence_confidence_delta numeric,
  add column if not exists previous_readiness_state text,
  add column if not exists readiness_change text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='ranking_history_phase3_scores_check'
  ) then
    alter table public.ranking_history
      add constraint ranking_history_phase3_scores_check check (
        (business_quality_score is null or business_quality_score between 0 and 100) and
        (business_quality_coverage_pct is null or business_quality_coverage_pct between 0 and 100) and
        (investment_opportunity_score is null or investment_opportunity_score between 0 and 100) and
        (opportunity_coverage_pct is null or opportunity_coverage_pct between 0 and 100) and
        (evidence_confidence_score is null or evidence_confidence_score between 0 and 100) and
        (evidence_component_coverage_pct is null or evidence_component_coverage_pct between 0 and 100) and
        (decision_score is null or decision_score between 0 and 100)
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname='ranking_history_readiness_state_check'
  ) then
    alter table public.ranking_history
      add constraint ranking_history_readiness_state_check check (
        readiness_state is null or readiness_state in ('building','research_ready','decision_ready')
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname='ranking_history_readiness_tier_check'
  ) then
    alter table public.ranking_history
      add constraint ranking_history_readiness_tier_check check (
        readiness_tier is null or readiness_tier in (0,1,2)
      ) not valid;
  end if;
end $$;

create index if not exists ranking_history_phase3_latest_idx
  on public.ranking_history(ranked_at desc,readiness_tier desc,decision_score desc);

create index if not exists ranking_history_phase3_company_idx
  on public.ranking_history(company_id,ranked_at desc,readiness_tier desc,decision_score desc);

comment on column public.ranking_history.overall_score is
  'Legacy published research overall score retained for compatibility. Phase 3 ranking order uses readiness tier then decision_score.';
comment on column public.ranking_history.business_quality_score is
  'Phase 3 business-quality dimension. Missing components reduce component coverage rather than defaulting to a neutral score.';
comment on column public.ranking_history.investment_opportunity_score is
  'Phase 3 opportunity dimension from expected return, valuation gap, margin of safety and downside protection.';
comment on column public.ranking_history.evidence_confidence_score is
  'Phase 3 evidence-confidence dimension derived from explicit coverage layers and research freshness.';
comment on column public.ranking_history.decision_score is
  'Attractiveness score = 40% Business Quality + 60% Investment Opportunity. Evidence Confidence gates readiness rather than being multiplied into merit.';
comment on column public.ranking_history.readiness_state is
  'building, research_ready, or decision_ready. Readiness gates ranking tiers and must not be interpreted as a buy/sell recommendation.';
comment on column public.ranking_history.score_inputs is
  'Frozen transparent Phase 3 score inputs, component contributions and methodology metadata for this ranking snapshot.';
comment on column public.ranking_history.readiness_reasons is
  'Frozen blockers/warnings explaining why the company is Building, Research Ready, or Decision Ready.';
