alter table public.data_coverage_reports
  add column if not exists valuation_history_pct numeric,
  add column if not exists capital_allocation_pct numeric,
  add column if not exists consensus_pct numeric,
  add column if not exists research_structure_pct numeric,
  add column if not exists decision_readiness_pct numeric,
  add column if not exists coverage_details jsonb not null default '{}'::jsonb;

grant select on public.data_coverage_reports to anon, authenticated;

drop policy if exists "public read data coverage reports" on public.data_coverage_reports;
create policy "public read data coverage reports"
on public.data_coverage_reports for select
to anon, authenticated
using (true);
