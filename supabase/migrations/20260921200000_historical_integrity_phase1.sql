-- Solpient 100 Phase 1: Historical Integrity + Authoritative Publication
-- Reviewed Research Standard v2 publication becomes atomic; historical ledgers become append-only.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

-- Root publication/correction metadata.
alter table public.research_runs
  add column if not exists source_draft_id uuid references public.baseline_drafts(id) on delete restrict,
  add column if not exists source_review_id uuid references public.baseline_reviews(id) on delete restrict,
  add column if not exists source_composition_id uuid references public.research_compositions(id) on delete restrict,
  add column if not exists supersedes_id uuid references public.research_runs(id) on delete restrict,
  add column if not exists correction_reason text,
  add column if not exists corrected_at timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists publication_path text,
  add column if not exists integrity_version text,
  add column if not exists publication_engine_version text,
  add column if not exists methodology_version text,
  add column if not exists hash_algorithm text,
  add column if not exists canonicalization_version text,
  add column if not exists evidence_hash text,
  add column if not exists normalized_inputs_hash text,
  add column if not exists valuation_inputs_hash text,
  add column if not exists composition_hash text,
  add column if not exists published_output_hash text;

create unique index if not exists research_runs_supersedes_once_idx
  on public.research_runs(supersedes_id) where supersedes_id is not null;

alter table public.prediction_snapshots
  add column if not exists locked_at timestamptz,
  add column if not exists integrity_version text,
  add column if not exists hash_algorithm text,
  add column if not exists canonicalization_version text,
  add column if not exists integrity_hash text,
  add column if not exists supersedes_id uuid references public.prediction_snapshots(id) on delete restrict,
  add column if not exists correction_reason text,
  add column if not exists corrected_at timestamptz;

create unique index if not exists prediction_snapshots_supersedes_once_idx
  on public.prediction_snapshots(supersedes_id) where supersedes_id is not null;

alter table public.realized_outcomes
  add column if not exists supersedes_id uuid references public.realized_outcomes(id) on delete restrict,
  add column if not exists correction_reason text,
  add column if not exists corrected_at timestamptz,
  add column if not exists integrity_version text,
  add column if not exists integrity_hash text;

create unique index if not exists realized_outcomes_supersedes_once_idx
  on public.realized_outcomes(supersedes_id) where supersedes_id is not null;

alter table public.prediction_scores
  add column if not exists methodology_version text not null default 'score-v1',
  add column if not exists integrity_version text,
  add column if not exists integrity_hash text;

alter table public.ranking_history
  add column if not exists methodology_version text not null default 'legacy-unversioned',
  add column if not exists integrity_version text,
  add column if not exists hash_algorithm text,
  add column if not exists canonicalization_version text,
  add column if not exists snapshot_hash text,
  add column if not exists supersedes_id uuid references public.ranking_history(id) on delete restrict,
  add column if not exists correction_reason text,
  add column if not exists corrected_at timestamptz;

create unique index if not exists ranking_history_supersedes_once_idx
  on public.ranking_history(supersedes_id) where supersedes_id is not null;

-- Hash-format checks are NOT VALID so legacy rows are not rejected retroactively.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='research_runs_integrity_hash_format_check') then
    alter table public.research_runs add constraint research_runs_integrity_hash_format_check check (
      (evidence_hash is null or evidence_hash ~ '^[0-9a-f]{64}$') and
      (normalized_inputs_hash is null or normalized_inputs_hash ~ '^[0-9a-f]{64}$') and
      (valuation_inputs_hash is null or valuation_inputs_hash ~ '^[0-9a-f]{64}$') and
      (composition_hash is null or composition_hash ~ '^[0-9a-f]{64}$') and
      (published_output_hash is null or published_output_hash ~ '^[0-9a-f]{64}$')
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='prediction_snapshots_integrity_hash_format_check') then
    alter table public.prediction_snapshots add constraint prediction_snapshots_integrity_hash_format_check
      check (integrity_hash is null or integrity_hash ~ '^[0-9a-f]{64}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='realized_outcomes_integrity_hash_format_check') then
    alter table public.realized_outcomes add constraint realized_outcomes_integrity_hash_format_check
      check (integrity_hash is null or integrity_hash ~ '^[0-9a-f]{64}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='prediction_scores_integrity_hash_format_check') then
    alter table public.prediction_scores add constraint prediction_scores_integrity_hash_format_check
      check (integrity_hash is null or integrity_hash ~ '^[0-9a-f]{64}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='ranking_history_snapshot_hash_format_check') then
    alter table public.ranking_history add constraint ranking_history_snapshot_hash_format_check
      check (snapshot_hash is null or snapshot_hash ~ '^[0-9a-f]{64}$') not valid;
  end if;
end $$;

-- Seal existing prediction and ranking rows from the migration forward.
-- These legacy hashes certify state at sealing time, not before Phase 1.
update public.prediction_snapshots ps
set locked_at = coalesce(ps.locked_at, now()),
    integrity_version = coalesce(ps.integrity_version, 'legacy-sealed-v1'),
    hash_algorithm = coalesce(ps.hash_algorithm, 'sha256'),
    canonicalization_version = coalesce(ps.canonicalization_version, 'postgres-jsonb-v1'),
    integrity_hash = coalesce(ps.integrity_hash,
      pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'company_id',ps.company_id,'research_run_id',ps.research_run_id,
          'prediction_key',ps.prediction_key,'predicted_at',ps.predicted_at,
          'model_version',ps.model_version,'horizon_months',ps.horizon_months,
          'benchmark_ticker',ps.benchmark_ticker,'price_at_prediction',ps.price_at_prediction,
          'benchmark_price_at_prediction',ps.benchmark_price_at_prediction,
          'confidence',ps.confidence,'thesis_status',ps.thesis_status,'rationale',ps.rationale,
          'feature_snapshot',ps.feature_snapshot,'source_snapshot',ps.source_snapshot
        )::text,'UTF8'),'sha256'),'hex'))
where ps.locked_at is null or ps.integrity_hash is null;

update public.ranking_history rh
set integrity_version = coalesce(rh.integrity_version,'legacy-sealed-v1'),
    hash_algorithm = coalesce(rh.hash_algorithm,'sha256'),
    canonicalization_version = coalesce(rh.canonicalization_version,'postgres-jsonb-v1'),
    snapshot_hash = coalesce(rh.snapshot_hash,
      pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'company_id',rh.company_id,'research_run_id',rh.research_run_id,
          'ranked_at',rh.ranked_at,'rank',rh.rank,'overall_score',rh.overall_score,
          'price',rh.price,'base_fair_value',rh.base_fair_value,
          'methodology_version',rh.methodology_version
        )::text,'UTF8'),'sha256'),'hex'))
where rh.snapshot_hash is null;

-- Destructive historical cascades become RESTRICT.
do $$
declare rec record;
begin
  for rec in
    select * from (values
      ('research_runs','research_runs_company_id_fkey','company_id','companies','id'),
      ('research_runs','research_runs_previous_run_id_fkey','previous_run_id','research_runs','id'),
      ('financial_metrics','financial_metrics_research_run_id_fkey','research_run_id','research_runs','id'),
      ('scores','scores_research_run_id_fkey','research_run_id','research_runs','id'),
      ('valuations','valuations_research_run_id_fkey','research_run_id','research_runs','id'),
      ('business_assessments','business_assessments_research_run_id_fkey','research_run_id','research_runs','id'),
      ('metric_observations','metric_observations_research_run_id_fkey','research_run_id','research_runs','id'),
      ('risk_register','risk_register_research_run_id_fkey','research_run_id','research_runs','id'),
      ('expected_return_scenarios','expected_return_scenarios_research_run_id_fkey','research_run_id','research_runs','id'),
      ('thesis_variables','thesis_variables_research_run_id_fkey','research_run_id','research_runs','id'),
      ('sources','sources_research_run_id_fkey','research_run_id','research_runs','id'),
      ('research_v2_sections','research_v2_sections_research_run_id_fkey','research_run_id','research_runs','id'),
      ('research_changes','research_changes_company_id_fkey','company_id','companies','id'),
      ('research_changes','research_changes_current_run_id_fkey','current_run_id','research_runs','id'),
      ('research_changes','research_changes_previous_run_id_fkey','previous_run_id','research_runs','id'),
      ('prediction_snapshots','prediction_snapshots_company_id_fkey','company_id','companies','id'),
      ('prediction_snapshots','prediction_snapshots_research_run_id_fkey','research_run_id','research_runs','id'),
      ('prediction_outcomes','prediction_outcomes_prediction_snapshot_id_fkey','prediction_snapshot_id','prediction_snapshots','id'),
      ('realized_outcomes','realized_outcomes_prediction_outcome_id_fkey','prediction_outcome_id','prediction_outcomes','id'),
      ('prediction_scores','prediction_scores_prediction_outcome_id_fkey','prediction_outcome_id','prediction_outcomes','id'),
      ('prediction_scores','prediction_scores_realized_outcome_id_fkey','realized_outcome_id','realized_outcomes','id'),
      ('ranking_history','ranking_history_company_id_fkey','company_id','companies','id'),
      ('ranking_history','ranking_history_research_run_id_fkey','research_run_id','research_runs','id'),
      ('ranking_explanations','ranking_explanations_company_id_fkey','company_id','companies','id'),
      ('ranking_explanations','ranking_explanations_ranking_history_id_fkey','ranking_history_id','ranking_history','id')
    ) as x(table_name,constraint_name,column_name,ref_table,ref_column)
  loop
    execute format('alter table public.%I drop constraint if exists %I',rec.table_name,rec.constraint_name);
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.%I(%I) on delete restrict',
      rec.table_name,rec.constraint_name,rec.column_name,rec.ref_table,rec.ref_column
    );
  end loop;
end $$;

-- Research history guards.
create or replace function private.guard_research_run_history()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.status='published'
       and coalesce(current_setting('solpient.authoritative_publication',true),'')<>'on' then
      raise exception 'Published research must be created through publish_reviewed_research_v2().';
    end if;
    return new;
  end if;
  if old.status='published' then
    raise exception 'Published research history is immutable; publish a superseding research version instead.';
  end if;
  if tg_op='UPDATE' and new.status='published'
     and coalesce(current_setting('solpient.authoritative_publication',true),'')<>'on' then
    raise exception 'Research can only become published through publish_reviewed_research_v2().';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists research_runs_history_guard on public.research_runs;
create trigger research_runs_history_guard before insert or update or delete on public.research_runs
for each row execute function private.guard_research_run_history();

create or replace function private.guard_research_child_history()
returns trigger language plpgsql set search_path='' as $$
declare v_run_id uuid; v_status text;
begin
  if tg_op='DELETE' then v_run_id := (to_jsonb(old)->>tg_argv[0])::uuid;
  else v_run_id := (to_jsonb(new)->>tg_argv[0])::uuid; end if;
  select status into v_status from public.research_runs where id=v_run_id;
  if v_status='published' then
    if tg_op='INSERT'
       and coalesce(current_setting('solpient.authoritative_publication',true),'')='on' then
      return new;
    end if;
    raise exception 'Published research package rows are immutable; create a superseding research version.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

do $$
declare rec record;
begin
  for rec in select * from (values
    ('financial_metrics','research_run_id'),('scores','research_run_id'),
    ('valuations','research_run_id'),('business_assessments','research_run_id'),
    ('metric_observations','research_run_id'),('risk_register','research_run_id'),
    ('expected_return_scenarios','research_run_id'),('thesis_variables','research_run_id'),
    ('sources','research_run_id'),('research_v2_sections','research_run_id'),
    ('research_changes','current_run_id')
  ) as x(table_name,run_column)
  loop
    execute format('drop trigger if exists %I on public.%I',rec.table_name||'_history_guard',rec.table_name);
    execute format(
      'create trigger %I before insert or update or delete on public.%I for each row execute function private.guard_research_child_history(%L)',
      rec.table_name||'_history_guard',rec.table_name,rec.run_column
    );
  end loop;
end $$;

-- Prediction lock. Resolver metadata is the only mutable part of a locked predicted outcome.
create or replace function private.guard_prediction_snapshot_history()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.locked_at is null
       or coalesce(current_setting('solpient.prediction_publication',true),'')<>'on' then
      raise exception 'Prediction snapshots must be atomically created and locked through publish_prediction_package_v1().';
    end if;
    return new;
  end if;
  if old.locked_at is not null then
    raise exception 'Locked prediction snapshots are immutable; create a superseding correction snapshot instead.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists prediction_snapshots_history_guard on public.prediction_snapshots;
create trigger prediction_snapshots_history_guard before insert or update or delete on public.prediction_snapshots
for each row execute function private.guard_prediction_snapshot_history();

create or replace function private.guard_prediction_outcome_history()
returns trigger language plpgsql set search_path='' as $$
declare v_locked_at timestamptz;
begin
  if tg_op='DELETE' then
    select locked_at into v_locked_at from public.prediction_snapshots where id=old.prediction_snapshot_id;
  else
    select locked_at into v_locked_at from public.prediction_snapshots where id=new.prediction_snapshot_id;
  end if;

  if v_locked_at is not null then
    if tg_op='INSERT' then
      if coalesce(current_setting('solpient.prediction_publication',true),'')='on' then return new; end if;
      raise exception 'Predicted outcomes cannot be appended after a prediction snapshot is locked.';
    end if;
    if tg_op='DELETE' then
      raise exception 'Predicted outcomes for a locked prediction cannot be deleted.';
    end if;
    if (to_jsonb(new)-array['resolver_status','resolved_at','resolution_note']::text[])
       is distinct from
       (to_jsonb(old)-array['resolver_status','resolved_at','resolution_note']::text[]) then
      raise exception 'Forecast fields are immutable after prediction lock; only resolver metadata may change.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists prediction_outcomes_history_guard on public.prediction_outcomes;
create trigger prediction_outcomes_history_guard before insert or update or delete on public.prediction_outcomes
for each row execute function private.guard_prediction_outcome_history();

create or replace function private.guard_append_only_history()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' or tg_op='DELETE' then
    raise exception 'Historical ledger rows are append-only; create a correction/superseding record instead.';
  end if;
  return new;
end $$;

do $$
declare rec text;
begin
  foreach rec in array array['realized_outcomes','prediction_scores','ranking_history','ranking_explanations']
  loop
    execute format('drop trigger if exists %I on public.%I',rec||'_append_only_guard',rec);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function private.guard_append_only_history()',
      rec||'_append_only_guard',rec
    );
  end loop;
end $$;

-- Correction lineage and hashes for append-only outcome/ranking ledgers.
create or replace function private.prepare_realized_outcome_integrity()
returns trigger language plpgsql set search_path='' as $$
declare v_original public.realized_outcomes;
begin
  if new.supersedes_id is not null then
    select * into v_original from public.realized_outcomes where id=new.supersedes_id;
    if not found then raise exception 'Superseded realized outcome does not exist.'; end if;
    if v_original.prediction_outcome_id<>new.prediction_outcome_id then
      raise exception 'A realized-outcome correction must refer to the same prediction outcome.';
    end if;
    if nullif(btrim(new.correction_reason),'') is null then
      raise exception 'A realized-outcome correction requires correction_reason.';
    end if;
    new.corrected_at:=coalesce(new.corrected_at,now());
  elsif new.correction_reason is not null or new.corrected_at is not null then
    raise exception 'Correction metadata requires supersedes_id.';
  end if;
  new.integrity_version:=coalesce(new.integrity_version,'historical-integrity-v1');
  new.integrity_hash:=coalesce(new.integrity_hash,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'prediction_outcome_id',new.prediction_outcome_id,'observed_at',new.observed_at,
        'actual_value',new.actual_value,'actual_text',new.actual_text,'source_url',new.source_url,
        'source_note',new.source_note,'supersedes_id',new.supersedes_id,
        'correction_reason',new.correction_reason
      )::text,'UTF8'),'sha256'),'hex'));
  return new;
end $$;

drop trigger if exists realized_outcomes_integrity_prepare on public.realized_outcomes;
create trigger realized_outcomes_integrity_prepare before insert on public.realized_outcomes
for each row execute function private.prepare_realized_outcome_integrity();

create or replace function private.prepare_prediction_score_integrity()
returns trigger language plpgsql set search_path='' as $$
begin
  new.methodology_version:=coalesce(nullif(btrim(new.methodology_version),''),'score-v1');
  new.integrity_version:=coalesce(new.integrity_version,'historical-integrity-v1');
  new.integrity_hash:=coalesce(new.integrity_hash,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'prediction_outcome_id',new.prediction_outcome_id,'realized_outcome_id',new.realized_outcome_id,
        'scored_at',new.scored_at,'absolute_error',new.absolute_error,'percentage_error',new.percentage_error,
        'direction_correct',new.direction_correct,'probability_brier_score',new.probability_brier_score,
        'benchmark_excess_return',new.benchmark_excess_return,'methodology_version',new.methodology_version,
        'notes',new.notes
      )::text,'UTF8'),'sha256'),'hex'));
  return new;
end $$;

drop trigger if exists prediction_scores_integrity_prepare on public.prediction_scores;
create trigger prediction_scores_integrity_prepare before insert on public.prediction_scores
for each row execute function private.prepare_prediction_score_integrity();

create or replace function private.prepare_ranking_history_integrity()
returns trigger language plpgsql set search_path='' as $$
declare v_original public.ranking_history;
begin
  new.methodology_version:=coalesce(nullif(btrim(new.methodology_version),''),'ranking-v1');
  if new.supersedes_id is not null then
    select * into v_original from public.ranking_history where id=new.supersedes_id;
    if not found then raise exception 'Superseded ranking row does not exist.'; end if;
    if v_original.company_id<>new.company_id then
      raise exception 'A ranking correction must refer to the same company.';
    end if;
    if nullif(btrim(new.correction_reason),'') is null then
      raise exception 'A ranking correction requires correction_reason.';
    end if;
    new.corrected_at:=coalesce(new.corrected_at,now());
  elsif new.correction_reason is not null or new.corrected_at is not null then
    raise exception 'Correction metadata requires supersedes_id.';
  end if;
  if new.snapshot_hash is null then
    new.integrity_version:=coalesce(new.integrity_version,'historical-integrity-v1');
    new.hash_algorithm:=coalesce(new.hash_algorithm,'sha256');
    new.canonicalization_version:=coalesce(new.canonicalization_version,'postgres-jsonb-v1');
    new.snapshot_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'company_id',new.company_id,'research_run_id',new.research_run_id,'ranked_at',new.ranked_at,
        'rank',new.rank,'overall_score',new.overall_score,'price',new.price,
        'base_fair_value',new.base_fair_value,'methodology_version',new.methodology_version,
        'supersedes_id',new.supersedes_id,'correction_reason',new.correction_reason
      )::text,'UTF8'),'sha256'),'hex');
  end if;
  return new;
end $$;

drop trigger if exists ranking_history_integrity_prepare on public.ranking_history;
create trigger ranking_history_integrity_prepare before insert on public.ranking_history
for each row execute function private.prepare_ranking_history_integrity();

-- Atomic authoritative Research Standard v2 publication.
create or replace function public.publish_reviewed_research_v2(
  p_draft_id uuid,p_review_id uuid,p_composition_id uuid,p_expected_previous_run_id uuid,
  p_package jsonb,p_integrity jsonb,p_changes jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_draft public.baseline_drafts;
  v_review public.baseline_reviews;
  v_composition public.research_compositions;
  v_latest_id uuid; v_latest_version integer; v_run_id uuid; v_version integer;
  v_published_at timestamptz:=now();
  v_supersedes_id uuid; v_superseded_company_id uuid; v_correction_reason text;
begin
  select * into v_draft from public.baseline_drafts where id=p_draft_id for update;
  if not found then raise exception 'Baseline draft not found.'; end if;
  select * into v_review from public.baseline_reviews where id=p_review_id and draft_id=p_draft_id for update;
  if not found then raise exception 'Matching baseline review not found.'; end if;
  select * into v_composition from public.research_compositions
    where id=p_composition_id and draft_id=p_draft_id and company_id=v_draft.company_id;
  if not found then raise exception 'Matching research composition not found.'; end if;
  if v_composition.status<>'applied' then raise exception 'Research composition must be applied before publication.'; end if;

  if v_draft.published_run_id is not null then
    return pg_catalog.jsonb_build_object('id',v_draft.published_run_id,'alreadyPublished',true);
  end if;
  if coalesce((v_review.promotion_readiness->>'ready')::boolean,false) is not true then
    raise exception 'Review promotion readiness is not true.';
  end if;
  if (p_package->'research'->>'standard_version')<>'solpient-v2' then
    raise exception 'Authoritative publication requires Research Standard v2.';
  end if;
  if pg_catalog.jsonb_typeof(p_package->'financial_metrics')<>'object'
    or pg_catalog.jsonb_typeof(p_package->'scores')<>'object'
    or pg_catalog.jsonb_typeof(p_package->'valuations')<>'object'
    or pg_catalog.jsonb_typeof(p_package->'business_assessment')<>'object'
    or pg_catalog.jsonb_typeof(p_package->'metric_observations')<>'array'
    or pg_catalog.jsonb_typeof(p_package->'risk_register')<>'array'
    or pg_catalog.jsonb_typeof(p_package->'expected_return_scenarios')<>'array'
    or pg_catalog.jsonb_typeof(p_package->'thesis_variables')<>'array'
    or pg_catalog.jsonb_typeof(p_package->'sources')<>'array' then
    raise exception 'Publication package is structurally incomplete.';
  end if;
  if nullif(p_integrity->>'evidence_hash','') is null
    or nullif(p_integrity->>'normalized_inputs_hash','') is null
    or nullif(p_integrity->>'valuation_inputs_hash','') is null
    or nullif(p_integrity->>'composition_hash','') is null
    or nullif(p_integrity->>'published_output_hash','') is null
    or nullif(p_integrity->>'methodology_version','') is null then
    raise exception 'Publication integrity metadata is incomplete.';
  end if;

  perform 1 from public.companies where id=v_draft.company_id for update;
  select id,version into v_latest_id,v_latest_version
    from public.research_runs where company_id=v_draft.company_id order by version desc limit 1;
  if v_latest_id is distinct from p_expected_previous_run_id then
    raise exception 'Stale publication attempt: the latest research version changed.';
  end if;
  v_version:=coalesce(v_latest_version,0)+1;
  v_supersedes_id:=nullif(p_integrity->>'supersedes_id','')::uuid;
  v_correction_reason:=nullif(btrim(p_integrity->>'correction_reason'),'');
  if v_supersedes_id is not null then
    select company_id into v_superseded_company_id from public.research_runs
      where id=v_supersedes_id and status='published';
    if not found or v_superseded_company_id<>v_draft.company_id then
      raise exception 'Superseded research run must be a published version for the same company.';
    end if;
    if v_correction_reason is null then raise exception 'A research correction requires correction_reason.'; end if;
  elsif v_correction_reason is not null then
    raise exception 'correction_reason requires supersedes_id.';
  end if;

  perform set_config('solpient.authoritative_publication','on',true);

  insert into public.research_runs(
    company_id,version,researched_at,price_at_research,market_cap,source_period,status,summary,full_report,
    ingestion_key,previous_run_id,standard_version,standard_status,data_cutoff_at,benchmark_ticker,
    completeness_pct,validation_notes,source_draft_id,source_review_id,source_composition_id,
    supersedes_id,correction_reason,corrected_at,published_at,publication_path,integrity_version,
    publication_engine_version,methodology_version,hash_algorithm,canonicalization_version,
    evidence_hash,normalized_inputs_hash,valuation_inputs_hash,composition_hash,published_output_hash
  ) values (
    v_draft.company_id,v_version,v_published_at,
    nullif(p_package->'research'->>'price_at_research','')::numeric,
    nullif(p_package->'research'->>'market_cap','')::numeric,
    p_package->'research'->>'source_period','published',
    p_package->'research'->>'summary',p_package->'research'->>'full_report',
    'baseline-draft:'||p_draft_id::text,v_latest_id,'solpient-v2',
    coalesce(nullif(p_integrity->>'standard_status',''),'complete'),
    nullif(p_package->'research'->>'data_cutoff_at','')::timestamptz,
    coalesce(nullif(p_package->'research'->>'benchmark_ticker',''),'SPY'),
    nullif(p_integrity->>'completeness_pct','')::numeric,
    coalesce(p_integrity->'validation_notes','[]'::jsonb),
    p_draft_id,p_review_id,p_composition_id,v_supersedes_id,v_correction_reason,
    case when v_supersedes_id is not null then v_published_at else null end,
    v_published_at,'reviewed_v2_rpc','historical-integrity-v1',
    coalesce(nullif(p_integrity->>'publication_engine_version',''),'reviewed-v2-publisher-v1'),
    p_integrity->>'methodology_version','sha256',
    coalesce(nullif(p_integrity->>'canonicalization_version',''),'solpient-canonical-json-v1'),
    p_integrity->>'evidence_hash',p_integrity->>'normalized_inputs_hash',
    p_integrity->>'valuation_inputs_hash',p_integrity->>'composition_hash',
    p_integrity->>'published_output_hash'
  ) returning id into v_run_id;

  insert into public.financial_metrics
    select (pg_catalog.jsonb_populate_record(null::public.financial_metrics,
      coalesce(p_package->'financial_metrics','{}'::jsonb)
      ||pg_catalog.jsonb_build_object('id',gen_random_uuid(),'research_run_id',v_run_id,'created_at',v_published_at))).*;
  insert into public.scores
    select (pg_catalog.jsonb_populate_record(null::public.scores,
      coalesce(p_package->'scores','{}'::jsonb)
      ||pg_catalog.jsonb_build_object('id',gen_random_uuid(),'research_run_id',v_run_id,'created_at',v_published_at))).*;
  insert into public.valuations
    select (pg_catalog.jsonb_populate_record(null::public.valuations,
      coalesce(p_package->'valuations','{}'::jsonb)
      ||pg_catalog.jsonb_build_object('id',gen_random_uuid(),'research_run_id',v_run_id,'created_at',v_published_at))).*;
  insert into public.business_assessments
    select (pg_catalog.jsonb_populate_record(null::public.business_assessments,
      coalesce(p_package->'business_assessment','{}'::jsonb)
      ||pg_catalog.jsonb_build_object('id',gen_random_uuid(),'research_run_id',v_run_id,'created_at',v_published_at))).*;

  insert into public.metric_observations
    select (pg_catalog.jsonb_populate_record(null::public.metric_observations,
      elem||pg_catalog.jsonb_build_object('id',gen_random_uuid(),'research_run_id',v_run_id,'created_at',v_published_at))).*
    from pg_catalog.jsonb_array_elements(p_package->'metric_observations') elem;
  insert into public.risk_register
    select (pg_catalog.jsonb_populate_record(null::public.risk_register,
      elem||pg_catalog.jsonb_build_object('id',gen_random_uuid(),'research_run_id',v_run_id,'created_at',v_published_at))).*
    from pg_catalog.jsonb_array_elements(p_package->'risk_register') elem;
  insert into public.expected_return_scenarios
    select (pg_catalog.jsonb_populate_record(null::public.expected_return_scenarios,
      elem||pg_catalog.jsonb_build_object('id',gen_random_uuid(),'research_run_id',v_run_id,'created_at',v_published_at))).*
    from pg_catalog.jsonb_array_elements(p_package->'expected_return_scenarios') elem;
  insert into public.thesis_variables
    select (pg_catalog.jsonb_populate_record(null::public.thesis_variables,
      elem||pg_catalog.jsonb_build_object('id',gen_random_uuid(),'research_run_id',v_run_id,'created_at',v_published_at))).*
    from pg_catalog.jsonb_array_elements(p_package->'thesis_variables') elem;
  insert into public.sources
    select (pg_catalog.jsonb_populate_record(null::public.sources,
      elem||pg_catalog.jsonb_build_object('id',gen_random_uuid(),'research_run_id',v_run_id))).*
    from pg_catalog.jsonb_array_elements(p_package->'sources') elem;

  insert into public.research_v2_sections
    select (pg_catalog.jsonb_populate_record(null::public.research_v2_sections,
      pg_catalog.jsonb_build_object(
        'research_run_id',v_run_id,'investment_thesis',coalesce(p_package->'investment_thesis','{}'::jsonb),
        'financial_quality',coalesce(p_package->'financial_quality','{}'::jsonb),
        'fundamental_scorecard',coalesce(p_package->'fundamental_scorecard','[]'::jsonb),
        'competitive_position',coalesce(p_package->'competitive_position','{}'::jsonb),
        'valuation_analysis',coalesce(p_package->'valuation_analysis','{}'::jsonb),
        'historical_valuation',coalesce(p_package->'historical_valuation','{}'::jsonb),
        'investment_lenses',coalesce(p_package->'investment_lenses','{}'::jsonb),
        'decision_dashboard',coalesce(p_package->'decision_dashboard','{}'::jsonb),
        'final_conclusion',coalesce(p_package->'final_conclusion','{}'::jsonb),
        'created_at',v_published_at
      ))).*;

  if pg_catalog.jsonb_typeof(coalesce(p_changes,'[]'::jsonb))<>'array' then
    raise exception 'Research changes must be a JSON array.';
  end if;
  insert into public.research_changes
    select (pg_catalog.jsonb_populate_record(null::public.research_changes,
      elem||pg_catalog.jsonb_build_object(
        'id',gen_random_uuid(),'company_id',v_draft.company_id,'current_run_id',v_run_id,
        'previous_run_id',v_latest_id,'created_at',v_published_at
      ))).*
    from pg_catalog.jsonb_array_elements(coalesce(p_changes,'[]'::jsonb)) elem;

  update public.baseline_drafts set
    status='promoted',published_run_id=v_run_id,standard_valid=true,
    standard_status=coalesce(nullif(p_integrity->>'standard_status',''),'complete'),
    validation_result=coalesce(p_integrity->'validation_result','{}'::jsonb),updated_at=v_published_at
    where id=p_draft_id;
  update public.baseline_reviews set
    status='promoted',published_run_id=v_run_id,promoted_at=v_published_at,
    validation_result=coalesce(p_integrity->'validation_result','{}'::jsonb),
    promotion_readiness=coalesce(p_integrity->'promotion_readiness',promotion_readiness),
    updated_at=v_published_at where id=p_review_id;

  return pg_catalog.jsonb_build_object('id',v_run_id,'version',v_version,'alreadyPublished',false);
end $$;

revoke all on function public.publish_reviewed_research_v2(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.publish_reviewed_research_v2(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb)
  to service_role;

-- Prediction snapshot and forecast outcomes are committed/locked atomically.
create or replace function public.publish_prediction_package_v1(
  p_snapshot jsonb,p_outcomes jsonb,p_integrity jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_snapshot_id uuid; v_locked_at timestamptz:=now();
  v_company_id uuid:=nullif(p_snapshot->>'company_id','')::uuid;
  v_supersedes_id uuid:=nullif(p_snapshot->>'supersedes_id','')::uuid;
  v_original_company_id uuid;
  v_correction_reason text:=nullif(btrim(p_snapshot->>'correction_reason'),'');
begin
  if v_company_id is null then raise exception 'Prediction company_id is required.'; end if;
  perform 1 from public.companies where id=v_company_id for update;
  if not found then raise exception 'Prediction company does not exist.'; end if;
  if pg_catalog.jsonb_typeof(p_outcomes)<>'array' or pg_catalog.jsonb_array_length(p_outcomes)=0 then
    raise exception 'A locked prediction requires at least one predicted outcome.';
  end if;
  if nullif(p_integrity->>'integrity_hash','') is null then
    raise exception 'Prediction integrity_hash is required.';
  end if;
  if v_supersedes_id is not null then
    select company_id into v_original_company_id from public.prediction_snapshots
      where id=v_supersedes_id and locked_at is not null;
    if not found or v_original_company_id<>v_company_id then
      raise exception 'Superseded prediction must be a locked snapshot for the same company.';
    end if;
    if v_correction_reason is null then raise exception 'Prediction correction requires correction_reason.'; end if;
  elsif v_correction_reason is not null then
    raise exception 'correction_reason requires supersedes_id.';
  end if;

  perform set_config('solpient.prediction_publication','on',true);
  insert into public.prediction_snapshots
    select (pg_catalog.jsonb_populate_record(null::public.prediction_snapshots,
      p_snapshot||pg_catalog.jsonb_build_object(
        'id',gen_random_uuid(),'company_id',v_company_id,'locked_at',v_locked_at,
        'corrected_at',case when v_supersedes_id is not null then v_locked_at else null end,
        'integrity_version',coalesce(nullif(p_integrity->>'integrity_version',''),'historical-integrity-v1'),
        'hash_algorithm','sha256',
        'canonicalization_version',coalesce(nullif(p_integrity->>'canonicalization_version',''),'solpient-canonical-json-v1'),
        'integrity_hash',p_integrity->>'integrity_hash','created_at',v_locked_at
      ))).* returning id into v_snapshot_id;

  insert into public.prediction_outcomes
    select (pg_catalog.jsonb_populate_record(null::public.prediction_outcomes,
      elem||pg_catalog.jsonb_build_object(
        'id',gen_random_uuid(),'prediction_snapshot_id',v_snapshot_id,'created_at',v_locked_at,
        'target_window_days',coalesce(nullif(elem->>'target_window_days','')::integer,45),
        'resolver_status',coalesce(nullif(elem->>'resolver_status',''),'pending')
      ))).*
    from pg_catalog.jsonb_array_elements(p_outcomes) elem;

  return pg_catalog.jsonb_build_object('id',v_snapshot_id,'locked_at',v_locked_at);
end $$;

revoke all on function public.publish_prediction_package_v1(jsonb,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.publish_prediction_package_v1(jsonb,jsonb,jsonb)
  to service_role;

-- Narrow the Data API privilege surface. RLS remains enabled, but history safety
-- is enforced by grants + triggers because service_role bypasses RLS.
revoke insert,update,delete,truncate on table
  public.research_runs,public.financial_metrics,public.scores,public.valuations,
  public.business_assessments,public.metric_observations,public.risk_register,
  public.expected_return_scenarios,public.thesis_variables,public.sources,
  public.research_v2_sections,public.research_changes
from anon,authenticated,service_role;

grant select on table
  public.research_runs,public.financial_metrics,public.scores,public.valuations,
  public.business_assessments,public.metric_observations,public.risk_register,
  public.expected_return_scenarios,public.thesis_variables,public.sources,
  public.research_v2_sections,public.research_changes
to service_role;

revoke insert,update,delete,truncate on table
  public.prediction_snapshots,public.prediction_outcomes,public.realized_outcomes,
  public.prediction_scores,public.ranking_history,public.ranking_explanations
from anon,authenticated;

revoke insert,update,delete,truncate on table public.prediction_snapshots from service_role;
revoke insert,update,delete,truncate on table public.prediction_outcomes from service_role;
grant update (resolver_status,resolved_at,resolution_note) on table public.prediction_outcomes to service_role;

grant insert on table public.realized_outcomes,public.prediction_scores,
  public.ranking_history,public.ranking_explanations to service_role;
revoke update,delete,truncate on table public.realized_outcomes,public.prediction_scores,
  public.ranking_history,public.ranking_explanations from service_role;

-- Existing private resolver contains ON CONFLICT DO UPDATE for prediction_scores.
-- UPDATE privilege is needed to plan that statement; the append-only trigger rejects
-- any actual rewrite, so a duplicate resolution fails rather than mutating history.
grant update on table public.prediction_scores to service_role;

comment on function public.publish_reviewed_research_v2(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb) is
  'Authoritative atomic publication path for reviewed Solpient Research Standard v2 packages.';
comment on function public.publish_prediction_package_v1(jsonb,jsonb,jsonb) is
  'Atomically creates and locks an immutable prediction snapshot with its forecast outcomes.';
comment on column public.research_runs.supersedes_id is
  'For corrections only. A new immutable research version points to the immutable version it corrects.';
comment on column public.prediction_snapshots.locked_at is
  'Once non-null, forecast content is immutable; corrections are new snapshots linked through supersedes_id.';
comment on column public.ranking_history.methodology_version is
  'Ranking methodology/model identifier captured at snapshot time.';
