-- Group B consumer grant-hardening regression test.

select 1 / case when not exists (
  select 1
  from unnest(array[
    'profiles','portfolios','portfolio_positions','position_thesis_factors',
    'what_matters_feedback','what_matters_missed_events','research_demand_requests'
  ]) as t(table_name)
  where has_table_privilege(
    'authenticated',
    format('public.%I',t.table_name),
    'TRUNCATE'
  )
) then 1 else 0 end
as authenticated_has_no_consumer_truncate;

select 1 / case when not exists (
  select 1
  from unnest(array[
    'profiles','portfolios','portfolio_positions','position_thesis_factors',
    'what_matters_feedback','what_matters_missed_events','research_demand_requests'
  ]) as t(table_name)
  where has_table_privilege(
    'authenticated',
    format('public.%I',t.table_name),
    'TRIGGER'
  )
) then 1 else 0 end
as authenticated_has_no_consumer_trigger;

select 1 / case when not exists (
  select 1
  from unnest(array[
    'profiles','portfolios','portfolio_positions','position_thesis_factors',
    'what_matters_feedback','what_matters_missed_events','research_demand_requests'
  ]) as t(table_name)
  where has_table_privilege(
    'authenticated',
    format('public.%I',t.table_name),
    'REFERENCES'
  )
) then 1 else 0 end
as authenticated_has_no_consumer_references;

select 1 / case when
  has_table_privilege('authenticated','public.profiles','SELECT')
  and has_table_privilege('authenticated','public.profiles','INSERT')
  and has_table_privilege('authenticated','public.profiles','UPDATE')
  and not has_table_privilege('authenticated','public.profiles','DELETE')
then 1 else 0 end
as profile_grants_are_minimal;

select 1 / case when
  has_table_privilege('authenticated','public.portfolios','SELECT')
  and has_table_privilege('authenticated','public.portfolios','INSERT')
  and has_table_privilege('authenticated','public.portfolios','UPDATE')
  and has_table_privilege('authenticated','public.portfolios','DELETE')
then 1 else 0 end
as portfolio_grants_are_crud;
