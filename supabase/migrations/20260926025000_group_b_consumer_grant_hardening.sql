-- Group B consumer grant hardening.
-- Supabase default table grants can include TRUNCATE/REFERENCES/TRIGGER.
-- Revoke authenticated completely, then grant only intended consumer privileges.

revoke all on public.profiles from authenticated;
grant select,insert,update on public.profiles to authenticated;

revoke all on public.portfolios from authenticated;
grant select,insert,update,delete on public.portfolios to authenticated;

revoke all on public.portfolio_positions from authenticated;
grant select,insert,update,delete on public.portfolio_positions to authenticated;

revoke all on public.position_thesis_factors from authenticated;
grant select,insert,update,delete on public.position_thesis_factors to authenticated;

revoke all on public.what_matters_feedback from authenticated;
grant select,insert,update,delete on public.what_matters_feedback to authenticated;

revoke all on public.what_matters_missed_events from authenticated;
grant select,insert,update,delete on public.what_matters_missed_events to authenticated;

revoke all on public.research_demand_requests from authenticated;
grant select,insert,update,delete on public.research_demand_requests to authenticated;

do $$
begin
  if to_regclass('public.user_alert_preferences') is not null then
    execute 'revoke all on public.user_alert_preferences from authenticated';
    execute 'grant select,insert,update,delete on public.user_alert_preferences to authenticated';
  end if;

  if to_regclass('public.thesis_alerts') is not null then
    execute 'revoke all on public.thesis_alerts from authenticated';
    execute 'grant select on public.thesis_alerts to authenticated';
    execute 'grant update(state,read_at,dismissed_at) on public.thesis_alerts to authenticated';
  end if;
end
$$;

comment on schema public is
  'SOLPIENT public schema. Consumer table grants are explicitly hardened; RLS remains mandatory.';
