-- Group B / B9 thesis-alert trust-boundary and isolation test.

begin;

insert into public.companies(id,ticker,company_name)
values
  ('b9111111-1111-4111-8111-111111111111','B9A_TEST','B9 Company A'),
  ('b9222222-2222-4222-8222-222222222222','B9B_TEST','B9 Company B');

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  'b9333333-3333-4333-8333-333333333333',
  'authenticated','authenticated','b9-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
),
(
  'b9444444-4444-4444-8444-444444444444',
  'authenticated','authenticated','b9-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
);

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity
)
select
  'b9555555-5555-4555-8555-555555555555',
  p.id,p.user_id,
  'b9111111-1111-4111-8111-111111111111',
  10
from public.portfolios p
where p.user_id='b9333333-3333-4333-8333-333333333333'
  and p.is_default;

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity
)
select
  'b9666666-6666-4666-8666-666666666666',
  p.id,p.user_id,
  'b9222222-2222-4222-8222-222222222222',
  20
from public.portfolios p
where p.user_id='b9444444-4444-4444-8444-444444444444'
  and p.is_default;

set local role authenticated;
set local "request.jwt.claim.sub"='b9333333-3333-4333-8333-333333333333';

insert into public.user_alert_preferences(user_id,minimum_level)
values('b9333333-3333-4333-8333-333333333333','important');

select 1 / case when (
  public.refresh_my_thesis_alerts_v1()->>'status'
)='ok' then 1 else 0 end
as b9_authenticated_refresh_works;

do $b9_no_fabrication$
begin
  begin
    insert into public.thesis_alerts(
      user_id,position_id,company_id,item_id,event_id,level,score,title
    ) values (
      'b9333333-3333-4333-8333-333333333333',
      'b9555555-5555-4555-8555-555555555555',
      'b9111111-1111-4111-8111-111111111111',
      'fake:item',
      'fake-event',
      'thesis_priority',
      100,
      'Fabricated'
    );
    raise exception 'B9 trust failure: authenticated user fabricated an alert';
  exception when insufficient_privilege then null;
  end;
end
$b9_no_fabrication$;

reset role;
set local role service_role;

insert into public.thesis_alerts(
  user_id,position_id,company_id,item_id,event_id,level,score,title
) values (
  'b9333333-3333-4333-8333-333333333333',
  'b9555555-5555-4555-8555-555555555555',
  'b9111111-1111-4111-8111-111111111111',
  'service:item',
  'service-event',
  'important',
  80,
  'Service-generated alert'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='b9333333-3333-4333-8333-333333333333';

select 1 / case when (select count(*) from public.thesis_alerts)=1 then 1 else 0 end
as b9_user_a_reads_own_alert;

update public.thesis_alerts
set state='read',read_at=now()
where item_id='service:item';

select 1 / case when (
  select state from public.thesis_alerts where item_id='service:item'
)='read' then 1 else 0 end
as b9_user_a_marks_alert_read;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='b9444444-4444-4444-8444-444444444444';

select 1 / case when (select count(*) from public.thesis_alerts)=0 then 1 else 0 end
as b9_user_b_cannot_read_user_a_alert;

select 1 / case when (select count(*) from public.user_alert_preferences)=0 then 1 else 0 end
as b9_user_b_cannot_read_user_a_preferences;

reset role;

select 1 / case when (
  select count(*)
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname in ('user_alert_preferences','thesis_alerts')
    and c.relrowsecurity
)=2 then 1 else 0 end
as b9_rls_enabled;

rollback;
