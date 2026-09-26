-- Group B / B12 automatic consumer-refresh isolation test.

begin;

insert into public.companies(id,ticker,company_name)
values
  ('bc111111-1111-4111-8111-111111111111','B12A_TEST','B12 Company A');

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  'bc333333-3333-4333-8333-333333333333',
  'authenticated','authenticated','b12-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
),
(
  'bc444444-4444-4444-8444-444444444444',
  'authenticated','authenticated','b12-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
);

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity
)
select
  'bc555555-5555-4555-8555-555555555555',
  p.id,p.user_id,
  'bc111111-1111-4111-8111-111111111111',
  10
from public.portfolios p
where p.user_id='bc333333-3333-4333-8333-333333333333'
  and p.is_default;

insert into public.user_alert_preferences(
  user_id,minimum_level,in_app_enabled,daily_digest_enabled
) values (
  'bc333333-3333-4333-8333-333333333333',
  'important',true,true
)
on conflict(user_id) do update set
  in_app_enabled=excluded.in_app_enabled,
  daily_digest_enabled=excluded.daily_digest_enabled;

set local role authenticated;
set local "request.jwt.claim.sub"='bc333333-3333-4333-8333-333333333333';

do $b12_auth_blocked$
begin
  begin
    perform public.refresh_consumer_intelligence_batch_v1(10,null);
    raise exception 'B12 security failure: authenticated user executed service batch';
  exception when insufficient_privilege then null;
  end;
end
$b12_auth_blocked$;

reset role;
set local role service_role;
select set_config(
  'request.jwt.claim.sub',
  'bc444444-4444-4444-8444-444444444444',
  true
);

create temporary table b12_result(payload jsonb) on commit drop;
insert into b12_result(payload)
select public.refresh_consumer_intelligence_batch_v1(10,null);

select 1 / case when (
  select (payload->>'processed_users')::integer
  from b12_result
)=1 then 1 else 0 end
as b12_processes_only_position_users;

select 1 / case when (
  select payload->>'error_count'
  from b12_result
)='0' then 1 else 0 end
as b12_batch_has_no_errors;

select 1 / case when current_setting('request.jwt.claim.sub',true)
  ='bc444444-4444-4444-8444-444444444444'
then 1 else 0 end
as b12_restores_original_subject;

select 1 / case when exists (
  select 1
  from public.user_alert_preferences
  where user_id='bc333333-3333-4333-8333-333333333333'
) then 1 else 0 end
as b12_target_user_preferences_preserved;

select 1 / case when not exists (
  select 1
  from public.user_alert_preferences
  where user_id='bc444444-4444-4444-8444-444444444444'
) then 1 else 0 end
as b12_non_position_user_not_touched;

reset role;

select 1 / case when
  not has_function_privilege(
    'authenticated',
    'public.refresh_consumer_intelligence_batch_v1(integer,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.refresh_consumer_intelligence_batch_v1(integer,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.refresh_consumer_intelligence_batch_v1(integer,uuid)',
    'EXECUTE'
  )
then 1 else 0 end
as b12_batch_rpc_is_service_only;

rollback;
