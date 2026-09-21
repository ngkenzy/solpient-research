-- Solpient 100 Universe Screening database invariants.
-- Run after migration. Entire fixture rolls back.

begin;
set local role service_role;

do $test$
declare
  v_run uuid;
  v_result uuid;
  v_failed boolean;
begin
  insert into public.universe_screen_runs(
    as_of_at,methodology_version,selection_version,provider,input_hash,
    input_count,result_count,excluded_count,watch_count,research_candidate_count,
    solpient_100_candidate_count,proposed_deep_research_count,metadata
  ) values (
    clock_timestamp(),'solpient-universe-screen-v1','solpient-100-selection-v1',
    'fixture',repeat('a',64),3,3,1,1,0,1,1,'{"fixture":true}'::jsonb
  ) returning id into v_run;

  insert into public.universe_screen_results(
    universe_screen_run_id,ticker,company_name,screen_profile,screen_state,
    universe_rank,shortlist_rank,proposed_for_deep_research,
    final_membership_requires_review,screen_score,quality_core_score,
    evidence_coverage_pct,quality_score,durability_score,balance_sheet_score,
    growth_score,valuation_score,gates,reasons,score_detail,input_summary,result_hash
  ) values (
    v_run,'TEST','Test Co','general','solpient_100_candidate',
    1,1,true,true,82,88,90,90,85,88,80,65,
    '[]'::jsonb,'{"positives":["quality"],"concerns":[]}'::jsonb,
    '{"fixture":true}'::jsonb,'{"marketCap":10000000000}'::jsonb,repeat('b',64)
  ) returning id into v_result;

  v_failed:=false;
  begin update public.universe_screen_runs set input_count=99 where id=v_run;
  exception when others then v_failed:=true; end;
  if not v_failed then raise exception 'Universe screen run was mutable.'; end if;

  v_failed:=false;
  begin delete from public.universe_screen_results where id=v_result;
  exception when others then v_failed:=true; end;
  if not v_failed then raise exception 'Universe screen result was deletable.'; end if;

  if has_table_privilege('anon','public.universe_screen_runs','SELECT')
     or has_table_privilege('authenticated','public.universe_screen_results','SELECT') then
    raise exception 'Public roles unexpectedly have universe-screen ledger access.';
  end if;

  v_failed:=false;
  begin
    insert into public.universe_screen_runs(
      as_of_at,methodology_version,selection_version,provider,input_hash
    ) values (
      clock_timestamp(),'solpient-universe-screen-v1','solpient-100-selection-v1',
      'fixture',repeat('a',64)
    );
  exception when unique_violation then v_failed:=true; end;
  if not v_failed then raise exception 'Duplicate universe input hash produced another run.'; end if;

  v_failed:=false;
  begin
    insert into public.universe_screen_results(
      universe_screen_run_id,ticker,screen_profile,screen_state,universe_rank,result_hash
    ) values (v_run,'BAD','general','buy_now',2,repeat('c',64));
  exception when check_violation then v_failed:=true; end;
  if not v_failed then raise exception 'Invalid screening state was accepted.'; end if;
end
$test$;

rollback;
