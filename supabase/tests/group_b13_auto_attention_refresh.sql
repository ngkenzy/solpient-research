-- Group B / B13 automatic consumer attention refresh test.

begin;

insert into public.companies(id,ticker,company_name)
values (
  'd1311111-1111-4111-8111-111111111111',
  'B13A_TEST',
  'B13 Company A'
);

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values (
  'd1333333-3333-4333-8333-333333333333',
  'authenticated','authenticated','b13-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
);

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity
)
select
  'd1355555-5555-4555-8555-555555555555',
  p.id,
  p.user_id,
  'd1311111-1111-4111-8111-111111111111',
  10
from public.portfolios p
where p.user_id='d1333333-3333-4333-8333-333333333333'
  and p.is_default;

insert into public.user_alert_preferences(
  user_id,minimum_level,in_app_enabled,daily_digest_enabled
) values (
  'd1333333-3333-4333-8333-333333333333',
  'important',
  true,
  true
);

insert into public.company_change_events(
  company_id,event_key,category,metric_key,label,
  old_value,new_value,delta_value,delta_percent,
  direction,materiality,decision_impact,summary,
  source_kind,source_id,source_url,occurred_at
) values (
  'd1311111-1111-4111-8111-111111111111',
  'b13-material-event',
  'fundamental',
  'operating_margin',
  'Operating margin changed',
  25,20,-5,-20,
  'negative',
  'high',
  'review_thesis',
  'Operating margin declined materially.',
  'b13_test',
  'b13-source-1',
  'https://example.com/b13',
  current_date
);

set local role authenticated;
set local "request.jwt.claim.sub"='d1333333-3333-4333-8333-333333333333';

do $b13_auth_denied$
begin
  begin
    perform public.refresh_consumer_attention_batch_v1(
      current_date-1,
      current_date,
      20
    );
    raise exception 'B13 security failure: authenticated user executed service batch';
  exception when insufficient_privilege then null;
  end;
end
$b13_auth_denied$;

reset role;
set local role service_role;

select 1 / case when (
  public.refresh_consumer_attention_batch_v1(
    current_date-1,
    current_date,
    20
  )->>'status'
)='ok' then 1 else 0 end
as b13_batch_succeeds;

reset role;

select 1 / case when (
  select count(*)
  from public.thesis_alerts
  where user_id='d1333333-3333-4333-8333-333333333333'
    and position_id='d1355555-5555-4555-8555-555555555555'
    and score>=90
)=1 then 1 else 0 end
as b13_materializes_alert;

select 1 / case when (
  select alert_count
  from public.thesis_digest_snapshots
  where user_id='d1333333-3333-4333-8333-333333333333'
    and digest_date=current_date
)=1 then 1 else 0 end
as b13_refreshes_enabled_digest;

set local role authenticated;
set local "request.jwt.claim.sub"='d1333333-3333-4333-8333-333333333333';

select 1 / case when (
  select count(*) from public.thesis_alerts
)=1 then 1 else 0 end
as b13_user_reads_own_alert;

select 1 / case when (
  select count(*) from public.thesis_digest_snapshots
)=1 then 1 else 0 end
as b13_user_reads_own_digest;

rollback;
