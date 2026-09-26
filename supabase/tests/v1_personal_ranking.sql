-- V1 Personal Ranking test (PRD Build 3).
-- Proves:
--   * universe scoping: user B's names never appear in user A's ranking
--     (and vice versa) — the ranking never compares across users
--   * owned_boost: at equal company materiality an owned item outranks a
--     watched item (1.25 vs 0.75, deterministic scores)
--   * pinned thesis factors boost a watched item (but it stays below an
--     equally-material owned item)
--   * supplier/competitor events attach to the owned company whose thesis
--     they affect (explicit affected_company_id wins; financial events do
--     not attach); the What Matters item is filed under the owned company
--   * monitored-name cap enforcement on Add (new names rejected at cap,
--     upserts of monitored names pass; Free default 12)
--   * deep-research quota on Request (rolling 30d; other types unaffected;
--     upserts of existing requests unaffected) + quota readout + queue
--     position for the caller's own request only
--   * owner-scoped RLS throughout; methodology_version = personal-ranking-v1

begin;

-- Fixture companies.
insert into public.companies(id,ticker,company_name)
values
  ('b30a1111-1111-4111-8111-111111111111','OWNA','P3 Owned A'),
  ('b30b2222-2222-4222-8222-222222222222','OWNB','P3 Owned B'),
  ('b30c3333-3333-4333-8333-333333333333','WTCH','P3 Watched C'),
  ('b30d4444-4444-4334-8344-444444444444','SUPL','P3 Supplier S'),
  ('b30e5555-5555-4335-8355-555555555555','COMP','P3 Competitor D'),
  ('b30f6666-6666-4336-8366-666666666666','BCO_','P3 User-B Co'),
  ('b30a7777-7777-4337-8377-777777777777','NEWCO','P3 New Co');

-- Fixture users. The default-portfolio/profile trigger provisions rows.
insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  'b3d11111-1111-4111-8111-111111111111',
  'authenticated','authenticated','p3-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
),
(
  'b3d22222-2222-4222-8222-222222222222',
  'authenticated','authenticated','p3-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
),
(
  'b3d33333-3333-4333-8333-333333333333',
  'authenticated','authenticated','p3-user-c@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
);

-- User A: owns OWNA (40k) + OWNB (10k), watches WTCH.
insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity,average_cost,relationship,market_value
)
select
  x.id, p.id, p.user_id, x.company_id, 100, 400, x.relationship, x.market_value
from public.portfolios p
join (values
  ('b3e11111-1111-4111-8111-111111111111'::uuid,'b30a1111-1111-4111-8111-111111111111'::uuid,'own',40000),
  ('b3e22222-2222-4222-8222-222222222222'::uuid,'b30b2222-2222-4222-8222-222222222222'::uuid,'own',10000),
  ('b3e33333-3333-4333-8333-333333333333'::uuid,'b30c3333-3333-4333-8333-333333333333'::uuid,'follow',null)
) as x(id,company_id,relationship,market_value)
on true
where p.user_id='b3d11111-1111-4111-8111-111111111111'
  and p.is_default;

-- User B: owns BCO_.
insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity,average_cost,relationship,market_value
)
select
  'b3e44444-4444-4334-8344-444444444444',
  p.id,p.user_id,
  'b30f6666-6666-4336-8366-666666666666',
  100,400,'own',40000
from public.portfolios p
where p.user_id='b3d22222-2222-4222-8222-222222222222'
  and p.is_default;

-- Company relationships: SUPL supplies OWNA; COMP competes with OWNB;
-- COMP also supplies OWNA (so the deterministic pick for COMP would be OWNA
-- via supplier priority — used to prove explicit affected_company_id wins).
insert into public.company_relationships(
  id,company_id,related_company_id,relationship_type,provenance
) values
(
  'b3f11111-1111-4111-8111-111111111111',
  'b30a1111-1111-4111-8111-111111111111',
  'b30d4444-4444-4334-8344-444444444444',
  'supplier','p3 fixture'
),
(
  'b3f22222-2222-4222-8222-222222222222',
  'b30b2222-2222-4222-8222-222222222222',
  'b30e5555-5555-4335-8355-555555555555',
  'competitor','p3 fixture'
),
(
  'b3f33333-3333-4333-8333-333333333333',
  'b30a1111-1111-4111-8111-111111111111',
  'b30e5555-5555-4335-8355-555555555555',
  'supplier','p3 fixture'
);

-- Events.
insert into public.company_change_events(
  id,company_id,event_key,category,metric_key,label,
  direction,materiality,decision_impact,summary,occurred_at,
  source_kind,confidence,knowledge_time,disclosure_time,affected_company_id
) values
(
  'b3c11111-1111-4111-8111-111111111111',
  'b30a1111-1111-4111-8111-111111111111',
  'p3:e1','guidance','guidance_revenue_fy','FY26 revenue guidance lowered',
  'down','high','weakening','Guidance cut on OWNA.',current_date,
  'sec-filing',88,now() - interval '3 hours',now(),null
),
(
  'b3c22222-2222-4222-8222-222222222222',
  'b30c3333-3333-4333-8333-333333333333',
  'p3:e2','guidance','guidance_revenue_fy','FY26 revenue guidance lowered',
  'down','high','weakening','Guidance cut on WTCH.',current_date,
  'sec-filing',80,now() - interval '3 hours',now(),null
),
(
  'b3c33333-3333-4333-8333-333333333333',
  'b30d4444-4444-4334-8344-444444444444',
  'p3:e3','competition','event.competition.supply_cut','Key input supply cut',
  'down','high','weakening','Supplier SUPL cut key input supply.',current_date,
  'press',75,now() - interval '2 hours',now(),null
),
(
  'b3c44444-4444-4334-8344-444444444444',
  'b30e5555-5555-4335-8355-555555555555',
  'p3:e4','competition','event.competition.product_launch','Rival launches competing product',
  'down','material','weakening','Competitor COMP launched a rival product.',current_date,
  'press',70,now() - interval '2 hours',now(),
  'b30b2222-2222-4222-8222-222222222222'
),
(
  'b3c55555-5555-4335-8355-555555555555',
  'b30f6666-6666-4336-8366-666666666666',
  'p3:e5','guidance','guidance_revenue_fy','FY26 revenue guidance lowered',
  'down','high','weakening','Guidance cut on BCO_.',current_date,
  'sec-filing',88,now() - interval '3 hours',now(),null
),
(
  'b3c66666-6666-4336-8366-666666666666',
  'b30d4444-4444-4334-8344-444444444444',
  'p3:e6','financial','rev','Quarterly revenue',
  'up','notable','neutral','SUPL quarterly revenue beat.',current_date,
  'filing',85,now() - interval '1 hour',now(),null
);

-- Canonical thesis stubs for the pinned-factor test. The real migration chain
-- already has these research-side tables, so create them only in a partial
-- harness (IF NOT EXISTS). The guard trigger needs published research runs
-- and thesis variables with the columns it reads.
create table if not exists public.research_runs(
  id uuid primary key, company_id uuid, status text
);
create table if not exists public.thesis_variables(
  id uuid primary key, research_run_id uuid, company_id uuid,
  variable_name text, metric_key text
);
insert into public.research_runs(id,company_id,status) values
  ('b3a11111-1111-4111-8111-111111111111','b30a1111-1111-4111-8111-111111111111','published'),
  ('b3a22222-2222-4222-8222-222222222222','b30c3333-3333-4333-8333-333333333333','published');
insert into public.thesis_variables(id,research_run_id,company_id,variable_name,metric_key) values
  ('b3a33333-3333-4333-8333-333333333333','b3a11111-1111-4111-8111-111111111111','b30a1111-1111-4111-8111-111111111111','Revenue guidance','guidance_revenue_fy'),
  ('b3a44444-4444-4334-8344-444444444444','b3a22222-2222-4222-8222-222222222222','b30c3333-3333-4333-8333-333333333333','Revenue guidance','guidance_revenue_fy');

-- Pinned factor on A's OWNA position (importance 5 -> +10 boost).
insert into public.position_thesis_factors(
  id,position_id,user_id,source_type,canonical_thesis_variable_id,importance,enabled
) values (
  'b3a55555-5555-4335-8355-555555555555',
  'b3e11111-1111-4111-8111-111111111111',
  'b3d11111-1111-4111-8111-111111111111',
  'canonical','b3a33333-3333-4333-8333-333333333333',5,true
);

-- Stage A assessments for all events (superuser path; pipeline uses service_role).
reset role;
do $p3_assess$
begin
  perform consumer_private.assess_company_event_materiality_v1('b3c11111-1111-4111-8111-111111111111');
  perform consumer_private.assess_company_event_materiality_v1('b3c22222-2222-4222-8222-222222222222');
  perform consumer_private.assess_company_event_materiality_v1('b3c33333-3333-4333-8333-333333333333');
  perform consumer_private.assess_company_event_materiality_v1('b3c44444-4444-4334-8344-444444444444');
  perform consumer_private.assess_company_event_materiality_v1('b3c55555-5555-4335-8355-555555555555');
  perform consumer_private.assess_company_event_materiality_v1('b3c66666-6666-4336-8366-666666666666');
end
$p3_assess$;

-- Attachment: supplier event -> OWNA; explicit affected_company_id wins for E4;
-- financial events never attach.
select consumer_private.attach_event_affected_company_v1(
  'b3c33333-3333-4333-8333-333333333333'
) as p3_attach_e3;

select 1 / case when (
  select affected_company_id from public.company_change_events
  where id='b3c33333-3333-4333-8333-333333333333'
)='b30a1111-1111-4111-8111-111111111111' then 1 else 0 end
as p3_supplier_event_attached_to_owna;

select 1 / case when (
  select consumer_private.attach_event_affected_company_v1(
    'b3c44444-4444-4334-8344-444444444444'
  )
)='b30b2222-2222-4222-8222-222222222222' then 1 else 0 end
as p3_explicit_affected_company_wins;

select 1 / case when (
  select consumer_private.attach_event_affected_company_v1(
    'b3c66666-6666-4336-8366-666666666666'
  ) is null
  and not exists (
    select 1 from public.company_change_events
    where id='b3c66666-6666-4336-8366-666666666666'
      and affected_company_id is not null
  )
) then 1 else 0 end
as p3_financial_event_does_not_attach;

-- Service-role-only attach wrapper: denied for authenticated.
set local role authenticated;
set local "request.jwt.claim.sub"='b3d11111-1111-4111-8111-111111111111';
do $p3_attach_denied$
begin
  begin
    perform public.attach_event_affected_company_v1('b3c33333-3333-4333-8333-333333333333');
    raise exception 'P3 failure: authenticated reached attach wrapper';
  exception
    when insufficient_privilege then null;
  end;
end
$p3_attach_denied$;
select 1 as p3_attach_wrapper_denied_for_authenticated;
reset role;

-- Ranking as user A (before the watch pinned factor).
set local role authenticated;
set local "request.jwt.claim.sub"='b3d11111-1111-4111-8111-111111111111';

create temporary table p3_rank_a as
select elem
from jsonb_array_elements(
  public.get_my_personal_ranking_v1(current_date - 1,50)->'items'
) elem;

select public.get_my_personal_ranking_v1(current_date - 1,50)->>'methodology_version'
  as p3_envelope_methodology;

select public.get_my_personal_ranking_v1(current_date - 1,50)->'universe'
  as p3_universe;

-- Universe scoping: B's company never appears in A's ranking.
select 1 / case when (
  select count(*) from p3_rank_a
  where elem->'position'->>'ticker'='BCO_'
     or elem->'event'->>'label' like '%BCO_%'
)=0 then 1 else 0 end
as p3_user_b_names_absent_from_a_ranking;

-- Owned (E1) outranks watched (E2) at equal company materiality.
-- E1: 90 * 1.6 * 1.25 = 180 + 10 pinned = 190 -> clamp 100.
select 1 / case when (
  select (elem->'user_materiality'->>'score')::integer from p3_rank_a
  where elem->'event'->>'event_id'='company_change:b3c11111-1111-4111-8111-111111111111'
)=100 then 1 else 0 end
as p3_owned_item_scores_100;

select 1 / case when (
  select elem->'position'->>'owned_boost' from p3_rank_a
  where elem->'event'->>'event_id'='company_change:b3c11111-1111-4111-8111-111111111111'
)='1.25' then 1 else 0 end
as p3_owned_boost_is_1_25;

-- E2 (watch, unpinned): 90 * 1.0 * 0.75 = 67.5 -> 68, monitor.
select 1 / case when (
  select (elem->'user_materiality'->>'score')::integer from p3_rank_a
  where elem->'event'->>'event_id'='company_change:b3c22222-2222-4222-8222-222222222222'
)=68 then 1 else 0 end
as p3_watch_item_scores_68_unpinned;

select 1 / case when (
  select elem->'user_materiality'->>'level' from p3_rank_a
  where elem->'event'->>'event_id'='company_change:b3c22222-2222-4222-8222-222222222222'
)='monitor' then 1 else 0 end
as p3_watch_item_is_monitor_level;

-- The owned item ranks first.
select 1 / case when (
  select elem->'event'->>'event_id' from p3_rank_a
  order by (elem->'user_materiality'->>'score')::integer desc,
           elem->>'item_id'
  limit 1
)='company_change:b3c11111-1111-4111-8111-111111111111' then 1 else 0 end
as p3_owned_item_ranks_first;

-- Attached supplier event is filed under the owned company.
select 1 / case when (
  select elem->'position'->>'ticker' from p3_rank_a
  where elem->'event'->>'event_id'='company_change:b3c33333-3333-4333-8333-333333333333'
)='OWNA' then 1 else 0 end
as p3_supplier_event_filed_under_owna;

select 1 / case when (
  select elem->'event'->'attached_via'->>'event_company_ticker' from p3_rank_a
  where elem->'event'->>'event_id'='company_change:b3c33333-3333-4333-8333-333333333333'
)='SUPL' then 1 else 0 end
as p3_supplier_event_names_supplier;

select 1 / case when (
  select elem->'event'->'attached_via'->>'relationship' from p3_rank_a
  where elem->'event'->>'event_id'='company_change:b3c33333-3333-4333-8333-333333333333'
)='supplier' then 1 else 0 end
as p3_supplier_event_names_relationship;

-- E4 (explicit affected_company_id=OWNB): 70 * 0.4 * 1.25 = 35 -> background,
-- filed under OWNB.
select 1 / case when (
  select (elem->'user_materiality'->>'score')::integer from p3_rank_a
  where elem->'event'->>'event_id'='company_change:b3c44444-4444-4334-8344-444444444444'
)=35 then 1 else 0 end
as p3_explicit_attach_scores_35;

select 1 / case when (
  select elem->'position'->>'ticker' from p3_rank_a
  where elem->'event'->>'event_id'='company_change:b3c44444-4444-4334-8344-444444444444'
)='OWNB' then 1 else 0 end
as p3_explicit_attach_filed_under_ownb;

-- Methodology versioning on every item.
select 1 / case when (
  select count(*) from p3_rank_a
  where elem->'user_materiality'->>'methodology_version'<>'personal-ranking-v1'
)=0 then 1 else 0 end
as p3_all_items_versioned;

-- Pinned factor on the watched position: 67.5 + 10 = 77.5 -> 78, important.
reset role;
insert into public.position_thesis_factors(
  id,position_id,user_id,source_type,canonical_thesis_variable_id,importance,enabled
) values (
  'b3a66666-6666-4336-8366-666666666666',
  'b3e33333-3333-4333-8333-333333333333',
  'b3d11111-1111-4111-8111-111111111111',
  'canonical','b3a44444-4444-4334-8344-444444444444',5,true
);

set local role authenticated;
set local "request.jwt.claim.sub"='b3d11111-1111-4111-8111-111111111111';

select 1 / case when (
  select (elem->'user_materiality'->>'score')::integer
  from jsonb_array_elements(
    public.get_my_personal_ranking_v1(current_date - 1,50)->'items'
  ) elem
  where elem->'event'->>'event_id'='company_change:b3c22222-2222-4222-8222-222222222222'
)=78 then 1 else 0 end
as p3_pinned_watch_scores_78;

select 1 / case when (
  select elem->'user_materiality'->>'personalized'
  from jsonb_array_elements(
    public.get_my_personal_ranking_v1(current_date - 1,50)->'items'
  ) elem
  where elem->'event'->>'event_id'='company_change:b3c22222-2222-4222-8222-222222222222'
)='true' then 1 else 0 end
as p3_pinned_watch_is_personalized;

-- Pinned watch (78) still ranks below the equally-material owned item (100).
select 1 / case when (
  select (elem->'user_materiality'->>'score')::integer
  from jsonb_array_elements(
    public.get_my_personal_ranking_v1(current_date - 1,50)->'items'
  ) elem
  where elem->'event'->>'event_id'='company_change:b3c22222-2222-4222-8222-222222222222'
) < (
  select (elem->'user_materiality'->>'score')::integer
  from jsonb_array_elements(
    public.get_my_personal_ranking_v1(current_date - 1,50)->'items'
  ) elem
  where elem->'event'->>'event_id'='company_change:b3c11111-1111-4111-8111-111111111111'
) then 1 else 0 end
as p3_pinned_watch_below_owned;

-- Stage B refresh (widened join) persists the attached event for the owner.
select public.refresh_my_materiality_assessments_v1(current_date - 1)->>'upserted'
  as p3_stage_b_upserted;

select 1 / case when (
  select count(*) from public.user_materiality_assessments uma
  join public.materiality_assessments ma on ma.id=uma.assessment_id
  where uma.user_id='b3d11111-1111-4111-8111-111111111111'
    and uma.position_id='b3e11111-1111-4111-8111-111111111111'
    and ma.event_id='b3c33333-3333-4333-8333-333333333333'
)=1 then 1 else 0 end
as p3_stage_b_persists_attached_event;

reset role;

-- Ranking as user B: BCO_ present, A's names absent.
set local role authenticated;
set local "request.jwt.claim.sub"='b3d22222-2222-4222-8222-222222222222';

select 1 / case when (
  select count(*)
  from jsonb_array_elements(
    public.get_my_personal_ranking_v1(current_date - 1,50)->'items'
  ) elem
  where elem->'position'->>'ticker'='BCO_'
)=1 then 1 else 0 end
as p3_user_b_sees_own_company;

select 1 / case when (
  select count(*)
  from jsonb_array_elements(
    public.get_my_personal_ranking_v1(current_date - 1,50)->'items'
  ) elem
  where elem->'position'->>'ticker' in ('OWNA','OWNB','WTCH')
)=0 then 1 else 0 end
as p3_user_a_names_absent_from_b_ranking;

-- B cannot read A's demand requests.
select 1 / case when (
  select count(*) from public.research_demand_requests
  where user_id='b3d11111-1111-4111-8111-111111111111'
)=0 then 1 else 0 end
as p3_user_b_cannot_read_a_demand;

reset role;

-- Anon: relationships are public reference data; the ranking RPC is denied.
set local role anon;
set local "request.jwt.claim.sub"='';
select 1 / case when (
  select count(*) from public.company_relationships
)=3 then 1 else 0 end
as p3_anon_can_read_relationships;

do $p3_ranking_anon$
begin
  begin
    perform public.get_my_personal_ranking_v1(current_date - 1,50);
    raise exception 'P3 failure: anon reached personal ranking';
  exception
    when insufficient_privilege then null;
  end;
end
$p3_ranking_anon$;
select 1 as p3_ranking_denied_for_anon;
reset role;

-- Monitored-name cap: user A is at 3 names; cap 3 blocks a new name but
-- allows upserting an already-monitored name. Fresh user C gets Free defaults.
update public.profiles
set monitored_name_cap=3
where user_id='b3d11111-1111-4111-8111-111111111111';

select 1 / case when (
  select monitored_name_cap from public.profiles
  where user_id='b3d33333-3333-4333-8333-333333333333'
)=12 then 1 else 0 end
as p3_free_cap_default_12;

select 1 / case when (
  select deep_research_quota from public.profiles
  where user_id='b3d33333-3333-4333-8333-333333333333'
)=2 then 1 else 0 end
as p3_quota_default_2;

do $p3_cap$
declare
  v_portfolio uuid;
begin
  select id into v_portfolio from public.portfolios
  where user_id='b3d11111-1111-4111-8111-111111111111' and is_default;

  begin
    insert into public.portfolio_positions(
      portfolio_id,user_id,company_id,quantity,relationship
    ) values (
      v_portfolio,
      'b3d11111-1111-4111-8111-111111111111',
      'b30a7777-7777-4337-8377-777777777777',
      10,'follow'
    );
    raise exception 'P3 failure: cap not enforced on Add';
  exception
    when raise_exception then
      if sqlerrm not like '%Monitored-name cap reached%' then
        raise exception 'P3 failure: wrong cap error: %',sqlerrm;
      end if;
  end;

  -- Upsert of an already-monitored name is not universe growth: passes.
  insert into public.portfolio_positions(
    portfolio_id,user_id,company_id,quantity,relationship
  ) values (
    v_portfolio,
    'b3d11111-1111-4111-8111-111111111111',
    'b30a1111-1111-4111-8111-111111111111',
    150,'own'
  )
  on conflict (portfolio_id,company_id) do update set quantity=excluded.quantity;
end
$p3_cap$;
select 1 as p3_cap_blocks_new_name_allows_upsert;

-- Deep-research quota: quota 1; second deep_dive rejected; coverage untouched;
-- upserting the existing request untouched.
update public.profiles
set deep_research_quota=1
where user_id='b3d11111-1111-4111-8111-111111111111';

insert into public.research_demand_requests(
  id,user_id,company_id,request_type,priority
) values (
  'b3b11111-1111-4111-8111-111111111111',
  'b3d11111-1111-4111-8111-111111111111',
  'b30a1111-1111-4111-8111-111111111111',
  'deep_dive',5
);

do $p3_quota$
begin
  begin
    insert into public.research_demand_requests(
      user_id,company_id,request_type,priority
    ) values (
      'b3d11111-1111-4111-8111-111111111111',
      'b30b2222-2222-4222-8222-222222222222',
      'deep_dive',3
    );
    raise exception 'P3 failure: quota not enforced on Request';
  exception
    when raise_exception then
      if sqlerrm not like '%deep_dive_quota_exceeded%' then
        raise exception 'P3 failure: wrong quota error: %',sqlerrm;
      end if;
  end;

  -- Coverage requests are not quota-limited.
  insert into public.research_demand_requests(
    user_id,company_id,request_type,priority
  ) values (
    'b3d11111-1111-4111-8111-111111111111',
    'b30b2222-2222-4222-8222-222222222222',
    'coverage',3
  );

  -- Upserting the existing deep_dive request is not new demand.
  insert into public.research_demand_requests(
    user_id,company_id,request_type,priority
  ) values (
    'b3d11111-1111-4111-8111-111111111111',
    'b30a1111-1111-4111-8111-111111111111',
    'deep_dive',4
  )
  on conflict (user_id,company_id) do update set priority=excluded.priority;

  -- Converting a coverage request into a deep dive IS new demand: blocked.
  begin
    update public.research_demand_requests
    set request_type='deep_dive'
    where user_id='b3d11111-1111-4111-8111-111111111111'
      and company_id='b30b2222-2222-4222-8222-222222222222';
    raise exception 'P3 failure: quota not enforced on conversion';
  exception
    when raise_exception then
      if sqlerrm not like '%deep_dive_quota_exceeded%' then
        raise exception 'P3 failure: wrong conversion error: %',sqlerrm;
      end if;
  end;

  -- Updating the existing deep dive without converting stays allowed.
  update public.research_demand_requests
  set priority=5
  where user_id='b3d11111-1111-4111-8111-111111111111'
    and company_id='b30a1111-1111-4111-8111-111111111111';
end
$p3_quota$;
select 1 as p3_quota_blocks_second_deep_dive;
select 1 as p3_quota_blocks_conversion_allows_update;

-- Quota readout as user A.
set local role authenticated;
set local "request.jwt.claim.sub"='b3d11111-1111-4111-8111-111111111111';

select 1 / case when (
  select public.get_my_research_request_quota_v1()->>'used'
)='1' then 1 else 0 end
as p3_quota_used_1;

select 1 / case when (
  select public.get_my_research_request_quota_v1()->>'remaining'
)='0' then 1 else 0 end
as p3_quota_remaining_0;

-- Queue position: B files a lower-priority deep_dive; A is #1 of 2, B is #2.
reset role;
insert into public.research_demand_requests(
  id,user_id,company_id,request_type,priority
) values (
  'b3b22222-2222-4222-8222-222222222222',
  'b3d22222-2222-4222-8222-222222222222',
  'b30f6666-6666-4336-8366-666666666666',
  'deep_dive',3
);

set local role authenticated;
set local "request.jwt.claim.sub"='b3d11111-1111-4111-8111-111111111111';

select 1 / case when (
  select public.get_my_request_queue_position_v1(
    'b3b11111-1111-4111-8111-111111111111'
  )->>'queue_position'
)='1' then 1 else 0 end
as p3_queue_a_is_first;

select 1 / case when (
  select public.get_my_request_queue_position_v1(
    'b3b11111-1111-4111-8111-111111111111'
  )->>'queue_total'
)='2' then 1 else 0 end
as p3_queue_total_two;

-- A cannot query B's request (no leaderboard probing).
do $p3_queue_cross$
begin
  begin
    perform public.get_my_request_queue_position_v1(
      'b3b22222-2222-4222-8222-222222222222'
    );
    raise exception 'P3 failure: cross-user queue lookup allowed';
  exception
    when insufficient_privilege then null;
  end;
end
$p3_queue_cross$;
select 1 as p3_queue_cross_user_denied;

-- A's coverage request is not in the deep-research queue.
select 1 / case when (
  select public.get_my_request_queue_position_v1(
    (select id from public.research_demand_requests
     where user_id='b3d11111-1111-4111-8111-111111111111'
       and request_type='coverage' limit 1)
  )->>'queued'
)='false' then 1 else 0 end
as p3_coverage_not_queued;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='b3d22222-2222-4222-8222-222222222222';

select 1 / case when (
  select public.get_my_request_queue_position_v1(
    'b3b22222-2222-4222-8222-222222222222'
  )->>'queue_position'
)='2' then 1 else 0 end
as p3_queue_b_is_second;

reset role;

rollback;
