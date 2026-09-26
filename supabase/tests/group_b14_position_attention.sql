-- Group B / B14 per-position attention-control integration test.

begin;

insert into public.companies(id,ticker,company_name)
values
  ('e1411111-1111-4111-8111-111111111111','B14A_TEST','B14 Company A'),
  ('e1422222-2222-4222-8222-222222222222','B14B_TEST','B14 Company B');

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values (
  'e1433333-3333-4333-8333-333333333333',
  'authenticated','authenticated','b14-user@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
);

insert into public.portfolio_positions(id,portfolio_id,user_id,company_id,quantity)
select
  'e1455555-5555-4555-8555-555555555555',
  p.id,p.user_id,'e1411111-1111-4111-8111-111111111111',10
from public.portfolios p
where p.user_id='e1433333-3333-4333-8333-333333333333' and p.is_default;

insert into public.portfolio_positions(id,portfolio_id,user_id,company_id,quantity)
select
  'e1466666-6666-4666-8666-666666666666',
  p.id,p.user_id,'e1422222-2222-4222-8222-222222222222',10
from public.portfolios p
where p.user_id='e1433333-3333-4333-8333-333333333333' and p.is_default;

insert into public.user_alert_preferences(
  user_id,minimum_level,in_app_enabled,daily_digest_enabled
) values (
  'e1433333-3333-4333-8333-333333333333',
  'important',true,true
);

set local role authenticated;
set local "request.jwt.claim.sub"='e1433333-3333-4333-8333-333333333333';

insert into public.position_attention_preferences(
  position_id,user_id,attention_enabled,minimum_level,digest_enabled
) values
(
  'e1455555-5555-4555-8555-555555555555',
  'e1433333-3333-4333-8333-333333333333',
  true,'thesis_priority',true
),
(
  'e1466666-6666-4666-8666-666666666666',
  'e1433333-3333-4333-8333-333333333333',
  false,'background',true
);

select 1 / case when (
  select count(*) from public.position_attention_preferences
)=2 then 1 else 0 end
as b14_user_reads_own_attention_settings;

reset role;
set local role service_role;

insert into public.company_change_events(
  company_id,event_key,category,metric_key,label,
  old_value,new_value,delta_value,delta_percent,
  direction,materiality,decision_impact,summary,
  source_kind,source_id,source_url,occurred_at
) values
(
  'e1411111-1111-4111-8111-111111111111',
  'b14-a-material','financial','operating_margin','B14 A margin changed',
  25,20,-5,-20,'negative','high','review_thesis','A changed materially.',
  'b14_test','b14-a','https://example.com/b14-a',current_date
),
(
  'e1422222-2222-4222-8222-222222222222',
  'b14-b-material','financial','operating_margin','B14 B margin changed',
  25,20,-5,-20,'negative','high','review_thesis','B changed materially.',
  'b14_test','b14-b','https://example.com/b14-b',current_date
);

select 1 / case when (
  public.refresh_consumer_attention_batch_v1(
    current_date-1,current_date,20
  )->>'status'
)='ok' then 1 else 0 end
as b14_batch_succeeds;

reset role;

select 1 / case when (
  select count(*)
  from public.thesis_alerts
  where user_id='e1433333-3333-4333-8333-333333333333'
    and position_id='e1455555-5555-4555-8555-555555555555'
)=1 then 1 else 0 end
as b14_enabled_position_materializes_alert;

select 1 / case when (
  select count(*)
  from public.thesis_alerts
  where user_id='e1433333-3333-4333-8333-333333333333'
    and position_id='e1466666-6666-4666-8666-666666666666'
)=0 then 1 else 0 end
as b14_muted_position_does_not_materialize_alert;

select 1 / case when (
  select alert_count
  from public.thesis_digest_snapshots
  where user_id='e1433333-3333-4333-8333-333333333333'
    and digest_date=current_date
)=1 then 1 else 0 end
as b14_digest_contains_only_enabled_position;

set local role authenticated;
set local "request.jwt.claim.sub"='e1433333-3333-4333-8333-333333333333';

update public.position_attention_preferences
set digest_enabled=false
where position_id='e1455555-5555-4555-8555-555555555555';

select 1 / case when (
  public.refresh_my_daily_digest_v1(current_date)->>'status'
)='ready' then 1 else 0 end
as b14_digest_refreshes_after_position_exclusion;

select 1 / case when (
  select alert_count
  from public.thesis_digest_snapshots
  where user_id='e1433333-3333-4333-8333-333333333333'
    and digest_date=current_date
)=0 then 1 else 0 end
as b14_position_can_be_excluded_from_digest;

rollback;
