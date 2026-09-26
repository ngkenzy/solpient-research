-- Group B / B16 decision outcome attribution integrity test.

begin;

insert into public.companies(id,ticker,company_name)
values (
  'f1611111-1111-4111-8111-111111111111',
  'B16A_TEST',
  'B16 Company A'
);

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  'f1633333-3333-4333-8333-333333333333',
  'authenticated','authenticated','b16-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
),
(
  'f1644444-4444-4444-8444-444444444444',
  'authenticated','authenticated','b16-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
);

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity
)
select
  'f1655555-5555-4555-8555-555555555555',
  p.id,p.user_id,'f1611111-1111-4111-8111-111111111111',10
from public.portfolios p
where p.user_id='f1633333-3333-4333-8333-333333333333' and p.is_default;

insert into public.research_runs(
  id,company_id,version,status,benchmark_ticker
) values (
  'f1666666-6666-4666-8666-666666666666',
  'f1611111-1111-4111-8111-111111111111',
  1,'published','B16BENCH'
);

insert into public.position_decision_journal(
  id,user_id,position_id,company_id,decision_type,conviction,rationale,
  research_run_id,decision_snapshot,decided_at
) values (
  'f1677777-7777-4777-8777-777777777777',
  'f1633333-3333-4333-8333-333333333333',
  'f1655555-5555-4555-8555-555555555555',
  'f1611111-1111-4111-8111-111111111111',
  'add',4,'Historical fixture used to verify deterministic B16 attribution.',
  'f1666666-6666-4666-8666-666666666666',
  '{"contract_version":"group-b-position-decision-snapshot-v1"}'::jsonb,
  '2026-01-02 20:00:00+00'
);

insert into public.market_snapshots(
  company_id,symbol,observed_at,trading_date,price,provider,source_url,raw_payload
) values
(
  'f1611111-1111-4111-8111-111111111111','B16A_TEST','2025-12-31 22:00:00+00','2025-12-31',100,'b16-test','https://example.test/security/pre','{}'
),
(
  'f1611111-1111-4111-8111-111111111111','B16A_TEST','2026-01-02 22:00:00+00','2026-01-02',105,'b16-test','https://example.test/security/same-day','{}'
),
(
  'f1611111-1111-4111-8111-111111111111','B16A_TEST','2026-01-05 22:00:00+00','2026-01-05',110,'b16-test','https://example.test/security/observed','{}'
),
(
  null,'B16BENCH','2025-12-31 22:00:00+00','2025-12-31',200,'b16-test','https://example.test/benchmark/pre','{}'
),
(
  null,'B16BENCH','2026-01-02 22:00:00+00','2026-01-02',205,'b16-test','https://example.test/benchmark/same-day','{}'
),
(
  null,'B16BENCH','2026-01-05 22:00:00+00','2026-01-05',210,'b16-test','https://example.test/benchmark/observed','{}'
);

set local role service_role;

select public.refresh_decision_outcomes_batch_v1(50);

select 1 / case when (
  select count(*)
  from public.decision_outcome_snapshots
  where journal_entry_id='f1677777-7777-4777-8777-777777777777'
    and horizon='1d'
)=1 then 1 else 0 end
as b16_materializes_due_horizon;

select 1 / case when (
  select decision_price
  from public.decision_outcome_snapshots
  where journal_entry_id='f1677777-7777-4777-8777-777777777777'
    and horizon='1d'
)=100 then 1 else 0 end
as b16_anchor_uses_strictly_pre_decision_close;

select 1 / case when (
  select observed_trading_date
  from public.decision_outcome_snapshots
  where journal_entry_id='f1677777-7777-4777-8777-777777777777'
    and horizon='1d'
)='2026-01-05'::date then 1 else 0 end
as b16_weekend_target_uses_next_trading_day;

select 1 / case when abs((
  select security_return_pct
  from public.decision_outcome_snapshots
  where journal_entry_id='f1677777-7777-4777-8777-777777777777'
    and horizon='1d'
)-10)<0.000001 then 1 else 0 end
as b16_security_price_return_is_correct;

select 1 / case when abs((
  select benchmark_return_pct
  from public.decision_outcome_snapshots
  where journal_entry_id='f1677777-7777-4777-8777-777777777777'
    and horizon='1d'
)-5)<0.000001 then 1 else 0 end
as b16_benchmark_return_is_correct;

select 1 / case when abs((
  select excess_return_pct
  from public.decision_outcome_snapshots
  where journal_entry_id='f1677777-7777-4777-8777-777777777777'
    and horizon='1d'
)-5)<0.000001 then 1 else 0 end
as b16_excess_return_is_correct;

select public.refresh_decision_outcomes_batch_v1(50);

select 1 / case when (
  select count(*)
  from public.decision_outcome_snapshots
  where journal_entry_id='f1677777-7777-4777-8777-777777777777'
    and horizon='1d'
)=1 then 1 else 0 end
as b16_refresh_is_idempotent;

select 1 / case when not has_function_privilege(
  'authenticated',
  'public.refresh_decision_outcomes_batch_v1(integer)',
  'EXECUTE'
) then 1 else 0 end
as b16_authenticated_cannot_run_materializer;

select 1 / case when not has_function_privilege(
  'anon',
  'public.refresh_decision_outcomes_batch_v1(integer)',
  'EXECUTE'
) then 1 else 0 end
as b16_anon_cannot_run_materializer;

do $b16_service_fabrication$
begin
  begin
    insert into public.decision_outcome_snapshots(
      user_id,journal_entry_id,position_id,company_id,horizon,horizon_target_at,
      decision_market_snapshot_id,decision_price,decision_price_trading_date,decision_price_provider,
      observed_market_snapshot_id,observed_price,observed_trading_date,observed_price_provider,
      security_return_pct,benchmark_ticker
    )
    select
      user_id,id,position_id,company_id,'1w','2026-01-09',
      (select id from public.market_snapshots where symbol='B16A_TEST' and trading_date='2025-12-31' limit 1),
      100,'2025-12-31','b16-test',
      (select id from public.market_snapshots where symbol='B16A_TEST' and trading_date='2026-01-05' limit 1),
      110,'2026-01-05','b16-test',
      10,'B16BENCH'
    from public.position_decision_journal
    where id='f1677777-7777-4777-8777-777777777777';
    raise exception 'B16 integrity failure: service role fabricated an outcome directly';
  exception when insufficient_privilege then null;
  end;
end
$b16_service_fabrication$;

do $b16_service_rewrite$
begin
  begin
    update public.decision_outcome_snapshots
    set security_return_pct=999
    where journal_entry_id='f1677777-7777-4777-8777-777777777777';
    raise exception 'B16 integrity failure: service role rewrote outcome history';
  exception when insufficient_privilege then null;
  end;
end
$b16_service_rewrite$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='f1633333-3333-4333-8333-333333333333';

select 1 / case when (
  select count(*)
  from public.decision_outcome_snapshots
)=1 then 1 else 0 end
as b16_user_reads_own_outcomes;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='f1644444-4444-4444-8444-444444444444';

select 1 / case when (
  select count(*)
  from public.decision_outcome_snapshots
)=0 then 1 else 0 end
as b16_other_user_cannot_read_outcomes;

reset role;

delete from auth.users
where id='f1633333-3333-4333-8333-333333333333';

select 1 / case when (
  select count(*)
  from public.decision_outcome_snapshots
  where user_id='f1633333-3333-4333-8333-333333333333'
)=0 then 1 else 0 end
as b16_account_delete_cascades_outcomes;

rollback;
