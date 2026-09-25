-- Group B / B2 portfolio research-state contract test.
-- Proves user-scoped access to Group A coverage/freshness without exposing other users.

begin;

insert into public.companies(id,ticker,company_name)
values
  ('c1111111-1111-4111-8111-111111111111','B2A_TEST','B2 Company A'),
  ('c2222222-2222-4222-8222-222222222222','B2B_TEST','B2 Company B')
on conflict (id) do nothing;

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  'a1111111-1111-4111-8111-111111111111',
  'authenticated','authenticated','b2-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"B2 User A"}'::jsonb,
  now(),now(),false,false
),
(
  'a2222222-2222-4222-8222-222222222222',
  'authenticated','authenticated','b2-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"B2 User B"}'::jsonb,
  now(),now(),false,false
);

select public.refresh_research_coverage_v1('c1111111-1111-4111-8111-111111111111',now());
select public.refresh_research_coverage_v1('c2222222-2222-4222-8222-222222222222',now());

select public.record_research_component_check_v1(
  'c1111111-1111-4111-8111-111111111111',
  'sec_filings',
  now(),
  now(),
  null,null,null,
  true,
  now()
);
select public.record_research_component_check_v1(
  'c2222222-2222-4222-8222-222222222222',
  'sec_filings',
  now(),
  now(),
  null,null,null,
  true,
  now()
);

select public.record_research_component_check_v1(
  'c1111111-1111-4111-8111-111111111111',
  'market_data',
  now(),
  now(),
  null,null,null,
  true,
  now()
);
select public.record_research_component_check_v1(
  'c2222222-2222-4222-8222-222222222222',
  'market_data',
  now(),
  now(),
  null,null,null,
  true,
  now()
);

insert into public.portfolio_positions(
  portfolio_id,user_id,company_id,quantity,average_cost
)
select
  p.id,
  p.user_id,
  'c1111111-1111-4111-8111-111111111111',
  10,
  100
from public.portfolios p
where p.user_id='a1111111-1111-4111-8111-111111111111'
  and p.is_default;

insert into public.portfolio_positions(
  portfolio_id,user_id,company_id,quantity,average_cost
)
select
  p.id,
  p.user_id,
  'c2222222-2222-4222-8222-222222222222',
  20,
  200
from public.portfolios p
where p.user_id='a2222222-2222-4222-8222-222222222222'
  and p.is_default;

set local role authenticated;
set local "request.jwt.claim.sub" = 'a1111111-1111-4111-8111-111111111111';

select 1 / case
  when jsonb_array_length(public.get_my_portfolio_research_state_v1(now())->'positions')=1
  then 1 else 0 end
as user_a_has_one_position;

select 1 / case
  when public.get_my_portfolio_research_state_v1(now())->'positions'->0->>'ticker'='B2A_TEST'
  then 1 else 0 end
as user_a_only_sees_own_ticker;

select 1 / case
  when public.get_my_portfolio_research_state_v1(now())
    ->'positions'->0->'research_contract'->'coverage'->>'coverage_level'='MONITORED'
  then 1 else 0 end
as user_a_reads_group_a_coverage;

select 1 / case
  when public.get_my_portfolio_research_state_v1(now())
    ->'positions'->0->'research_contract'->'freshness'->'sec_filings'->>'status'='NEW_EVIDENCE'
  then 1 else 0 end
as user_a_reads_group_a_new_evidence;

select 1 / case
  when public.get_my_portfolio_research_state_v1(now())
    ->'positions'->0->'research_contract'->'freshness'->'market_data'->>'status'='CURRENT'
  then 1 else 0 end
as user_a_reads_group_a_current_state;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a2222222-2222-4222-8222-222222222222';

select 1 / case
  when jsonb_array_length(public.get_my_portfolio_research_state_v1(now())->'positions')=1
  then 1 else 0 end
as user_b_has_one_position;

select 1 / case
  when public.get_my_portfolio_research_state_v1(now())->'positions'->0->>'ticker'='B2B_TEST'
  then 1 else 0 end
as user_b_only_sees_own_ticker;

reset role;
set local role anon;
set local "request.jwt.claim.sub" = '';

do $b2$
begin
  begin
    perform public.get_my_portfolio_research_state_v1(now());
    raise exception 'B2 auth failure: anon executed portfolio research contract';
  exception
    when insufficient_privilege then null;
  end;
end
$b2$;

reset role;
rollback;
