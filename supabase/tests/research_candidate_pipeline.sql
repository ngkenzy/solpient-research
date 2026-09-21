-- Research Candidate Pipeline database invariants.
-- Run after universe screening + candidate pipeline migrations. Entire fixture rolls back.

begin;
set local role service_role;

do $test$
declare
  v_company uuid;
  v_screen_run uuid;
  v_screen_result uuid;
  v_pack uuid;
  v_pipeline_run uuid;
  v_item uuid;
  v_failed boolean;
begin
  select id into v_company from public.companies order by created_at limit 1;
  if v_company is null then raise exception 'Fixture requires at least one company.'; end if;

  insert into public.universe_screen_runs(
    as_of_at,methodology_version,selection_version,provider,input_hash,
    input_count,result_count,research_candidate_count,proposed_deep_research_count
  ) values (
    clock_timestamp(),'solpient-universe-screen-v1','solpient-100-selection-v1',
    'fixture-pipeline',repeat('d',64),1,1,1,1
  ) returning id into v_screen_run;

  insert into public.universe_screen_results(
    universe_screen_run_id,ticker,screen_profile,screen_state,universe_rank,shortlist_rank,
    proposed_for_deep_research,screen_score,quality_core_score,evidence_coverage_pct,
    gates,reasons,score_detail,input_summary,result_hash
  ) values (
    v_screen_run,'PIPE','software','research_candidate',1,1,true,80,85,90,
    '[]'::jsonb,'{}'::jsonb,'{}'::jsonb,'{"price":100}'::jsonb,repeat('e',64)
  ) returning id into v_screen_result;

  insert into public.candidate_valuation_input_packs(
    ticker,company_id,universe_screen_result_id,industry_module,status,valuation_input,
    input_hash,reviewed_by,reviewed_at
  ) values (
    'PIPE',v_company,v_screen_result,'software_platform','reviewed','{"currentPrice":100}'::jsonb,
    repeat('f',64),'fixture',clock_timestamp()
  ) returning id into v_pack;

  insert into public.research_candidate_pipeline_runs(
    universe_screen_run_id,pipeline_version,valuation_methodology_version,
    readiness_methodology_version,input_hash,candidate_count,valuation_building_count
  ) values (
    v_screen_run,'research-candidate-pipeline-v1','solpient-valuation-methodology-v3',
    'readiness-v1',repeat('1',64),1,1
  ) returning id into v_pipeline_run;

  insert into public.research_candidate_pipeline_items(
    research_candidate_pipeline_run_id,universe_screen_result_id,ticker,company_id,
    valuation_input_pack_id,stage,readiness_state,valuation_preflight_complete,
    next_actions,pipeline_output,item_hash
  ) values (
    v_pipeline_run,v_screen_result,'PIPE',v_company,v_pack,'valuation_building','building',false,
    '[{"action":"collect inputs"}]'::jsonb,'{"stage":"valuation_building"}'::jsonb,repeat('2',64)
  ) returning id into v_item;

  v_failed:=false;
  begin update public.candidate_valuation_input_packs set status='rejected' where id=v_pack;
  exception when others then v_failed:=true; end;
  if not v_failed then raise exception 'Valuation input pack was mutable.'; end if;

  v_failed:=false;
  begin delete from public.research_candidate_pipeline_items where id=v_item;
  exception when others then v_failed:=true; end;
  if not v_failed then raise exception 'Candidate pipeline item was deletable.'; end if;

  if has_table_privilege('anon','public.candidate_valuation_input_packs','SELECT')
     or has_table_privilege('authenticated','public.research_candidate_pipeline_items','SELECT') then
    raise exception 'Public roles unexpectedly have candidate-pipeline access.';
  end if;
end
$test$;

rollback;
