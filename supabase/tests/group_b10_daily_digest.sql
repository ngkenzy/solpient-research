-- Group B / B10 daily digest trust-boundary and isolation test.

begin;

insert into public.companies(id,ticker,company_name)
values
  ('ba111111-1111-4111-8111-111111111111','B10A_TEST','B10 Company A');

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  'ba333333-3333-4333-8333-333333333333',
  'authenticated','authenticated','b10-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
),
(
  'ba444444-4444-4444-8444-444444444444',
  'authenticated','authenticated','b10-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
);

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity
)
select
  'ba555555-5555-4555-8555-555555555555',
  p.id,p.user_id,
  'ba111111-1111-4111-8111-111111111111',
  10
from public.portfolios p
where p.user_id='ba333333-3333-4333-8333-333333333333'
  and p.is_default;

set local role service_role;

insert into public.thesis_alerts(
  user_id,position_id,company_id,item_id,event_id,level,score,title,created_at
) values
(
  'ba333333-3333-4333-8333-333333333333',
  'ba555555-5555-4555-8555-555555555555',
  'ba111111-1111-4111-8111-111111111111',
  'digest:item:1',
  'digest-event-1',
  'thesis_priority',
  95,
  'Major thesis change',
  now()
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='ba333333-3333-4333-8333-333333333333';

insert into public.user_alert_preferences(
  user_id,minimum_level,in_app_enabled,daily_digest_enabled
) values (
  'ba333333-3333-4333-8333-333333333333',
  'important',true,true
)
on conflict(user_id) do update
set daily_digest_enabled=excluded.daily_digest_enabled;

select 1 / case when (
  public.refresh_my_daily_digest_v1()->>'status'
)='ready' then 1 else 0 end
as b10_digest_refresh_ready;

select 1 / case when (
  select alert_count
  from public.thesis_digest_snapshots
  where user_id='ba333333-3333-4333-8333-333333333333'
    and digest_date=current_date
)=1 then 1 else 0 end
as b10_digest_contains_alert;

do $b10_no_fabrication$
begin
  begin
    insert into public.thesis_digest_snapshots(
      user_id,digest_date,alert_count
    ) values (
      'ba333333-3333-4333-8333-333333333333',
      current_date-1,
      999
    );
    raise exception 'B10 trust failure: authenticated user fabricated a digest';
  exception when insufficient_privilege then null;
  end;
end
$b10_no_fabrication$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='ba444444-4444-4444-8444-444444444444';

select 1 / case when (
  select count(*) from public.thesis_digest_snapshots
)=0 then 1 else 0 end
as b10_user_b_cannot_read_user_a_digest;

select 1 / case when (
  public.refresh_my_daily_digest_v1()->>'status'
)='disabled' then 1 else 0 end
as b10_digest_disabled_by_default;

reset role;

select 1 / case when (
  select c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname='thesis_digest_snapshots'
) then 1 else 0 end
as b10_rls_enabled;

rollback;
