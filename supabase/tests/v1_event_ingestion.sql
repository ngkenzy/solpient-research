-- V1 Event Ingestion test (PRD Build 4).
-- Proves:
--   * event_taxonomy seeds PRD §15's 8 categories and constrains
--     company_change_events.category (unknown category rejected)
--   * confidence bounds (0-100) and knowledge_time <= disclosure_time
--   * end-to-end deterministic flow: guidance-cut event on a covered company
--     -> classified event -> Stage A company materiality
--     -> Stage B user materiality -> What Matters item,
--     all methodology-versioned
--   * explicit not_material emission: a reviewed-but-dismissed event gets a
--     not_material assessment and is excluded from What Matters
--   * owner-scoped RLS on user_materiality_assessments (no cross-user leaks)

begin;

-- Fixture companies.
insert into public.companies(id,ticker,company_name)
values
  ('e1a11111-1111-4111-8111-111111111111','E1A_TEST','E1 Company A'),
  ('e1b22222-2222-4222-8222-222222222222','E1B_TEST','E1 Company B');

-- Fixture users. The default-portfolio trigger provisions portfolios.
insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  'e1d11111-1111-4111-8111-111111111111',
  'authenticated','authenticated','e1-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
),
(
  'e1d22222-2222-4222-8222-222222222222',
  'authenticated','authenticated','e1-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
);

-- User A owns E1A (market_value -> weight-bearing).
insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity,average_cost,relationship,market_value
)
select
  'e1e11111-1111-4111-8111-111111111111',
  p.id,p.user_id,
  'e1a11111-1111-4111-8111-111111111111',
  100,400,'own',40000
from public.portfolios p
where p.user_id='e1d11111-1111-4111-8111-111111111111'
  and p.is_default;

-- Taxonomy: 8 versioned categories seeded.
select 1 / case when (
  select count(*) from public.event_taxonomy
  where taxonomy_version='event-taxonomy-v1'
    and effective_to is null
)=8 then 1 else 0 end
as e1_taxonomy_has_eight_categories;

select 1 / case when (
  select count(*) from public.event_taxonomy
  where category_key in (
    'financial','guidance','business','competition',
    'capital_allocation','management','regulatory','research'
  )
)=8 then 1 else 0 end
as e1_taxonomy_keys_match_prd_s15;

-- A normalized fact the guidance event will bear on.
insert into public.normalized_facts(
  id,company_id,fact_key,metric_key,known_at,
  normalization_methodology_version,source_confidence_class,selection_reason
) values (
  'e1f11111-1111-4111-8111-111111111111',
  'e1a11111-1111-4111-8111-111111111111',
  'e1-guidance-revenue-fy',
  'guidance_revenue_fy',
  now(),
  'test-v1','company_direct','E1 fixture fact'
);

-- Classified guidance-cut event (what the detector would write).
insert into public.company_change_events(
  id,company_id,event_key,category,metric_key,label,
  direction,materiality,decision_impact,summary,occurred_at,
  source_kind,source_id,source_url,
  confidence,knowledge_time,disclosure_time,affected_fact_id
) values (
  'e1c11111-1111-4111-8111-111111111111',
  'e1a11111-1111-4111-8111-111111111111',
  'sec8k:0001234567-26-000001:2.02',
  'guidance','sec8k:2.02','FY26 revenue guidance lowered',
  'down','high','weakening',
  'Management lowered FY26 revenue guidance in the 8-K earnings release.',
  current_date,
  'sec-filing','0001234567-26-000001','https://www.sec.gov/Archives/edgar/data/1/000123456726000001/doc.htm',
  88,
  now() - interval '3 hours',
  now(),
  'e1f11111-1111-4111-8111-111111111111'
);

-- Routine 8-K item: reviewed, explicitly not material.
insert into public.company_change_events(
  id,company_id,event_key,category,metric_key,label,
  direction,materiality,decision_impact,summary,occurred_at,
  source_kind,source_id,
  confidence,knowledge_time,disclosure_time
) values (
  'e1c22222-2222-4222-8222-222222222222',
  'e1a11111-1111-4111-8111-111111111111',
  'sec8k:0001234567-26-000002:5.07',
  'business','sec8k:5.07','Annual meeting vote results',
  'unchanged','not_material','neutral',
  'Routine 8-K Item 5.07 shareholder vote results; no thesis-relevant content.',
  current_date,
  'sec-filing','0001234567-26-000002',
  90,
  now() - interval '2 hours',
  now()
);

-- Taxonomy FK rejects an unknown category.
do $e1_taxonomy_fk$
begin
  begin
    insert into public.company_change_events(
      company_id,event_key,category,label,
      direction,materiality,decision_impact,summary,occurred_at
    ) values (
      'e1a11111-1111-4111-8111-111111111111',
      'e1-bogus-category','bogus','Bogus',
      'unchanged','notable','neutral','Bogus category must be rejected.',current_date
    );
    raise exception 'E1 failure: unknown event category accepted';
  exception
    when foreign_key_violation then null;
  end;
end
$e1_taxonomy_fk$;

-- Confidence bounds: 0-100 enforced.
do $e1_confidence_bounds$
begin
  begin
    insert into public.company_change_events(
      company_id,event_key,category,label,
      direction,materiality,decision_impact,summary,occurred_at,confidence
    ) values (
      'e1a11111-1111-4111-8111-111111111111',
      'e1-bad-confidence','guidance','Bad confidence',
      'down','high','weakening','Confidence 101 must be rejected.',current_date,101
    );
    raise exception 'E1 failure: confidence 101 accepted';
  exception
    when check_violation then null;
  end;
end
$e1_confidence_bounds$;

-- knowledge_time <= disclosure_time enforced.
do $e1_time_ordering$
begin
  begin
    insert into public.company_change_events(
      company_id,event_key,category,label,
      direction,materiality,decision_impact,summary,occurred_at,
      knowledge_time,disclosure_time
    ) values (
      'e1a11111-1111-4111-8111-111111111111',
      'e1-bad-times','guidance','Bad times',
      'down','high','weakening','knowledge_time after disclosure_time must be rejected.',
      current_date,now(),now() - interval '1 hour'
    );
    raise exception 'E1 failure: knowledge_time after disclosure_time accepted';
  exception
    when check_violation then null;
  end;
end
$e1_time_ordering$;

-- Stage A: assess both events (superuser bypasses grants; pipeline uses service_role).
reset role;

do $e1_assess$
begin
  perform consumer_private.assess_company_event_materiality_v1(
    'e1c11111-1111-4111-8111-111111111111'
  );
  perform consumer_private.assess_company_event_materiality_v1(
    'e1c22222-2222-4222-8222-222222222222'
  );
end
$e1_assess$;

select 1 / case when (
  select severity from public.materiality_assessments
  where event_id='e1c11111-1111-4111-8111-111111111111'
)='high' then 1 else 0 end
as e1_guidance_assessed_high;

select 1 / case when (
  select methodology_version from public.materiality_assessments
  where event_id='e1c11111-1111-4111-8111-111111111111'
)='group-b-event-materiality-v1' then 1 else 0 end
as e1_guidance_methodology_versioned;

select 1 / case when (
  select confidence from public.materiality_assessments
  where event_id='e1c11111-1111-4111-8111-111111111111'
)=88 then 1 else 0 end
as e1_guidance_confidence_preserved;

select 1 / case when (
  select (public.assess_company_events_since_v1(current_date - 30)->>'assessed')::integer
)=0 then 1 else 0 end
as e1_pipeline_idempotent;

-- Explicit not_material emission (not implicit absence).
select 1 / case when (
  select severity from public.materiality_assessments
  where event_id='e1c22222-2222-4222-8222-222222222222'
)='not_material' then 1 else 0 end
as e1_vote_assessed_not_material;

-- Stage B as user A: refresh per-user assessments.
set local role authenticated;
set local "request.jwt.claim.sub"='e1d11111-1111-4111-8111-111111111111';

select 1 / case when (
  select (public.refresh_my_materiality_assessments_v1(current_date - 30)->>'upserted')::integer
)=1 then 1 else 0 end
as e1_stage_b_upserts_one_row;

select 1 / case when (
  select methodology_version from public.user_materiality_assessments
  where user_id='e1d11111-1111-4111-8111-111111111111'
  limit 1
)='group-b-user-materiality-v2' then 1 else 0 end
as e1_stage_b_methodology_versioned;

select 1 / case when (
  select position_weight from public.user_materiality_assessments
  where user_id='e1d11111-1111-4111-8111-111111111111'
  limit 1
) between 0.99 and 1.0 then 1 else 0 end
as e1_stage_b_position_weight_recorded;

-- knowledge_time <= disclosure_time is enforced: the world cannot know after
-- Solpient ingested.
reset role;
do $e1_knowledge_ordering$
begin
  begin
    insert into public.company_change_events(
      id,company_id,category,occurred_at,label,summary,metric_key,direction,
      materiality,decision_impact,confidence,knowledge_time,disclosure_time,
      event_key,evidence_payload
    ) values (
      'e1c88888-8888-4888-8888-888888888888',
      'e1a11111-1111-4111-8111-111111111111',
      'business',current_date,'bad ordering','x','event.bad','new',
      'notable','monitor',50,now(),'2026-01-01',
      'bad:ordering','{}'::jsonb
    );
    raise exception 'E1 failure: knowledge_time > disclosure_time accepted';
  exception
    when check_violation then null;
  end;
end
$e1_knowledge_ordering$;

select 1 as e1_knowledge_before_disclosure_enforced;

-- Service-role-only Stage A wrapper: denied for authenticated, usable for the worker.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='e1d11111-1111-4111-8111-111111111111';

do $e1_stage_a_wrapper_denied$
begin
  begin
    perform public.assess_company_event_materiality_v1('e1c11111-1111-4111-8111-111111111111');
    raise exception 'E1 failure: authenticated reached service-role Stage A wrapper';
  exception
    when insufficient_privilege then null;
  end;
end
$e1_stage_a_wrapper_denied$;

select 1 as e1_stage_a_wrapper_denied_for_authenticated;

reset role;
set local role service_role;
select public.assess_company_event_materiality_v1('e1c11111-1111-4111-8111-111111111111');

select 1 / case when (
  select count(*) from public.materiality_assessments
  where event_id='e1c11111-1111-4111-8111-111111111111'
)=1 then 1 else 0 end
as e1_stage_a_wrapper_usable_by_service_role;

-- Batch/repair entrypoint: a fresh unassessed event gets picked up by the
-- service-role-only batch wrapper; authenticated is denied.
insert into public.company_change_events(
  id,company_id,category,occurred_at,label,summary,metric_key,direction,
  materiality,decision_impact,confidence,knowledge_time,disclosure_time,
  event_key,event_source,event_taxonomy,evidence_payload
) values (
  'e1c99999-9999-4999-8999-999999999999',
  'e1a11111-1111-4111-8111-111111111111',
  'regulatory','2026-09-24',
  '8-K Item 8.01 — investigation','SEC subpoena disclosed.','event.8k.8_01','down',
  'high','weakening',90,'2026-09-24','2026-09-25T00:00:00Z',
  '8k:acc999:8.01','sec-8k-detector-v1','event-taxonomy-v1',
  '{"label":"8-K Item 8.01 — investigation","confidence":90}'::jsonb
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='e1d11111-1111-4111-8111-111111111111';

do $e1_batch_wrapper_denied$
begin
  begin
    perform public.assess_company_events_since_v1(current_date - 30);
    raise exception 'E1 failure: authenticated reached service-role batch wrapper';
  exception
    when insufficient_privilege then null;
  end;
end
$e1_batch_wrapper_denied$;

select 1 as e1_batch_wrapper_denied_for_authenticated;

reset role;
set local role service_role;
select public.assess_company_events_since_v1(current_date - 30)
  ->>'assessed' as e1_batch_assessed_count;

select 1 / case when (
  select severity from public.materiality_assessments
  where event_id='e1c99999-9999-4999-8999-999999999999'
)='high' then 1 else 0 end
as e1_batch_assessed_unassessed_event;

select 1 / case when (
  select public.assess_company_events_since_v1(current_date - 30)->>'assessed'
)='0' then 1 else 0 end
as e1_batch_idempotent_second_run;

reset role;

-- What Matters: guidance cut surfaces; the not_material vote does not.
create temporary table e1_items as
select elem
from jsonb_array_elements(
  public.get_my_what_matters_v1(current_date - 1,50)->'items'
) elem;

select 1 / case when (
  select count(*) from e1_items
  where elem->'event'->>'event_id'='company_change:e1c11111-1111-4111-8111-111111111111'
)=1 then 1 else 0 end
as e1_guidance_cut_in_what_matters;

select 1 / case when (
  select elem->'event'->'company_materiality'->>'methodology_version'
  from e1_items
  where elem->'event'->>'event_id'='company_change:e1c11111-1111-4111-8111-111111111111'
)='group-b-event-materiality-v1' then 1 else 0 end
as e1_what_matters_uses_stage_a_assessment;

select 1 / case when (
  select (elem->'event'->'company_materiality'->>'score')::integer
  from e1_items
  where elem->'event'->>'event_id'='company_change:e1c11111-1111-4111-8111-111111111111'
)=90 then 1 else 0 end
as e1_guidance_company_score_90;

select 1 / case when (
  select elem->'user_materiality'->>'methodology_version'
  from e1_items
  where elem->'event'->>'event_id'='company_change:e1c11111-1111-4111-8111-111111111111'
)='group-b-user-materiality-v2' then 1 else 0 end
as e1_what_matters_user_methodology_v2;

select 1 / case when (
  select count(*) from e1_items
  where elem->'event'->>'event_id'='company_change:e1c22222-2222-4222-8222-222222222222'
)=0 then 1 else 0 end
as e1_not_material_excluded_from_what_matters;

-- Event-level new fields flow through the B4 evidence payload.
select 1 / case when (
  select (elem->'event'->'evidence'->>'confidence')::integer
  from e1_items
  where elem->'event'->>'event_id'='company_change:e1c11111-1111-4111-8111-111111111111'
)=88 then 1 else 0 end
as e1_confidence_flows_to_evidence;

select 1 / case when (
  select elem->'event'->'evidence'->>'affected_fact_id'
  from e1_items
  where elem->'event'->>'event_id'='company_change:e1c11111-1111-4111-8111-111111111111'
)='e1f11111-1111-4111-8111-111111111111' then 1 else 0 end
as e1_affected_fact_flows_to_evidence;

-- RLS: user B cannot read user A's Stage B rows; anon cannot read any.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='e1d22222-2222-4222-8222-222222222222';

select 1 / case when (
  select count(*) from public.user_materiality_assessments
  where user_id='e1d11111-1111-4111-8111-111111111111'
)=0 then 1 else 0 end
as e1_user_b_cannot_read_user_a_assessments;

select 1 / case when (
  select count(*) from public.user_materiality_assessments
)=0 then 1 else 0 end
as e1_user_b_sees_zero_rows_total;

reset role;
set local role anon;
set local "request.jwt.claim.sub"='';

-- Anon has no grant at all on the owner-scoped table (repo model: revoke all).
do $e1_anon_table$
begin
  begin
    perform count(*) from public.user_materiality_assessments;
    raise exception 'E1 failure: anon read user_materiality_assessments';
  exception
    when insufficient_privilege then null;
  end;
end
$e1_anon_table$;

select 1 as e1_anon_cannot_read_user_assessments;

-- Company-level assessments stay public-readable (same model as the events).
select 1 / case when (
  select count(*) from public.materiality_assessments
)=3 then 1 else 0 end
as e1_anon_can_read_company_assessments;

do $e1_anon_refresh$
begin
  begin
    perform public.refresh_my_materiality_assessments_v1(current_date - 30);
    raise exception 'E1 auth failure: anon refreshed materiality assessments';
  exception
    when insufficient_privilege then null;
  end;
end
$e1_anon_refresh$;

reset role;

rollback;
