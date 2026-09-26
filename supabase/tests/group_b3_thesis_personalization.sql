-- Group B / B3 clean-start thesis personalization test.

begin;

insert into public.companies(id,ticker,company_name)
values
  ('d1111111-1111-4111-8111-111111111111','B3A_TEST','B3 Company A'),
  ('d2222222-2222-4222-8222-222222222222','B3B_TEST','B3 Company B')
on conflict (id) do nothing;

insert into public.research_runs(
  id,company_id,version,status,published_at,summary
) values
(
  'e1111111-1111-4111-8111-111111111111',
  'd1111111-1111-4111-8111-111111111111',
  1,'published',now(),'B3 A published research'
),
(
  'e2222222-2222-4222-8222-222222222222',
  'd2222222-2222-4222-8222-222222222222',
  1,'published',now(),'B3 B published research'
);

insert into public.thesis_variables(
  id,research_run_id,variable_name,metric_key,expectation,status,breaker_condition
) values
(
  'f1111111-1111-4111-8111-111111111111',
  'e1111111-1111-4111-8111-111111111111',
  'B3 A margin durability','operating_margin',
  'Margins remain durable','unchanged','Margins structurally compress'
),
(
  'f2222222-2222-4222-8222-222222222222',
  'e2222222-2222-4222-8222-222222222222',
  'B3 B revenue durability','revenue_growth',
  'Revenue remains durable','unchanged','Revenue structurally declines'
);

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  'b3111111-1111-4111-8111-111111111111',
  'authenticated','authenticated','b3-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"B3 User A"}'::jsonb,
  now(),now(),false,false
),
(
  'b3222222-2222-4222-8222-222222222222',
  'authenticated','authenticated','b3-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"B3 User B"}'::jsonb,
  now(),now(),false,false
);

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity,average_cost
)
select
  'c3111111-1111-4111-8111-111111111111',
  p.id,p.user_id,
  'd1111111-1111-4111-8111-111111111111',
  10,100
from public.portfolios p
where p.user_id='b3111111-1111-4111-8111-111111111111'
  and p.is_default;

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity,average_cost
)
select
  'c3222222-2222-4222-8222-222222222222',
  p.id,p.user_id,
  'd2222222-2222-4222-8222-222222222222',
  20,200
from public.portfolios p
where p.user_id='b3222222-2222-4222-8222-222222222222'
  and p.is_default;

set local role authenticated;
set local "request.jwt.claim.sub"='b3111111-1111-4111-8111-111111111111';

insert into public.position_thesis_factors(
  position_id,user_id,source_type,canonical_thesis_variable_id,
  factor_key,factor_label,importance,personal_expectation,enabled
) values (
  'c3111111-1111-4111-8111-111111111111',
  'b3111111-1111-4111-8111-111111111111',
  'canonical',
  'f1111111-1111-4111-8111-111111111111',
  'ignored-by-guard',
  'ignored by guard',
  5,
  'This is central to my thesis.',
  true
);

select 1 / case when (
  select count(*) from public.position_thesis_factors
  where factor_key='canonical:metric:operating_margin'
    and factor_label='B3 A margin durability'
    and importance=5
)=1 then 1 else 0 end
as canonical_factor_is_normalized;

insert into public.position_thesis_factors(
  position_id,user_id,source_type,factor_key,factor_label,
  importance,personal_expectation,personal_breaker_condition
) values (
  'c3111111-1111-4111-8111-111111111111',
  'b3111111-1111-4111-8111-111111111111',
  'custom',
  'custom:test',
  'Management execution',
  4,
  'Execution remains disciplined.',
  'Capital allocation becomes persistently value destructive.'
);

select 1 / case when (
  select count(*) from public.position_thesis_factors
)=2 then 1 else 0 end
as user_a_sees_two_own_factors;

do $b3_company$
begin
  begin
    insert into public.position_thesis_factors(
      position_id,user_id,source_type,canonical_thesis_variable_id,
      factor_key,factor_label
    ) values (
      'c3111111-1111-4111-8111-111111111111',
      'b3111111-1111-4111-8111-111111111111',
      'canonical',
      'f2222222-2222-4222-8222-222222222222',
      'ignored',
      'wrong company'
    );
    raise exception 'B3 provenance failure: cross-company canonical factor inserted';
  exception
    when check_violation then null;
  end;
end
$b3_company$;

do $b3_user$
begin
  begin
    insert into public.position_thesis_factors(
      position_id,user_id,source_type,factor_key,factor_label
    ) values (
      'c3222222-2222-4222-8222-222222222222',
      'b3222222-2222-4222-8222-222222222222',
      'custom',
      'custom:forbidden',
      'Forbidden'
    );
    raise exception 'B3 isolation failure: user A inserted user B thesis factor';
  exception
    when insufficient_privilege then null;
  end;
end
$b3_user$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='b3222222-2222-4222-8222-222222222222';

select 1 / case when (
  select count(*) from public.position_thesis_factors
)=0 then 1 else 0 end
as user_b_cannot_read_user_a_factors;

reset role;

select 1 / case when (
  select c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname='position_thesis_factors'
) then 1 else 0 end
as b3_rls_enabled;

rollback;
