-- Group B / B5 What Matters contract test.

begin;

insert into public.companies(id,ticker,company_name)
values
  ('b5111111-1111-4111-8111-111111111111','B5A_TEST','B5 Company A'),
  ('b5222222-2222-4222-8222-222222222222','B5B_TEST','B5 Company B');

do $b5_publish$
declare
  v_draft uuid;
  v_review uuid;
  v_composition uuid;
  v_now timestamptz:=clock_timestamp();
  v_package jsonb;
  v_integrity jsonb;
begin
  insert into public.baseline_drafts(
    company_id,generation_version,source_cutoff_at,status,evidence_completeness_pct,
    standard_valid,standard_status,draft_payload
  ) values (
    'b5111111-1111-4111-8111-111111111111',
    'b5-test',v_now,'ready_for_review',100,true,'complete','{}'::jsonb
  ) returning id into v_draft;

  insert into public.baseline_reviews(
    draft_id,status,review_payload,validation_result,promotion_readiness,reviewed_at
  ) values (
    v_draft,'ready','{}'::jsonb,'{}'::jsonb,'{"ready":true}'::jsonb,v_now
  ) returning id into v_review;

  insert into public.research_compositions(
    draft_id,company_id,engine_version,status,composition_payload,validation_result,generated_at,applied_at
  ) values (
    v_draft,'b5111111-1111-4111-8111-111111111111',
    'b5-test','applied','{"review_patch":{}}'::jsonb,'{}'::jsonb,v_now,v_now
  ) returning id into v_composition;

  v_package:=jsonb_build_object(
    'ticker','B5A_TEST',
    'company_name','B5 Company A',
    'research',jsonb_build_object(
      'standard_version','solpient-v2','price_at_research',100,'market_cap',1000000,
      'source_period','FY2026','summary','B5 canonical thesis fixture',
      'data_cutoff_at',v_now,'benchmark_ticker','SPY'
    ),
    'financial_metrics',jsonb_build_object('revenue',1000,'free_cash_flow',100),
    'scores',jsonb_build_object('overall_score',80,'quality_score',80),
    'valuations',jsonb_build_object('base_value',120,'bear_value',80,'bull_value',160),
    'business_assessment',jsonb_build_object(
      'business_quality_rating','strong','moat_rating','narrow',
      'evidence',jsonb_build_array()
    ),
    'metric_observations',jsonb_build_array(),
    'risk_register',jsonb_build_array(),
    'expected_return_scenarios',jsonb_build_array(),
    'thesis_variables',jsonb_build_array(jsonb_build_object(
      'variable_name','Revenue durability',
      'metric_key','revenue_growth',
      'expectation','Revenue growth remains durable',
      'status','unchanged',
      'breaker_condition','Revenue growth structurally weakens'
    )),
    'sources',jsonb_build_array(jsonb_build_object(
      'source_type','10-K','title','B5 test source',
      'url','https://example.com/b5','retrieved_at',v_now
    )),
    'investment_thesis',jsonb_build_object('what_must_be_true','Revenue remains durable'),
    'financial_quality',jsonb_build_object('history_years',5),
    'fundamental_scorecard',jsonb_build_array(),
    'competitive_position',jsonb_build_object('peers',jsonb_build_array()),
    'valuation_analysis',jsonb_build_object('assumptions',jsonb_build_object('discount_rate',10)),
    'historical_valuation',jsonb_build_object(),
    'investment_lenses',jsonb_build_object(),
    'decision_dashboard',jsonb_build_object(),
    'final_conclusion',jsonb_build_object()
  );

  v_integrity:=jsonb_build_object(
    'integrity_version','historical-integrity-v1',
    'publication_engine_version','b5-test-publisher',
    'methodology_version','solpient-v2:b5-test',
    'canonicalization_version','solpient-canonical-json-v1',
    'evidence_hash',repeat('a',64),
    'normalized_inputs_hash',repeat('b',64),
    'valuation_inputs_hash',repeat('c',64),
    'composition_hash',repeat('d',64),
    'published_output_hash',repeat('e',64),
    'standard_status','complete',
    'completeness_pct',100,
    'validation_notes',jsonb_build_array(),
    'validation_result',jsonb_build_object(),
    'promotion_readiness',jsonb_build_object('ready',true)
  );

  perform public.publish_reviewed_research_v2(
    v_draft,v_review,v_composition,null,v_package,v_integrity,'[]'::jsonb
  );
end
$b5_publish$;

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  'b5333333-3333-4333-8333-333333333333',
  'authenticated','authenticated','b5-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
),
(
  'b5444444-4444-4444-8444-444444444444',
  'authenticated','authenticated','b5-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,now(),now(),false,false
);

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity
)
select
  'b5555555-5555-4555-8555-555555555555',
  p.id,p.user_id,
  'b5111111-1111-4111-8111-111111111111',
  10
from public.portfolios p
where p.user_id='b5333333-3333-4333-8333-333333333333'
  and p.is_default;

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity
)
select
  'b5666666-6666-4666-8666-666666666666',
  p.id,p.user_id,
  'b5222222-2222-4222-8222-222222222222',
  20
from public.portfolios p
where p.user_id='b5444444-4444-4444-8444-444444444444'
  and p.is_default;

insert into public.company_state_snapshots(
  company_id,state_version,snapshot_date,observed_at,state_hash,state_payload
) values
(
  'b5111111-1111-4111-8111-111111111111',
  'company-state-v1',
  current_date-4,
  now()-interval '4 days',
  repeat('a',64),
  '{}'::jsonb
),
(
  'b5222222-2222-4222-8222-222222222222',
  'company-state-v1',
  current_date,
  now(),
  repeat('b',64),
  '{}'::jsonb
);

insert into public.company_change_events(
  company_id,current_snapshot_id,event_key,category,metric_key,label,
  old_value,new_value,delta_value,delta_percent,direction,materiality,
  decision_impact,summary,occurred_at
)
select
  'b5111111-1111-4111-8111-111111111111',
  css.id,
  'b5-a-revenue','financial','revenue_growth','Revenue growth',
  15,5,-10,-66.7,'down','high','weakening',
  'Revenue growth weakened materially.',current_date
from public.company_state_snapshots css
where css.company_id='b5111111-1111-4111-8111-111111111111'
limit 1;

insert into public.company_change_events(
  company_id,current_snapshot_id,event_key,category,metric_key,label,
  old_value,new_value,delta_value,delta_percent,direction,materiality,
  decision_impact,summary,occurred_at
)
select
  'b5222222-2222-4222-8222-222222222222',
  css.id,
  'b5-b-revenue','financial','revenue_growth','Revenue growth',
  5,15,10,200,'up','high','improving',
  'Other user company improved.',current_date
from public.company_state_snapshots css
where css.company_id='b5222222-2222-4222-8222-222222222222'
limit 1;

set local role authenticated;
set local "request.jwt.claim.sub"='b5333333-3333-4333-8333-333333333333';

insert into public.position_thesis_factors(
  position_id,user_id,source_type,canonical_thesis_variable_id,
  factor_key,factor_label,importance,personal_expectation,enabled
) values (
  'b5555555-5555-4555-8555-555555555555',
  'b5333333-3333-4333-8333-333333333333',
  'canonical',
  (
    select tv.id
    from public.thesis_variables tv
    join public.research_runs rr on rr.id=tv.research_run_id
    where rr.company_id='b5111111-1111-4111-8111-111111111111'
      and rr.status='published'
      and tv.metric_key='revenue_growth'
    limit 1
  ),
  'canonical:pending',
  'Revenue durability',
  5,
  'Revenue growth must remain durable.',
  true
);

select 1 / case when
  public.get_my_what_matters_v1(current_date-1,50)->>'contract_version'
    ='group-b-what-matters-v1'
then 1 else 0 end
as b5_contract_version;

select 1 / case when
  (public.get_my_what_matters_v1(current_date-1,50)->>'item_count')::integer=1
then 1 else 0 end
as b5_user_a_has_one_item;

select 1 / case when
  (public.get_my_what_matters_v1(current_date-1,50)
    ->'items'->0->'user_materiality'->>'score')::integer=100
then 1 else 0 end
as b5_importance_boost_applied;

select 1 / case when
  (public.get_my_what_matters_v1(current_date-1,50)
    ->'items'->0->'user_materiality'->>'personalized')::boolean
then 1 else 0 end
as b5_metric_matches_personal_factor;

select 1 / case when
  public.get_my_what_matters_v1(current_date-1,50)
    ->'items'->0->'user_materiality'->>'matched_factor_label'
    ='Revenue durability'
then 1 else 0 end
as b5_factor_label_preserved;

select 1 / case when
  public.get_my_what_matters_v1(current_date-1,50)->>'source_status'='stale'
then 1 else 0 end
as b5_stale_source_is_visible;

select 1 / case when not (
  public.get_my_what_matters_v1(current_date-1,50)
    ->'items' @> '[{"event":{"summary":"Other user company improved."}}]'::jsonb
) then 1 else 0 end
as b5_other_user_company_excluded;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='b5444444-4444-4444-8444-444444444444';

select 1 / case when
  (public.get_my_what_matters_v1(current_date-1,50)->>'item_count')::integer=1
then 1 else 0 end
as b5_user_b_has_one_item;

select 1 / case when
  public.get_my_what_matters_v1(current_date-1,50)
    ->'items'->0->'position'->>'ticker'='B5B_TEST'
then 1 else 0 end
as b5_user_b_only_sees_own_company;

reset role;
set local role anon;
set local "request.jwt.claim.sub"='';

do $b5_anon$
begin
  begin
    perform public.get_my_what_matters_v1(current_date-1,50);
    raise exception 'B5 auth failure: anon executed What Matters contract';
  exception
    when insufficient_privilege then null;
  end;
end
$b5_anon$;

reset role;

select 1 / case when (
  select not p.prosecdef
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='get_my_what_matters_v1'
    and pg_get_function_identity_arguments(p.oid)='p_since date, p_limit integer'
) then 1 else 0 end
as b5_public_rpc_is_security_invoker;

select 1 / case when (
  select p.prosecdef
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='consumer_private'
    and p.proname='get_my_what_matters_v1'
    and pg_get_function_identity_arguments(p.oid)='p_since date, p_limit integer'
) then 1 else 0 end
as b5_private_helper_is_security_definer;

rollback;
