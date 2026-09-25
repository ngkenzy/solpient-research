-- Group B / B1 clean-start isolation test.
-- Proves automatic profile/default-portfolio creation and cross-user RLS isolation.

begin;

insert into public.companies(id,ticker,company_name)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ADBE_B1_TEST','Adobe B1 Test')
on conflict (id) do nothing;

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  '11111111-1111-4111-8111-111111111111',
  'authenticated','authenticated','b1-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"B1 User A"}'::jsonb,
  now(),now(),false,false
),
(
  '22222222-2222-4222-8222-222222222222',
  'authenticated','authenticated','b1-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"B1 User B"}'::jsonb,
  now(),now(),false,false
);

select 1 / case when (select count(*) from public.profiles where user_id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
)) = 2 then 1 else 0 end as profiles_created;

select 1 / case when (select count(*) from public.portfolios where user_id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
) and is_default) = 2 then 1 else 0 end as default_portfolios_created;

set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';

select 1 / case when (select count(*) from public.profiles) = 1 then 1 else 0 end as user_a_sees_one_profile;
select 1 / case when (select count(*) from public.portfolios) = 1 then 1 else 0 end as user_a_sees_one_portfolio;

insert into public.portfolio_positions(portfolio_id,user_id,company_id,quantity,average_cost)
select
  p.id,
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  5,
  250
from public.portfolios p
where p.user_id='11111111-1111-4111-8111-111111111111'
  and p.is_default;

select 1 / case when (select count(*) from public.portfolio_positions) = 1 then 1 else 0 end as user_a_sees_own_position;

do $$
begin
  begin
    insert into public.portfolios(user_id,name,is_default)
    values('22222222-2222-4222-8222-222222222222','Forbidden portfolio',false);
    raise exception 'B1 isolation failure: user A inserted a portfolio for user B';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

do $$
begin
  begin
    update public.profiles
    set user_id='22222222-2222-4222-8222-222222222222'
    where user_id='11111111-1111-4111-8111-111111111111';
    raise exception 'B1 isolation failure: user A reassigned profile ownership';
  exception
    when insufficient_privilege or unique_violation then null;
  end;
end
$$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '22222222-2222-4222-8222-222222222222';

select 1 / case when (select count(*) from public.profiles) = 1 then 1 else 0 end as user_b_sees_one_profile;
select 1 / case when (select count(*) from public.portfolios) = 1 then 1 else 0 end as user_b_sees_one_portfolio;
select 1 / case when (select count(*) from public.portfolio_positions) = 0 then 1 else 0 end as user_b_cannot_read_user_a_position;

do $$
declare
  v_user_a_portfolio uuid;
begin
  reset role;
  select id into v_user_a_portfolio
  from public.portfolios
  where user_id='11111111-1111-4111-8111-111111111111'
    and is_default
  limit 1;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);

  begin
    insert into public.portfolio_positions(
      portfolio_id,user_id,company_id,quantity
    ) values (
      v_user_a_portfolio,
      '22222222-2222-4222-8222-222222222222',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      1
    );
    raise exception 'B1 isolation failure: user B injected a position into user A portfolio';
  exception
    when foreign_key_violation then null;
  end;
end
$$;

reset role;

select 1 / case when (
  select count(*)
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname in ('profiles','portfolios','portfolio_positions')
    and c.relrowsecurity
) = 3 then 1 else 0 end as rls_enabled_on_all_b1_tables;

rollback;
