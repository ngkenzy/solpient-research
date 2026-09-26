-- V1 §21/§22 — analytics_events isolation + feedback taxonomy gate.
-- Entire fixture rolls back.

begin;

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  'a6111111-1111-4111-8111-111111111111',
  'authenticated','authenticated','v1-an-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
),
(
  'a6222222-2222-4222-8222-222222222222',
  'authenticated','authenticated','v1-an-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
);

-- RLS is enabled on analytics_events.
select 1 / case when (
  select relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='analytics_events'
) then 1 else 0 end as rls_enabled_on_analytics_events;

set local role authenticated;
set local "request.jwt.claim.sub" = 'a6111111-1111-4111-8111-111111111111';

-- Owner can insert their own event.
insert into public.analytics_events(user_id,event_name,properties)
values(
  'a6111111-1111-4111-8111-111111111111',
  'research_opened',
  '{"source":"v1-test"}'::jsonb
);

-- Owner can select their own event.
do $v1an$
begin
  if (select count(*) from public.analytics_events
      where user_id='a6111111-1111-4111-8111-111111111111') <> 1 then
    raise exception 'V1 analytics failure: owner cannot read own event';
  end if;
end $v1an$;

-- Cross-user insert is denied by the owner policy.
do $v1an$
begin
  begin
    insert into public.analytics_events(user_id,event_name,properties)
    values(
      'a6222222-2222-4222-8222-222222222222',
      'research_opened',
      '{}'::jsonb
    );
    raise exception 'V1 analytics failure: user A inserted an event for user B';
  exception
    when insufficient_privilege then null;
  end;
end $v1an$;

-- Cross-user visibility is denied: user B sees zero rows of user A's data.
set local "request.jwt.claim.sub" = 'a6222222-2222-4222-8222-222222222222';
do $v1an$
begin
  if (select count(*) from public.analytics_events) <> 0 then
    raise exception 'V1 analytics failure: user B can read user A events';
  end if;
end $v1an$;

reset role;

-- Feedback taxonomy gate: new yes/no constraints present, old 4-value
-- constraint gone. No fixture rows needed; verifies the migration contract.
select 1 / case when exists(
  select 1
  from pg_constraint
  where conrelid='public.what_matters_feedback'::regclass
    and pg_get_constraintdef(oid) like '%''yes''%''no''%'
) then 1 else 0 end as feedback_yes_no_check_present;

select 1 / case when exists(
  select 1
  from pg_constraint
  where conrelid='public.what_matters_feedback'::regclass
    and pg_get_constraintdef(oid) like '%doesnt_affect_thesis%'
) then 1 else 0 end as feedback_no_reason_values_present;

select 1 / case when not exists(
  select 1
  from pg_constraint
  where conrelid='public.what_matters_feedback'::regclass
    and pg_get_constraintdef(oid) like '%''useful''%'
    and pg_get_constraintdef(oid) like '%''not_useful''%'
) then 1 else 0 end as feedback_old_taxonomy_removed;

select 1 / case when exists(
  select 1
  from information_schema.columns
  where table_schema='public'
    and table_name='what_matters_feedback'
    and column_name='no_reason'
) then 1 else 0 end as feedback_no_reason_column_present;

rollback;
