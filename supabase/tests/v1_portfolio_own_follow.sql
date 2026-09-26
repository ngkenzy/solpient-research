-- V1 Portfolio — Own/Follow + position weights test.
-- Proves the new portfolio_positions columns (relationship, weight,
-- market_value), owner-scoped RLS on them, and the Stage B weight-aware
-- What Matters scoring (group-b-user-materiality-v2):
--   * a `high` event on a 0.5% position must NOT score like one on a 40% position
--   * missing position dollars -> equal weighting among owned names, not exclusion
--   * follow positions stay neutral (factor 1.0) and are never excluded

begin;

insert into public.companies(id,ticker,company_name)
values
  ('c1a11111-1111-4111-8111-111111111111','W1A_TEST','W1 Company A'),
  ('c1b22222-2222-4222-8222-222222222222','W1B_TEST','W1 Company B'),
  ('c1c33333-3333-4333-8333-333333333333','W1C_TEST','W1 Company C'),
  ('c1d44444-4444-4444-8444-444444444444','W1D_TEST','W1 Company D'),
  ('c1e55555-5555-4555-8555-555555555555','W1E_TEST','W1 Company E'),
  ('c1f66666-6666-4666-8666-666666666666','W1F_TEST','W1 Company F'),
  ('c1a77777-7777-4777-8777-777777777777','W1G_TEST','W1 Company G');

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  'd1a11111-1111-4111-8111-111111111111',
  'authenticated','authenticated','w1-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
),
(
  'd1b22222-2222-4222-8222-222222222222',
  'authenticated','authenticated','w1-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
);

-- User A default portfolio: 40% owned, 0.5% owned, one follow.
insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity,average_cost,relationship,market_value
)
select
  'e1a11111-1111-4111-8111-111111111111',
  p.id,p.user_id,
  'c1a11111-1111-4111-8111-111111111111',
  100,400,'own',40000
from public.portfolios p
where p.user_id='d1a11111-1111-4111-8111-111111111111'
  and p.is_default;

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity,average_cost,relationship,market_value
)
select
  'e1b22222-2222-4222-8222-222222222222',
  p.id,p.user_id,
  'c1b22222-2222-4222-8222-222222222222',
  10,50,'own',500
from public.portfolios p
where p.user_id='d1a11111-1111-4111-8111-111111111111'
  and p.is_default;

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity,relationship
)
select
  'e1c33333-3333-4333-8333-333333333333',
  p.id,p.user_id,
  'c1c33333-3333-4333-8333-333333333333',
  1,'follow'
from public.portfolios p
where p.user_id='d1a11111-1111-4111-8111-111111111111'
  and p.is_default;

-- User A second portfolio: no dollar info anywhere -> equal weighting.
insert into public.portfolios(id,user_id,name,is_default,base_currency)
values (
  'f1e00000-0000-4000-8000-000000000000',
  'd1a11111-1111-4111-8111-111111111111',
  'W1 Equal Test',false,'USD'
);

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity,relationship
) values
(
  'e1d44444-4444-4444-8444-444444444444',
  'f1e00000-0000-4000-8000-000000000000',
  'd1a11111-1111-4111-8111-111111111111',
  'c1d44444-4444-4444-8444-444444444444',
  5,'own'
),
(
  'e1e55555-5555-4555-8555-555555555555',
  'f1e00000-0000-4000-8000-000000000000',
  'd1a11111-1111-4111-8111-111111111111',
  'c1e55555-5555-4555-8555-555555555555',
  7,'own'
);

-- Relationship defaults to 'own' when omitted.
insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity
)
select
  'e1f66666-6666-4666-8666-666666666666',
  p.id,p.user_id,
  'c1f66666-6666-4666-8666-666666666666',
  5
from public.portfolios p
where p.user_id='d1b22222-2222-4222-8222-222222222222'
  and p.is_default;

select 1 / case when (
  select relationship from public.portfolio_positions
  where id='e1f66666-6666-4666-8666-666666666666'
)='own' then 1 else 0 end
as w1_relationship_defaults_to_own;

select 1 / case when (
  select weight is null and market_value is null
  from public.portfolio_positions
  where id='e1f66666-6666-4666-8666-666666666666'
) then 1 else 0 end
as w1_weight_and_market_value_default_null;

-- Check constraint rejects anything outside own/follow.
do $w1_rel_check$
declare
  v_portfolio uuid;
begin
  select id into v_portfolio from public.portfolios
  where user_id='d1a11111-1111-4111-8111-111111111111' and is_default;

  begin
    insert into public.portfolio_positions(
      portfolio_id,user_id,company_id,quantity,relationship
    ) values (
      v_portfolio,
      'd1a11111-1111-4111-8111-111111111111',
      'c1a77777-7777-4777-8777-777777777777',
      1,'bogus'
    );
    raise exception 'W1 failure: invalid relationship accepted';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.portfolio_positions(
      portfolio_id,user_id,company_id,quantity,weight
    ) values (
      v_portfolio,
      'd1a11111-1111-4111-8111-111111111111',
      'c1a77777-7777-4777-8777-777777777777',
      1,150
    );
    raise exception 'W1 failure: out-of-range weight accepted';
  exception
    when check_violation then null;
  end;
end
$w1_rel_check$;

-- Snapshots + high-materiality events for every fixture company.
insert into public.company_state_snapshots(
  company_id,state_version,snapshot_date,observed_at,state_hash,state_payload
)
select
  c.id,'company-state-v1',current_date,now(),repeat('a',64),'{}'::jsonb
from public.companies c
where c.ticker like 'W1%_TEST';

insert into public.company_change_events(
  company_id,current_snapshot_id,event_key,category,metric_key,label,
  old_value,new_value,delta_value,delta_percent,direction,materiality,
  decision_impact,summary,occurred_at
)
select
  c.id,
  css.id,
  'w1-'||c.ticker,'financial','revenue_growth','Revenue growth',
  15,5,-10,-66.7,'down','high','weakening',
  'W1 high-materiality fixture for '||c.ticker||'.',current_date
from public.companies c
join public.company_state_snapshots css on css.company_id=c.id
where c.ticker like 'W1%_TEST';

set local role authenticated;
set local "request.jwt.claim.sub"='d1a11111-1111-4111-8111-111111111111';

create temporary table w1_items as
select elem
from jsonb_array_elements(
  public.get_my_what_matters_v1(current_date-1,50)->'items'
) elem;

select 1 / case when (
  select (elem->'user_materiality'->>'methodology_version')
  from w1_items
  limit 1
)='group-b-user-materiality-v2' then 1 else 0 end
as w1_methodology_version_v2;

-- 40% position: 90 * (40000/40500 * 2) clamps to 100 -> thesis_priority.
select 1 / case when (
  select (elem->'user_materiality'->>'score')::integer
  from w1_items
  where elem->'position'->>'ticker'='W1A_TEST'
)=100 then 1 else 0 end
as w1a_large_position_scores_100;

select 1 / case when (
  select elem->'user_materiality'->>'level'
  from w1_items
  where elem->'position'->>'ticker'='W1A_TEST'
)='thesis_priority' then 1 else 0 end
as w1a_large_position_is_thesis_priority;

select 1 / case when (
  select (elem->'position'->>'weight_share')::numeric
  from w1_items
  where elem->'position'->>'ticker'='W1A_TEST'
) between 0.98 and 1.0 then 1 else 0 end
as w1a_weight_share_is_40pct_of_portfolio;

-- 0.5% position: 90 * (500/40500 * 2) ~= 2 -> background, still present.
select 1 / case when (
  select (elem->'user_materiality'->>'score')::integer
  from w1_items
  where elem->'position'->>'ticker'='W1B_TEST'
) < 50 then 1 else 0 end
as w1b_tiny_position_scores_background;

select 1 / case when (
  select (elem->'user_materiality'->>'score')::integer
  from w1_items
  where elem->'position'->>'ticker'='W1B_TEST'
) < (
  select (elem->'user_materiality'->>'score')::integer
  from w1_items
  where elem->'position'->>'ticker'='W1A_TEST'
) then 1 else 0 end
as w1b_scores_below_w1a;

select 1 / case when (
  select elem->'position'->>'weight_basis'
  from w1_items
  where elem->'position'->>'ticker'='W1B_TEST'
)='market_value' then 1 else 0 end
as w1b_weight_basis_is_market_value;

-- Follow position: neutral factor, never excluded.
select 1 / case when (
  select count(*) from w1_items
  where elem->'position'->>'ticker'='W1C_TEST'
)=1 then 1 else 0 end
as w1c_follow_position_not_excluded;

select 1 / case when (
  select (elem->'position'->>'weight_factor')::numeric
  from w1_items
  where elem->'position'->>'ticker'='W1C_TEST'
)=1.0 then 1 else 0 end
as w1c_follow_weight_factor_neutral;

select 1 / case when (
  select elem->'position'->>'relationship'
  from w1_items
  where elem->'position'->>'ticker'='W1C_TEST'
)='follow' then 1 else 0 end
as w1c_relationship_surfaced;

-- Equal-weighting portfolio: no dollars -> factor 1.0, both items present.
select 1 / case when (
  select count(*) from w1_items
  where elem->'position'->>'ticker' in ('W1D_TEST','W1E_TEST')
)=2 then 1 else 0 end
as w1de_equal_weight_items_not_excluded;

select 1 / case when (
  select bool_and((elem->'position'->>'weight_factor')::numeric=1.0)
  from w1_items
  where elem->'position'->>'ticker' in ('W1D_TEST','W1E_TEST')
) then 1 else 0 end
as w1de_equal_weight_factor_is_one;

select 1 / case when (
  select bool_and(elem->'position'->>'weight_basis'='equal_share')
  from w1_items
  where elem->'position'->>'ticker' in ('W1D_TEST','W1E_TEST')
) then 1 else 0 end
as w1de_equal_weight_basis_reported;

select 1 / case when (
  select bool_and((elem->'user_materiality'->>'score')::integer=90)
  from w1_items
  where elem->'position'->>'ticker' in ('W1D_TEST','W1E_TEST')
) then 1 else 0 end
as w1de_equal_weight_keeps_v1_score;

-- RLS: user B sees none of user A's positions, including new columns.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='d1b22222-2222-4222-8222-222222222222';

select 1 / case when (
  select count(*) from public.portfolio_positions
  where user_id='d1a11111-1111-4111-8111-111111111111'
)=0 then 1 else 0 end
as w1_user_b_cannot_read_user_a_positions;

select 1 / case when (
  select count(*) from public.portfolio_positions
  where relationship='follow'
)=0 then 1 else 0 end
as w1_user_b_cannot_read_follow_column;

select 1 / case when (
  select (public.get_my_what_matters_v1(current_date-1,50)->>'item_count')::integer
)=1 then 1 else 0 end
as w1_user_b_has_one_item;

select 1 / case when (
  select public.get_my_what_matters_v1(current_date-1,50)
    ->'items'->0->'position'->>'ticker'
)='W1F_TEST' then 1 else 0 end
as w1_user_b_only_sees_own_company;

reset role;
set local role anon;
set local "request.jwt.claim.sub"='';

do $w1_anon$
begin
  begin
    perform public.get_my_what_matters_v1(current_date-1,50);
    raise exception 'W1 auth failure: anon executed What Matters contract';
  exception
    when insufficient_privilege then null;
  end;
end
$w1_anon$;

reset role;

rollback;
