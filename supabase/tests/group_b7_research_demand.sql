-- Group B / B7 research-demand isolation and aggregate test.

begin;

insert into public.companies(id,ticker,company_name)
values
  ('b7111111-1111-4111-8111-111111111111','B7A_TEST','B7 Company A'),
  ('b7222222-2222-4222-8222-222222222222','B7B_TEST','B7 Company B');

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  'b7333333-3333-4333-8333-333333333333',
  'authenticated','authenticated','b7-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
),
(
  'b7444444-4444-4444-8444-444444444444',
  'authenticated','authenticated','b7-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
);

set local role authenticated;
set local "request.jwt.claim.sub"='b7333333-3333-4333-8333-333333333333';

insert into public.research_demand_requests(
  user_id,company_id,request_type,priority,question,reason
) values (
  'b7333333-3333-4333-8333-333333333333',
  'b7111111-1111-4111-8111-111111111111',
  'deep_dive',5,'How durable is the moat?','I own this company.'
);

select 1 / case when (select count(*) from public.research_demand_requests)=1 then 1 else 0 end
as b7_user_a_sees_own_request;

do $b7_cross_user$
begin
  begin
    insert into public.research_demand_requests(
      user_id,company_id,request_type,priority
    ) values (
      'b7444444-4444-4444-8444-444444444444',
      'b7222222-2222-4222-8222-222222222222',
      'coverage',4
    );
    raise exception 'B7 isolation failure: user A wrote user B request';
  exception when insufficient_privilege then null;
  end;
end
$b7_cross_user$;

do $b7_aggregate_auth$
begin
  begin
    perform * from public.get_research_demand_summary_v1();
    raise exception 'B7 privacy failure: authenticated user executed aggregate demand RPC';
  exception when insufficient_privilege then null;
  end;
end
$b7_aggregate_auth$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='b7444444-4444-4444-8444-444444444444';

insert into public.research_demand_requests(
  user_id,company_id,request_type,priority,question
) values (
  'b7444444-4444-4444-8444-444444444444',
  'b7111111-1111-4111-8111-111111111111',
  'refresh',4,'What changed since last quarter?'
);

select 1 / case when (select count(*) from public.research_demand_requests)=1 then 1 else 0 end
as b7_user_b_sees_only_own_request;

reset role;
set local role service_role;

select 1 / case when (
  select request_count
  from public.get_research_demand_summary_v1()
  where company_id='b7111111-1111-4111-8111-111111111111'
)=2 then 1 else 0 end
as b7_aggregate_counts_two_users;

select 1 / case when (
  select high_priority_count
  from public.get_research_demand_summary_v1()
  where company_id='b7111111-1111-4111-8111-111111111111'
)=2 then 1 else 0 end
as b7_high_priority_count;

select 1 / case when (
  select latest_question
  from public.get_research_demand_summary_v1()
  where company_id='b7111111-1111-4111-8111-111111111111'
) is not null then 1 else 0 end
as b7_aggregate_preserves_question_without_identity;

reset role;

select 1 / case when (
  select c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname='research_demand_requests'
) then 1 else 0 end
as b7_rls_enabled;

rollback;
