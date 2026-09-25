-- Historical reproducibility repair:
-- Older deployed environments may have had public.rls_auto_enable() from
-- out-of-band setup. Fresh databases built only from tracked migrations do not.
-- Preserve the security intent without requiring hidden state.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;

create index if not exists intelligence_events_research_run_idx
  on public.intelligence_events(research_run_id);
