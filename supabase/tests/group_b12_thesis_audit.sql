-- Group B / B12 thesis audit history and isolation test.

begin;

insert into public.companies(id,ticker,company_name)
values
  ('c121111-1111-4111-8111-111111111111','B12A_TEST','B12 Company A'),
  ('c122222-2222-4222-8222-222222222222','B12B_TEST','B12 Company B');

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  'c123333-3333-4333-8333-333333333333',
  'authenticated','authenticated','b12-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
),
(
  'c124444-4444-4444-8444-444444444444',
  'authenticated','authenticated','b12-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
);

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity
)
select
  'c125555-5555-4555-8555-555555555555',
  p.id,p.user_id,
  'c121111-1111-4111-8111-111111111111',
  10
from public.portfolios p
where p.user_id='c123333-3333-4333-8333-333333333333'
  and p.is_default;

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity
)
select
  'c126666-6666-4666-8666-666666666666',
  p.id,p.user_id,
  'c122222-2222-4222-8222-222222222222',
  20
from public.portfolios p
where p.user_id='c124444-4444-4444-8444-444444444444'
  and p.is_default;

set local role authenticated;
set local "request.jwt.claim.sub"='c123333-3333-4333-8333-333333333333';

insert into public.position_thesis_factors(
  position_id,user_id,source_type,factor_key,factor_label,
  importance,personal_expectation,personal_breaker_condition,enabled
) values (
  'c125555-5555-4555-8555-555555555555',
  'c123333-3333-4333-8333-333333333333',
  'custom',
  'custom:b12-test',
  'B12 management execution',
  3,
  'Execution stays disciplined.',
  'Capital allocation deteriorates.',
  true
);

update public.position_thesis_factors
set importance=5,
    personal_expectation='Execution stays exceptional.'
where position_id='c125555-5555-4555-8555-555555555555'
  and factor_key='custom:b12-test';

delete from public.position_thesis_factors
where position_id='c125555-5555-4555-8555-555555555555'
  and factor_key='custom:b12-test';

select 1 / case when (
  select count(*)
  from public.position_thesis_factor_history
  where position_id='c125555-5555-4555-8555-555555555555'
)=3 then 1 else 0 end
as b12_records_add_update_remove;

select 1 / case when (
  select array_agg(event_type order by changed_at,id)
  from public.position_thesis_factor_history
  where position_id='c125555-5555-4555-8555-555555555555'
)=array['factor_added','factor_updated','factor_removed']::text[]
then 1 else 0 end
as b12_history_order;

select 1 / case when (
  select importance_before=3 and importance_after=5
  from public.position_thesis_factor_history
  where position_id='c125555-5555-4555-8555-555555555555'
    and event_type='factor_updated'
)=true then 1 else 0 end
as b12_update_diff_preserved;

do $b12_direct_insert$
begin
  begin
    insert into public.position_thesis_factor_history(
      user_id,position_id,source_type,factor_key,factor_label,event_type
    ) values (
      'c123333-3333-4333-8333-333333333333',
      'c125555-5555-4555-8555-555555555555',
      'custom','custom:fake','Fake','factor_added'
    );
    raise exception 'B12 integrity failure: authenticated user fabricated history';
  exception when insufficient_privilege then null;
  end;
end
$b12_direct_insert$;

select 1 / case when (
  (public.get_my_position_thesis_audit_v1(
    'c125555-5555-4555-8555-555555555555',
    current_date-1,
    50
  )->>'timeline_count')::integer >= 3
) then 1 else 0 end
as b12_user_a_reads_own_audit;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='c124444-4444-4444-8444-444444444444';

select 1 / case when (
  select count(*) from public.position_thesis_factor_history
)=0 then 1 else 0 end
as b12_user_b_cannot_read_user_a_history;

do $b12_cross_user_rpc$
begin
  begin
    perform public.get_my_position_thesis_audit_v1(
      'c125555-5555-4555-8555-555555555555',
      current_date-1,
      50
    );
    raise exception 'B12 isolation failure: user B read user A audit';
  exception when insufficient_privilege then null;
  end;
end
$b12_cross_user_rpc$;

reset role;
set local role service_role;

do $b12_append_only$
begin
  begin
    update public.position_thesis_factor_history
    set factor_label='Tampered'
    where position_id='c125555-5555-4555-8555-555555555555';
    raise exception 'B12 integrity failure: history row was updated';
  exception when raise_exception then null;
  end;
end
$b12_append_only$;

reset role;

select 1 / case when (
  select c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname='position_thesis_factor_history'
) then 1 else 0 end
as b12_rls_enabled;

rollback;
