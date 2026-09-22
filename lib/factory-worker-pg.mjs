import { pgMaybeOne, pgQuery, insertObject, upsertObjects, updateObject } from "./postgres-node.mjs";

export async function findFactoryRunPg(requestedRunId=null){
  if(requestedRunId){
    return pgMaybeOne(`select * from public.research_factory_runs where id=$1 limit 1`,[requestedRunId]);
  }
  return pgMaybeOne(`
    select * from public.research_factory_runs
    where factory_version='research-factory-v1'
    order by created_at desc
    limit 1
  `);
}

export async function listFactoryItemsPg(runId,{ticker=null,stages=null,statuses=null,limit=null,requireCompany=false}={}){
  const values=[runId];
  let sql=`select * from public.research_factory_items where research_factory_run_id=$1`;
  if(requireCompany)sql+=" and company_id is not null";
  if(ticker){values.push(String(ticker).toUpperCase());sql+=` and ticker=$${values.length}`;}
  if(stages?.length){values.push(stages);sql+=` and stage=any($${values.length}::text[])`;}
  if(statuses?.length){values.push(statuses);sql+=` and status=any($${values.length}::text[])`;}
  sql+=" order by ordinal asc";
  if(limit){values.push(limit);sql+=` limit $${values.length}`;}
  return pgQuery(sql,values);
}

export async function freshFactoryItemPg(id){
  return pgMaybeOne(`select * from public.research_factory_items where id=$1 limit 1`,[id]);
}

export async function loadSettlementInputsPg(item){
  if(!item?.company_id)return null;
  const companyId=item.company_id;
  const [coverage,contextPack,consensus,baselineDraft,industryAssignment]=await Promise.all([
    pgMaybeOne(`
      select status,fundamentals_pct,history_pct,market_history_pct,valuation_history_pct,
             capital_allocation_pct,consensus_pct,industry_pct,peer_pct,overall_pct,
             decision_readiness_pct,normalized_quarters,complete_fiscal_years,market_days,
             primary_source_quarters,missing_fields,provider_summary
      from public.data_coverage_reports
      where company_id=$1 and engine_version='coverage-v2'
      order by as_of_date desc,generated_at desc limit 1
    `,[companyId]),
    pgMaybeOne(`
      select industry_module,history_coverage,peer_comparison,summary,limitations
      from public.research_context_packs
      where company_id=$1 order by as_of_date desc,generated_at desc limit 1
    `,[companyId]),
    pgMaybeOne(`
      select analyst_count,revenue_next_fy,eps_next_fy,revenue_growth_next_fy,eps_growth_next_fy
      from public.consensus_snapshots
      where company_id=$1 order by observed_at desc limit 1
    `,[companyId]),
    pgMaybeOne(`
      select industry_module,evidence_completeness_pct,standard_status,draft_payload
      from public.baseline_drafts
      where company_id=$1 order by generated_at desc limit 1
    `,[companyId]),
    pgMaybeOne(`
      select policy_version,status,module,proposed_module,decision_hash
      from public.research_factory_industry_assignments
      where research_factory_item_id=$1 order by created_at desc limit 1
    `,[item.id]),
  ]);
  return {coverage,contextPack,consensus,baselineDraft,industryAssignment};
}

export async function loadAutonomousDecisionsPg(itemIds){
  if(!itemIds?.length)return [];
  return pgQuery(`
    select research_factory_item_id,decision_type,decision_status,policy_version,created_at
    from public.research_factory_autonomous_decisions
    where research_factory_item_id=any($1::uuid[])
    order by created_at desc
  `,[itemIds]);
}

export async function loadPriorAutonomousRunsPg(factoryRunId,limit=250){
  return pgQuery(`
    select started_at,summary
    from public.research_factory_autonomous_runs
    where research_factory_run_id=$1
    order by started_at desc
    limit $2
  `,[factoryRunId,limit]);
}

export async function createAutonomousRunPg(row){
  return insertObject("research_factory_autonomous_runs",row,{returning:"*"});
}

export async function finishAutonomousRunPg(id,patch){
  await updateObject("research_factory_autonomous_runs",patch,"id=$"+(Object.keys(patch).length+1),[id]);
}

export async function loadIndustryWorkerItemsPg(runId,ticker=null){
  return listFactoryItemsPg(runId,{ticker,requireCompany:true});
}

export async function loadScreenResultPg(id,columns="*"){
  return pgMaybeOne(`select ${columns} from public.universe_screen_results where id=$1 limit 1`,[id]);
}

export async function findIndustryAssignmentPg(itemId,decisionHash){
  return pgMaybeOne(`
    select id from public.research_factory_industry_assignments
    where research_factory_item_id=$1 and decision_hash=$2
    limit 1
  `,[itemId,decisionHash]);
}

export async function createIndustryAssignmentPg(row){
  return insertObject("research_factory_industry_assignments",row,{returning:"*"});
}

export async function storeAutonomousDecisionPg(row){
  const stored=await upsertObjects("research_factory_autonomous_decisions",[row],{
    conflict:["research_factory_item_id","decision_type","decision_hash"],
    ignoreDuplicates:true,
    returning:"id",
  });
  return stored[0]??null;
}

export async function transitionFactoryItemPg(args){
  const row=await pgMaybeOne(`
    select public.transition_research_factory_item_v1(
      $1::uuid,$2::text,$3::text,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::numeric,
      $9::integer,$10::integer,$11::jsonb,$12::jsonb,$13::text,$14::text,$15::text
    ) as result
  `,[
    args.itemId,args.stage,args.status,args.companyId??null,args.coverageReportId??null,
    args.baselineDraftId??null,args.compositionId??null,args.coveragePct??null,
    args.repairJobCount??0,args.manualReviewCount??0,JSON.stringify(args.nextActions??[]),
    JSON.stringify(args.stateSnapshot??{}),args.stateHash,args.lastError??null,args.eventType,
  ]);
  return row?.result??null;
}

export async function loadValuationPolicyInputsPg(item){
  const [screenResult,baselineDraft,fundamentals,market,consensus,valuationHistory,contextPack,coverage]=await Promise.all([
    pgMaybeOne(`select * from public.universe_screen_results where id=$1 limit 1`,[item.source_screen_result_id]),
    pgMaybeOne(`select * from public.baseline_drafts where company_id=$1 order by generated_at desc limit 1`,[item.company_id]),
    pgQuery(`select * from public.fundamental_snapshots where company_id=$1 order by period_end desc limit 160`,[item.company_id]),
    pgMaybeOne(`select trading_date,price,market_cap,provider,source_url,observed_at
                 from public.market_snapshots where company_id=$1 order by trading_date desc limit 1`,[item.company_id]),
    pgMaybeOne(`select * from public.consensus_snapshots where company_id=$1 order by observed_at desc limit 1`,[item.company_id]),
    pgQuery(`select trading_date,pe,forward_pe,ev_to_ebitda,price_to_fcf,fcf_yield,provider,source_url,observed_at
             from public.valuation_history where company_id=$1 order by trading_date desc limit 3200`,[item.company_id]),
    pgMaybeOne(`select * from public.research_context_packs where company_id=$1 order by as_of_date desc,generated_at desc limit 1`,[item.company_id]),
    pgMaybeOne(`select * from public.data_coverage_reports where company_id=$1 and engine_version='coverage-v2'
                 order by as_of_date desc,generated_at desc limit 1`,[item.company_id]),
  ]);
  return {screenResult,baselineDraft,fundamentals,market,consensus,valuationHistory,contextPack,coverage};
}

export async function findValuationDraftPg(itemId,inputHash){
  return pgMaybeOne(`
    select id from public.research_factory_valuation_drafts
    where research_factory_item_id=$1 and input_hash=$2 limit 1
  `,[itemId,inputHash]);
}

export async function createValuationDraftPg(row){
  return insertObject("research_factory_valuation_drafts",row,{returning:"*"});
}

export async function publishAutonomousValuationPackPg(args){
  const row=await pgMaybeOne(`
    select public.publish_autonomous_valuation_pack_v2_1(
      $1::uuid,$2::text,$3::text,$4::jsonb,$5::text,$6::numeric,$7::text
    ) as id
  `,[
    args.itemId,args.decisionHash,args.industryModule,JSON.stringify(args.valuationInput),
    args.inputHash,args.confidence,args.policyVersion,
  ]);
  return row?.id??null;
}

export async function createAutomationRunPg(row){
  return insertObject("automation_runs",row,{returning:"*"});
}

export async function loadPendingRepairJobsPg(maxJobs){
  return pgQuery(`
    select id,company_id,layer,field,repair_type,runner,status,priority,attempt_count,details
    from public.research_repair_jobs
    where automation_mode='auto' and status='pending' and attempt_count<3
    order by priority desc
    limit $1
  `,[maxJobs]);
}

export async function loadCompanyTickersPg(companyIds){
  if(!companyIds?.length)return [];
  return pgQuery(`select id,ticker from public.companies where id=any($1::uuid[])`,[companyIds]);
}

export async function updateRepairJobsPg(ids,patch){
  if(!ids?.length)return;
  const keys=Object.keys(patch);
  const values=keys.map((key)=>patch[key]);
  values.push(ids);
  const set=keys.map((key,i)=>`"${key}"=$${i+1}`).join(",");
  await pgQuery(`update public.research_repair_jobs set ${set} where id=any($${values.length}::uuid[])`,values);
}

export async function updateAutomationRunPg(id,patch){
  await updateObject("automation_runs",patch,"id=$"+(Object.keys(patch).length+1),[id]);
}

export async function findFactoryRunBySourcePg(sourcePipelineRunId,factoryVersion){
  return pgMaybeOne(
    `select *
     from public.research_factory_runs
     where source_pipeline_run_id=$1 and factory_version=$2
     limit 1`,
    [sourcePipelineRunId,factoryVersion],
  );
}

export async function createResearchFactoryRunPg(runPayload,items){
  const existing=await findFactoryRunBySourcePg(
    runPayload.source_pipeline_run_id,
    runPayload.factory_version,
  );
  if(existing){
    const storedSourceHash=existing?.metadata?.source_pipeline_input_hash??null;
    const currentSourceHash=runPayload?.metadata?.source_pipeline_input_hash??null;
    const sameSourceIdentity=
      storedSourceHash &&
      currentSourceHash &&
      storedSourceHash===currentSourceHash &&
      Number(existing.candidate_count)===Number(runPayload.candidate_count);

    if(existing.input_hash!==runPayload.input_hash && !sameSourceIdentity){
      throw new Error(
        "Existing Research Factory run for source pipeline "+
        runPayload.source_pipeline_run_id+
        " and version "+runPayload.factory_version+
        " does not match the current immutable source pipeline. "+
        "Stored factory hash="+existing.input_hash+
        ", current factory hash="+runPayload.input_hash+
        ", stored source hash="+storedSourceHash+
        ", current source hash="+currentSourceHash+
        ", stored candidates="+existing.candidate_count+
        ", current candidates="+runPayload.candidate_count+
        ". Investigate before replacing the run."
      );
    }

    // Historical Research Factory runs may have been hashed with an older
    // factory-hash contract. Reuse is safe when the immutable source pipeline
    // identity and candidate count are unchanged.
    return existing.id;
  }

  try{
    const row=await pgMaybeOne(
      `select public.create_research_factory_run_v1($1::jsonb,$2::jsonb) as id`,
      [JSON.stringify(runPayload),JSON.stringify(items)],
    );
    return row?.id??null;
  }catch(error){
    // Another worker may have materialized the same immutable pipeline between
    // our existence check and the INSERT. Re-read the unique source/version
    // identity and reuse it when the hash is identical.
    if(error?.code==="23505"){
      const raced=await findFactoryRunBySourcePg(
        runPayload.source_pipeline_run_id,
        runPayload.factory_version,
      );
      if(raced){
        const storedSourceHash=raced?.metadata?.source_pipeline_input_hash??null;
        const currentSourceHash=runPayload?.metadata?.source_pipeline_input_hash??null;
        const sameSourceIdentity=
          storedSourceHash &&
          currentSourceHash &&
          storedSourceHash===currentSourceHash &&
          Number(raced.candidate_count)===Number(runPayload.candidate_count);
        if(raced.input_hash===runPayload.input_hash||sameSourceIdentity)return raced.id;
      }
    }
    throw error;
  }
}

export async function countFactoryItemsPg(runId){
  const row=await pgMaybeOne(`select count(*)::int as count from public.research_factory_items where research_factory_run_id=$1`,[runId]);
  return row?.count??0;
}
