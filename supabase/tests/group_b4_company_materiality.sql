-- Group B / B4 company materiality contract test.

begin;

insert into public.companies(id,ticker,company_name)
values
  ('b4111111-1111-4111-8111-111111111111','B4A_TEST','B4 Company A'),
  ('b4222222-2222-4222-8222-222222222222','B4B_TEST','B4 Company B');

insert into public.research_runs(
  id,company_id,version,status,summary
) values (
  'b4333333-3333-4333-8333-333333333333',
  'b4111111-1111-4111-8111-111111111111',
  1,'draft','B4 draft trigger fixture'
);

insert into public.company_change_events(
  company_id,event_key,category,metric_key,label,
  old_value,new_value,delta_value,delta_percent,
  direction,materiality,decision_impact,summary,occurred_at
) values
(
  'b4111111-1111-4111-8111-111111111111',
  'b4-change-a','financial','revenue_growth',
  'Revenue growth',10,5,-5,-50,
  'down','high','weakening','Revenue growth weakened materially.',current_date
),
(
  'b4222222-2222-4222-8222-222222222222',
  'b4-change-b','financial','revenue_growth',
  'Revenue growth',5,15,10,200,
  'up','high','improving','Other company improved.',current_date
);

insert into public.decision_triggers(
  company_id,research_run_id,trigger_key,trigger_group,label,metric_key,
  comparator,threshold_value,current_value,decision_effect,severity,
  evaluation_status,rationale,source_kind,first_triggered_at,last_evaluated_at
) values (
  'b4111111-1111-4111-8111-111111111111',
  'b4333333-3333-4333-8333-333333333333',
  'b4-trigger-a','thesis','Margin breaker','operating_margin',
  '<=',20,18,'thesis_breaker','material',
  'triggered','Operating margin crossed the thesis threshold.',
  'research',now(),now()
);

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values (
  'b4444444-4444-4444-8444-444444444444',
  'authenticated','authenticated','b4-user@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
);

set local role authenticated;
set local "request.jwt.claim.sub"='b4444444-4444-4444-8444-444444444444';

select 1 / case when
  public.get_company_materiality_events_v1(
    'b4111111-1111-4111-8111-111111111111',current_date-1,50
  )->>'contract_version'='group-b-company-materiality-v1'
then 1 else 0 end
as b4_contract_version;

select 1 / case when
  (public.get_company_materiality_events_v1(
    'b4111111-1111-4111-8111-111111111111',current_date-1,50
  )->>'event_count')::integer=2
then 1 else 0 end
as b4_combines_change_and_trigger;

select 1 / case when
  public.get_company_materiality_events_v1(
    'b4111111-1111-4111-8111-111111111111',current_date-1,50
  )->'events'->0->'company_materiality'->>'level'='high'
then 1 else 0 end
as b4_high_materiality_normalized;

select 1 / case when not (
  public.get_company_materiality_events_v1(
    'b4111111-1111-4111-8111-111111111111',current_date-1,50
  )->'events' @> '[{"summary":"Other company improved."}]'::jsonb
) then 1 else 0 end
as b4_company_isolation;

reset role;
set local role anon;
set local "request.jwt.claim.sub"='';

do $b4_anon$
begin
  begin
    perform public.get_company_materiality_events_v1(
      'b4111111-1111-4111-8111-111111111111',current_date-1,50
    );
    raise exception 'B4 auth failure: anon executed materiality contract';
  exception
    when insufficient_privilege then null;
  end;
end
$b4_anon$;

reset role;

select 1 / case when (
  select not p.prosecdef
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='get_company_materiality_events_v1'
    and pg_get_function_identity_arguments(p.oid)=
      'p_company_id uuid, p_since date, p_limit integer'
) then 1 else 0 end
as b4_public_rpc_is_security_invoker;

select 1 / case when (
  select p.prosecdef
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='consumer_private'
    and p.proname='get_company_materiality_events_v1'
    and pg_get_function_identity_arguments(p.oid)=
      'p_company_id uuid, p_since date, p_limit integer'
) then 1 else 0 end
as b4_private_helper_is_security_definer;

rollback;
