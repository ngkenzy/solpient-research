import { pgMaybeOne, pgQuery, insertObject, upsertObjects, pgTransaction } from "./postgres-node.mjs";

export async function loadCompanyFactoryInputsPg(companyId,{fundamentalLimit=160,marketLimit=3200,filingLimit=25}={}){
  const [company,market,markets,fundamentals,filings,context]=await Promise.all([
    pgMaybeOne(`select * from public.companies where id=$1 limit 1`,[companyId]),
    pgMaybeOne(`select * from public.market_snapshots where company_id=$1 order by trading_date desc limit 1`,[companyId]),
    pgQuery(`select * from public.market_snapshots where company_id=$1 order by trading_date desc limit $2`,[companyId,marketLimit]),
    pgQuery(`select * from public.fundamental_snapshots where company_id=$1 order by period_end desc limit $2`,[companyId,fundamentalLimit]),
    pgQuery(`select id,provider,form_type,filed_at,accepted_at,accession_number,filing_url,period_end,title
             from public.filing_events where company_id=$1 order by filed_at desc limit $2`,[companyId,filingLimit]),
    pgMaybeOne(`select * from public.research_context_packs where company_id=$1 order by as_of_date desc limit 1`,[companyId]),
  ]);
  return {company,market,markets,fundamentals,filings,context};
}

export async function loadCompanyFactoryInputsByTickerPg(ticker,{fundamentalLimit=20,filingLimit=25}={}){
  const company=await pgMaybeOne(
    `select id,ticker,company_name,cik,exchange,sector,industry,description
     from public.companies where ticker=$1 limit 1`,
    [String(ticker).toUpperCase()],
  );
  if(!company)return {company:null,market:null,fundamentals:[],filings:[],context:null};
  const [market,fundamentals,filings,context]=await Promise.all([
    pgMaybeOne(`select * from public.market_snapshots where symbol=$1 order by trading_date desc limit 1`,[company.ticker]),
    pgQuery(`select * from public.fundamental_snapshots where company_id=$1 order by period_end desc limit $2`,[company.id,fundamentalLimit]),
    pgQuery(`select id,provider,form_type,filed_at,accepted_at,accession_number,filing_url,period_end,title
             from public.filing_events where company_id=$1 order by filed_at desc limit $2`,[company.id,filingLimit]),
    pgMaybeOne(`select * from public.research_context_packs where company_id=$1 order by as_of_date desc limit 1`,[company.id]),
  ]);
  return {company,market,fundamentals,filings,context};
}

export async function latestAutonomousIndustryAssignmentPg({companyId=null,researchFactoryItemId=null,ticker=null}={}){
  const values=[];
  let sql=`select * from public.research_factory_industry_assignments where status='applied'`;
  if(researchFactoryItemId){values.push(researchFactoryItemId);sql+=` and research_factory_item_id=$1`;}
  else if(companyId){values.push(companyId);sql+=` and company_id=$1`;}
  else if(ticker){values.push(String(ticker).toUpperCase());sql+=` and ticker=$1`;}
  else return null;
  sql+=" order by created_at desc limit 1";
  return pgMaybeOne(sql,values);
}

export async function persistPeerContextPg({companyId,contextId,peerContext,summary,now}){
  const rows=(peerContext.snapshotRows??[]).map((row)=>({...row,company_id:companyId}));
  if(rows.length){
    await upsertObjects("peer_metric_snapshots",rows,{
      conflict:["company_id","peer_ticker","metric_key","as_of_date"],
      batchSize:400,
    });
  }
  if(contextId){
    await pgQuery(
      `update public.research_context_packs
       set peer_set=$2::jsonb,peer_comparison=$3::jsonb,summary=$4::jsonb,updated_at=$5::timestamptz
       where id=$1`,
      [
        contextId,
        JSON.stringify(peerContext.peerSet??[]),
        JSON.stringify(peerContext.peerComparison??[]),
        JSON.stringify(summary??{}),
        now,
      ],
    );
  }
}

export async function persistValuationHistoryPg(rows){
  if(!rows?.length)return;
  await upsertObjects("valuation_history",rows,{
    conflict:["company_id","trading_date","provider"],
    batchSize:400,
  });
}

export async function upsertBaselineDraftPg(row){
  return insertObject("baseline_drafts",row,{
    conflict:["company_id","generation_version","source_cutoff_at"],
    update:true,
    returning:"*",
  });
}

export async function persistBuiltResearchPackagePg({
  draft,
  companyId,
  composition,
  engineVersion,
  contextPackId,
  validation,
  readiness,
  now,
  reviewNotes,
}){
  return pgTransaction(async(client)=>{
    const compositionValues=[
      draft.id,companyId,engineVersion,contextPackId,"applied",
      JSON.stringify(composition),JSON.stringify(validation),now,now,now,
    ];
    const compResult=await client.query(
      `insert into public.research_compositions(
         draft_id,company_id,engine_version,context_pack_id,status,composition_payload,
         validation_result,generated_at,applied_at,updated_at
       ) values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::timestamptz,$9::timestamptz,$10::timestamptz)
       on conflict(draft_id,engine_version) do update set
         company_id=excluded.company_id,
         context_pack_id=excluded.context_pack_id,
         status=excluded.status,
         composition_payload=excluded.composition_payload,
         validation_result=excluded.validation_result,
         generated_at=excluded.generated_at,
         applied_at=excluded.applied_at,
         updated_at=excluded.updated_at
       returning id`,
      compositionValues,
    );
    const compositionId=compResult.rows[0]?.id;

    await client.query(
      `insert into public.baseline_reviews(
         draft_id,status,review_payload,validation_result,promotion_readiness,review_notes,
         reviewed_at,prepared_at,preparation_source,human_verified_at,human_verified_by,
         human_verified_payload_hash,attestation_version,updated_at
       ) values($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,null,$7::timestamptz,'factory_composer',
         null,null,null,null,$7::timestamptz)
       on conflict(draft_id) do update set
         status=excluded.status,
         review_payload=excluded.review_payload,
         validation_result=excluded.validation_result,
         promotion_readiness=excluded.promotion_readiness,
         review_notes=excluded.review_notes,
         reviewed_at=null,
         prepared_at=excluded.prepared_at,
         preparation_source=excluded.preparation_source,
         human_verified_at=null,
         human_verified_by=null,
         human_verified_payload_hash=null,
         attestation_version=null,
         updated_at=excluded.updated_at`,
      [
        draft.id,
        readiness.ready?"ready":"editing",
        JSON.stringify(composition.review_patch??{}),
        JSON.stringify(readiness.standard),
        JSON.stringify(readiness),
        reviewNotes,
        now,
      ],
    );

    await client.query(
      `update public.baseline_drafts
       set status=$2,standard_valid=$3,standard_status=$4,validation_result=$5::jsonb,updated_at=$6::timestamptz
       where id=$1`,
      [
        draft.id,
        readiness.ready?"ready_for_review":"generated",
        readiness.standard.valid,
        readiness.standard.status,
        JSON.stringify(readiness.standard),
        now,
      ],
    );
    return {compositionId};
  });
}
