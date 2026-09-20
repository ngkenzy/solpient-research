
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create index if not exists intelligence_events_research_run_idx
  on public.intelligence_events(research_run_id);
