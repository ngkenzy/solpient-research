-- Group B / B3 clean-start thesis personalization test.

begin;

insert into public.companies(id,ticker,company_name)
values
  ('d1111111-1111-4111-8111-111111111111','B3A_TEST','B3 Company A'),
  ('d2222222-2222-4222-8222-222222222222','B3B_TEST','B3 Company B')
on conflict (id) do nothing;

do $b3_publish$
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
    'd1111111-1111-4111-8111-111111111111',
    'b3-test',v_now,'ready_for_review',100,true,'complete','{}'::jsonb
  ) returning id into v_draft;

  insert into public.baseline_reviews(
    draft_id,status,review_payload,validation_result,promotion_readiness,reviewed_at
  ) values (
    v_draft,'ready','{}'::jsonb,'{}'::jsonb,'{"ready":true}'::jsonb,v_now
  ) returning id into v_review;

  insert into public.research_compositions(
    draft_id,company_id,engine_version,status,composition_payload,validation_result,generated_at,applied_at
  ) values (
    v_draft,'d1111111-1111-4111-8111-111111111111',
    'b3-test','applied','{"review_patch":{}}'::jsonb,'{}'::jsonb,v_now,v_now
  ) returning id into v_composition;

  v_package:=jsonb_build_object(
    'ticker','B3A_TEST',
    'company_name','B3 Company A',
    'research',jsonb_build_object(
      'standard_version','solpient-v2',
      'price_at_research',100,
      'market_cap',1000000,
      'source_period','FY2026',
      'summary','B3 canonical thesis fixture',
      'data_cutoff_at',v_now,
      'benchmark_ticker','SPY'
    ),
    'financial_metrics',jsonb_build_object('revenue',1000,'free_cash_flow',100),
    'scores',jsonb_build_object('overall_score',80,'quality_score',80),
    'valuations',jsonb_build_object('base_value',120,'bear_value',80,'bull_value',160),
    'business_assessment',jsonb_build_object(
      'business_quality_rating','strong',
      'moat_rating','narrow',
      'evidence',jsonb_build_array()
    ),
    'metric_observations',jsonb_build_array(),
    'risk_register',jsonb_build_array(),
    'expected_return_scenarios',jsonb_build_array(),
    'thesis_variables',jsonb_build_array(jsonb_build_object(
      'variable_name','B3 A margin durability',
      'metric_key','operating_margin',
      'expectation','Margins remain durable',
      'status','unchanged',
      'breaker_condition','Margins structurally compress'
    )),
    'sources',jsonb_build_array(jsonb_build_object(
      'source_type','10-K',
      'title','B3 test source',
      'url','https://example.com/b3',
      'retrieved_at',v_now
    )),
    'investment_thesis',jsonb_build_object('what_must_be_true','Margins remain durable'),
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
    'publication_engine_version','b3-test-publisher',
    'methodology_version','solpient-v2:b3-test',
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
$b3_publish$;

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
) values
(
  'b3111111-1111-4111-8111-111111111111',
  'authenticated','authenticated','b3-user-a@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"B3 User A"}'::jsonb,
  now(),now(),false,false
),
(
  'b3222222-2222-4222-8222-222222222222',
  'authenticated','authenticated','b3-user-b@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"B3 User B"}'::jsonb,
  now(),now(),false,false
);

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity,average_cost
)
select
  'c3111111-1111-4111-8111-111111111111',
  p.id,p.user_id,
  'd1111111-1111-4111-8111-111111111111',
  10,100
from public.portfolios p
where p.user_id='b3111111-1111-4111-8111-111111111111'
  and p.is_default;

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity,average_cost
)
select
  'c3122222-2222-4222-8222-222222222222',
  p.id,p.user_id,
  'd2222222-2222-4222-8222-222222222222',
  5,150
from public.portfolios p
where p.user_id='b3111111-1111-4111-8111-111111111111'
  and p.is_default;

insert into public.portfolio_positions(
  id,portfolio_id,user_id,company_id,quantity,average_cost
)
select
  'c3222222-2222-4222-8222-222222222222',
  p.id,p.user_id,
  'd2222222-2222-4222-8222-222222222222',
  20,200
from public.portfolios p
where p.user_id='b3222222-2222-4222-8222-222222222222'
  and p.is_default;

set local role authenticated;
set local "request.jwt.claim.sub"='b3111111-1111-4111-8111-111111111111';

insert into public.position_thesis_factors(
  position_id,user_id,source_type,canonical_thesis_variable_id,
  factor_key,factor_label,importance,personal_expectation,enabled
) values (
  'c3111111-1111-4111-8111-111111111111',
  'b3111111-1111-4111-8111-111111111111',
  'canonical',
  (
    select tv.id
    from public.thesis_variables tv
    join public.research_runs rr on rr.id=tv.research_run_id
    where rr.company_id='d1111111-1111-4111-8111-111111111111'
      and rr.status='published'
      and tv.metric_key='operating_margin'
    limit 1
  ),
  'ignored-by-guard',
  'ignored by guard',
  5,
  'This is central to my thesis.',
  true
);

select 1 / case when (
  select count(*) from public.position_thesis_factors
  where factor_key='canonical:metric:operating_margin'
    and factor_label='B3 A margin durability'
    and importance=5
)=1 then 1 else 0 end
as canonical_factor_is_normalized;

insert into public.position_thesis_factors(
  position_id,user_id,source_type,factor_key,factor_label,
  importance,personal_expectation,personal_breaker_condition
) values (
  'c3111111-1111-4111-8111-111111111111',
  'b3111111-1111-4111-8111-111111111111',
  'custom',
  'custom:test',
  'Management execution',
  4,
  'Execution remains disciplined.',
  'Capital allocation becomes persistently value destructive.'
);

select 1 / case when (
  select count(*) from public.position_thesis_factors
)=2 then 1 else 0 end
as user_a_sees_two_own_factors;

do $b3_company$
begin
  begin
    insert into public.position_thesis_factors(
      position_id,user_id,source_type,canonical_thesis_variable_id,
      factor_key,factor_label
    ) values (
      'c3122222-2222-4222-8222-222222222222',
      'b3111111-1111-4111-8111-111111111111',
      'canonical',
      (
        select tv.id
        from public.thesis_variables tv
        join public.research_runs rr on rr.id=tv.research_run_id
        where rr.company_id='d1111111-1111-4111-8111-111111111111'
          and rr.status='published'
          and tv.metric_key='operating_margin'
        limit 1
      ),
      'ignored',
      'wrong company'
    );
    raise exception 'B3 provenance failure: cross-company canonical factor inserted';
  exception
    when check_violation then null;
  end;
end
$b3_company$;

do $b3_user$
begin
  begin
    insert into public.position_thesis_factors(
      position_id,user_id,source_type,factor_key,factor_label
    ) values (
      'c3222222-2222-4222-8222-222222222222',
      'b3222222-2222-4222-8222-222222222222',
      'custom',
      'custom:forbidden',
      'Forbidden'
    );
    raise exception 'B3 isolation failure: user A inserted user B thesis factor';
  exception
    when insufficient_privilege then null;
  end;
end
$b3_user$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='b3222222-2222-4222-8222-222222222222';

select 1 / case when (
  select count(*) from public.position_thesis_factors
)=0 then 1 else 0 end
as user_b_cannot_read_user_a_factors;

reset role;

select 1 / case when (
  select c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname='position_thesis_factors'
) then 1 else 0 end
as b3_rls_enabled;

rollback;
