-- Phase 1 hardening: seal publication source records after promotion and index historical FKs.

create or replace function private.guard_published_review_source()
returns trigger language plpgsql set search_path='' as $$
declare v_published_run_id uuid;
begin
  if tg_table_name='baseline_drafts' then
    v_published_run_id:=old.published_run_id;
  elsif tg_table_name='baseline_reviews' then
    v_published_run_id:=old.published_run_id;
  else
    select id into v_published_run_id
    from public.research_runs
    where source_composition_id=old.id and status='published'
    limit 1;
  end if;

  if v_published_run_id is not null then
    raise exception 'Published research source records are sealed; create a new draft/review/composition instead.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists baseline_drafts_publication_seal on public.baseline_drafts;
create trigger baseline_drafts_publication_seal
before update or delete on public.baseline_drafts
for each row execute function private.guard_published_review_source();

drop trigger if exists baseline_reviews_publication_seal on public.baseline_reviews;
create trigger baseline_reviews_publication_seal
before update or delete on public.baseline_reviews
for each row execute function private.guard_published_review_source();

drop trigger if exists research_compositions_publication_seal on public.research_compositions;
create trigger research_compositions_publication_seal
before update or delete on public.research_compositions
for each row execute function private.guard_published_review_source();

create index if not exists company_change_events_current_snapshot_idx
  on public.company_change_events(current_snapshot_id);
create index if not exists company_change_events_previous_snapshot_idx
  on public.company_change_events(previous_snapshot_id);
create index if not exists company_change_events_research_run_idx
  on public.company_change_events(research_run_id);
create index if not exists company_state_snapshots_research_run_idx
  on public.company_state_snapshots(research_run_id);
create index if not exists investor_checklist_results_rule_idx
  on public.investor_checklist_results(rule_id);
create index if not exists market_snapshots_company_idx
  on public.market_snapshots(company_id);
create index if not exists ranking_history_research_run_idx
  on public.ranking_history(research_run_id);
create index if not exists research_changes_previous_run_idx
  on public.research_changes(previous_run_id);
create index if not exists research_runs_source_draft_idx
  on public.research_runs(source_draft_id);
create index if not exists research_runs_source_review_idx
  on public.research_runs(source_review_id);
create index if not exists research_runs_source_composition_idx
  on public.research_runs(source_composition_id);

comment on function private.guard_published_review_source() is
  'Allows normal draft/review/composition editing before publication, then seals source records once referenced by published research.';
