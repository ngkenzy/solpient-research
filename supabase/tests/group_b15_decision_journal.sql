-- Group B / B15 append-only decision journal isolation test.

begin;

insert into public.companies(id,ticker,company_name)
values (
  'f1511111-1111-4111-8111-111111111111',
  'B15A_TEST',
  'B15 Company A'
);

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  'f1533333-3333-4333-8333-333333333333',
  'authenticated','authenticated','b15-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
),
(
  'f1544444-4444-4444-8444-444444444444',
  'authenticated','authenticated','b15-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
);

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity
)
select
  'f1555555-5555-4555-8555-555555555555',
  p.id,p.user_id,'f1511111-1111-4111-8111-111111111111',10
from public.portfolios p
where p.user_id='f1533333-3333-4333-8333-333333333333' and p.is_default;

set local role authenticated;
set local "request.jwt.claim.sub"='f1533333-3333-4333-8333-333333333333';

insert into public.position_thesis_factors(
  position_id,user_id,source_type,factor_key,factor_label,
  importance,personal_expectation,personal_breaker_condition
) values (
  'f1555555-5555-4555-8555-555555555555',
  'f1533333-3333-4333-8333-333333333333',
  'custom','custom:b15','Management execution',
  5,'Execution remains disciplined.','Capital allocation deteriorates.'
);

select public.record_my_position_decision_v1(
  'f1555555-5555-4555-8555-555555555555',
  'hold',
  4,
  'The thesis remains intact after reviewing current evidence.',
  null,
  null
) as first_decision_id
\gset

select 1 / case when (
  select count(*) from public.position_decision_journal
)=1 then 1 else 0 end
as b15_user_reads_own_decision;

select 1 / case when (
  select decision_snapshot->'personal_thesis_factors'->0->>'factor_label'
  from public.position_decision_journal
  where id=:'first_decision_id'::uuid
)='Management execution' then 1 else 0 end
as b15_snapshot_captures_personal_thesis;

select public.record_my_position_decision_v1(
  'f1555555-5555-4555-8555-555555555555',
  'hold',
  5,
  'Correction: conviction increased after another review.',
  null,
  :'first_decision_id'::uuid
) as correction_decision_id
\gset

select 1 / case when (
  select supersedes_decision_id
  from public.position_decision_journal
  where id=:'correction_decision_id'::uuid
)=:'first_decision_id'::uuid then 1 else 0 end
as b15_correction_links_prior_entry;

do $b15_direct_insert$
begin
  begin
    insert into public.position_decision_journal(
      user_id,position_id,company_id,decision_type,conviction,rationale,decision_snapshot
    ) values (
      'f1533333-3333-4333-8333-333333333333',
      'f1555555-5555-4555-8555-555555555555',
      'f1511111-1111-4111-8111-111111111111',
      'add',5,'Fabricated direct insert','{}'::jsonb
    );
    raise exception 'B15 integrity failure: authenticated direct insert succeeded';
  exception when insufficient_privilege then null;
  end;
end
$b15_direct_insert$;

select 1 / case when not has_table_privilege(
  'authenticated',
  'public.position_decision_journal',
  'UPDATE'
) then 1 else 0 end
as b15_authenticated_cannot_update_history;

select 1 / case when exists (
  select 1
  from pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname='position_decision_journal'
    and t.tgname='position_decision_journal_append_only_guard'
    and not t.tgisinternal
) then 1 else 0 end
as b15_append_only_guard_present;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='f1544444-4444-4444-8444-444444444444';

select 1 / case when (
  select count(*) from public.position_decision_journal
)=0 then 1 else 0 end
as b15_other_user_cannot_read_decisions;

rollback;
