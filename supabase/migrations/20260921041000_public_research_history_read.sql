grant select on public.company_metric_history to anon, authenticated;
grant select on public.capital_allocation_history to anon, authenticated;
grant select on public.research_context_packs to anon, authenticated;
grant select on public.peer_metric_snapshots to anon, authenticated;
grant select on public.research_v2_sections to anon, authenticated;

drop policy if exists "public read company metric history" on public.company_metric_history;
create policy "public read company metric history"
on public.company_metric_history for select
to anon, authenticated
using (true);

drop policy if exists "public read capital allocation history" on public.capital_allocation_history;
create policy "public read capital allocation history"
on public.capital_allocation_history for select
to anon, authenticated
using (true);

drop policy if exists "public read research context packs" on public.research_context_packs;
create policy "public read research context packs"
on public.research_context_packs for select
to anon, authenticated
using (true);

drop policy if exists "public read peer metric snapshots" on public.peer_metric_snapshots;
create policy "public read peer metric snapshots"
on public.peer_metric_snapshots for select
to anon, authenticated
using (true);

drop policy if exists "public read published research v2" on public.research_v2_sections;
create policy "public read published research v2"
on public.research_v2_sections for select
to anon, authenticated
using (
  exists (
    select 1 from public.research_runs r
    where r.id = research_v2_sections.research_run_id
      and r.status = 'published'
  )
);
