-- Group B / B6 feedback isolation test.

begin;

insert into public.companies(id,ticker,company_name)
values
  ('b6111111-1111-4111-8111-111111111111','B6A_TEST','B6 Company A'),
  ('b6222222-2222-4222-8222-222222222222','B6B_TEST','B6 Company B');

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  'b6333333-3333-4333-8333-333333333333',
  'authenticated','authenticated','b6-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
),
(
  'b6444444-4444-4444-8444-444444444444',
  'authenticated','authenticated','b6-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
);

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity
)
select
  'b6555555-5555-4555-8555-555555555555',
  p.id,p.user_id,
  'b6111111-1111-4111-8111-111111111111',
  10
from public.portfolios p
where p.user_id='b6333333-3333-4333-8333-333333333333'
  and p.is_default;

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity
)
select
  'b6666666-6666-4666-8666-666666666666',
  p.id,p.user_id,
  'b6222222-2222-4222-8222-222222222222',
  20
from public.portfolios p
where p.user_id='b6444444-4444-4444-8444-444444444444'
  and p.is_default;

set local role authenticated;
set local "request.jwt.claim.sub"='b6333333-3333-4333-8333-333333333333';

insert into public.what_matters_feedback(
  user_id,position_id,item_id,event_id,feedback_type,note
) values (
  'b6333333-3333-4333-8333-333333333333',
  'b6555555-5555-4555-8555-555555555555',
  'b6555555-5555-4555-8555-555555555555:event-1',
  'event-1',
  'useful',
  'This was relevant.'
);

insert into public.what_matters_missed_events(
  user_id,position_id,expected_event,note
) values (
  'b6333333-3333-4333-8333-333333333333',
  'b6555555-5555-4555-8555-555555555555',
  'Important product launch',
  'I expected this to appear.'
);

select 1 / case when (select count(*) from public.what_matters_feedback)=1 then 1 else 0 end
as user_a_sees_own_feedback;

select 1 / case when (select count(*) from public.what_matters_missed_events)=1 then 1 else 0 end
as user_a_sees_own_missed_report;

do $b6_feedback$
begin
  begin
    insert into public.what_matters_feedback(
      user_id,position_id,item_id,event_id,feedback_type
    ) values (
      'b6444444-4444-4444-8444-444444444444',
      'b6666666-6666-4666-8666-666666666666',
      'forbidden',
      'event-x',
      'useful'
    );
    raise exception 'B6 isolation failure: user A wrote user B feedback';
  exception when insufficient_privilege then null;
  end;
end
$b6_feedback$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='b6444444-4444-4444-8444-444444444444';

select 1 / case when (select count(*) from public.what_matters_feedback)=0 then 1 else 0 end
as user_b_cannot_read_user_a_feedback;

select 1 / case when (select count(*) from public.what_matters_missed_events)=0 then 1 else 0 end
as user_b_cannot_read_user_a_missed_reports;

reset role;

select 1 / case when (
  select count(*)
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname in ('what_matters_feedback','what_matters_missed_events')
    and c.relrowsecurity
)=2 then 1 else 0 end
as b6_rls_enabled;

rollback;
