-- Operational foreign-key indexes identified by the Supabase performance advisor.

create index if not exists research_factory_items_source_pipeline_item_idx
  on public.research_factory_items(source_pipeline_item_id);

create index if not exists research_candidate_pipeline_publish_sessions_finalized_run_idx
  on public.research_candidate_pipeline_publish_sessions(finalized_run_id)
  where finalized_run_id is not null;

create index if not exists universe_screen_publish_sessions_finalized_run_idx
  on public.universe_screen_publish_sessions(finalized_run_id)
  where finalized_run_id is not null;
