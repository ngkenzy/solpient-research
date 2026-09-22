import { randomUUID } from "node:crypto";
import { canonicalSha256 } from "./integrity-hash.mjs";
import {
  PROVENANCE_VERSION,
  sourceQualityClass,
  buildNormalizedFact,
  derivedFormulaForMetric,
  manifestHash,
  assertManifestCutoff,
} from "./evidence-provenance.mjs";
import { pgQuery, pgMaybeOne, insertObject } from "./postgres-node.mjs";

function n(value){
  if(value===null||value===undefined||value==="")return null;
  const x=Number(value);return Number.isFinite(x)?x:null;
}
function sameValue(row,input){
  const a=n(row?.value_numeric),b=n(input?.value_numeric);
  if(a!=null||b!=null)return a!=null&&b!=null&&Math.abs(a-b)<=Math.max(1e-9,Math.abs(b)*1e-9);
  return String(row?.value_text??"")===String(input?.value_text??"");
}
function cutoffIso(value){
  const d=new Date(value);
  if(!Number.isFinite(d.getTime()))throw new Error("Invalid research cutoff.");
  return d.toISOString();
}
async function maybeSingleByKey(table,column,value){
  const safe=/^[a-z_][a-z0-9_]*$/i;
  if(!safe.test(table)||!safe.test(column))throw new Error("Unsafe provenance identifier.");
  return pgMaybeOne(`select * from public."${table}" where "${column}"=$1 limit 1`,[value]);
}
async function insertOrGet(table,keyColumn,row){
  const existing=await maybeSingleByKey(table,keyColumn,row[keyColumn]);
  if(existing)return existing;
  try{
    return await insertObject(table,row,{returning:"*"});
  }catch(error){
    const again=await maybeSingleByKey(table,keyColumn,row[keyColumn]);
    if(again)return again;
    throw error;
  }
}

export async function getFactAsOfPg({companyId,module="universal",metricKey,asOf,economicPeriodEnd=null,economicPeriodType=null}){
  const values=[companyId,module,metricKey,cutoffIso(asOf)];
  let sql=`select * from public.normalized_facts
    where company_id=$1 and module=$2 and metric_key=$3
      and known_at <= $4::timestamptz and conflict_state<>'superseded'`;
  if(economicPeriodEnd){values.push(economicPeriodEnd);sql+=` and economic_period_end=$${values.length}::date`;}
  if(economicPeriodType){values.push(economicPeriodType);sql+=` and economic_period_type=$${values.length}`;}
  sql+=" order by economic_period_end desc nulls last,known_at desc limit 50";
  const rows=await pgQuery(sql,values);
  return rows[0]??null;
}

export async function getCompanyFactsAsOfPg({companyId,asOf,metricKeys=null,modules=null,limit=2000}){
  const values=[companyId,cutoffIso(asOf)];
  let sql=`select * from public.normalized_facts
    where company_id=$1 and known_at <= $2::timestamptz and conflict_state<>'superseded'`;
  if(Array.isArray(metricKeys)&&metricKeys.length){values.push(metricKeys);sql+=` and metric_key=any($${values.length}::text[])`;}
  if(Array.isArray(modules)&&modules.length){values.push(modules);sql+=` and module=any($${values.length}::text[])`;}
  values.push(limit);
  sql+=` order by known_at desc limit $${values.length}`;
  const rows=await pgQuery(sql,values);
  const latest=new Map();
  for(const row of rows){
    const key=[row.module,row.metric_key,row.economic_period_end??"",row.economic_period_type??""].join("|");
    if(!latest.has(key))latest.set(key,row);
  }
  return [...latest.values()];
}

export async function getFactLineagePg(factId){
  const [fact,observations,inputs]=await Promise.all([
    pgMaybeOne(`select * from public.normalized_facts where id=$1 limit 1`,[factId]),
    pgQuery(`
      select
        l.observation_role,
        o.id,o.source_id,o.company_id,o.observation_key,o.module,o.metric_key,
        o.raw_value_numeric,o.raw_value_text,o.unit,o.economic_period_start,o.economic_period_end,
        o.economic_period_type,o.observation_at,o.known_at,o.provider,o.basis,o.source_locator,o.raw_payload,o.visibility,
        s.source_quality_class,s.source_url
      from public.normalized_fact_observations l
      join public.evidence_observations o on o.id=l.observation_id
      join public.evidence_sources s on s.id=o.source_id
      where l.normalized_fact_id=$1
    `,[factId]),
    pgQuery(`
      select input_role,input_order,input_fact_id
      from public.normalized_fact_inputs
      where normalized_fact_id=$1
      order by input_order
    `,[factId]),
  ]);
  return {
    fact,
    observations:observations.map((row)=>({
      observation_role:row.observation_role,
      evidence_observations:{
        id:row.id,source_id:row.source_id,company_id:row.company_id,observation_key:row.observation_key,
        module:row.module,metric_key:row.metric_key,raw_value_numeric:row.raw_value_numeric,
        raw_value_text:row.raw_value_text,unit:row.unit,economic_period_start:row.economic_period_start,
        economic_period_end:row.economic_period_end,economic_period_type:row.economic_period_type,
        observation_at:row.observation_at,known_at:row.known_at,provider:row.provider,basis:row.basis,
        source_locator:row.source_locator,raw_payload:row.raw_payload,visibility:row.visibility,
        evidence_sources:{source_quality_class:row.source_quality_class,source_url:row.source_url},
      },
    })),
    inputs,
  };
}

async function sourceForResearchInput({companyId,input,packageSources,cutoff}){
  const matching=(packageSources??[]).find((source)=>
    (input.source_url&&source.url===input.source_url) ||
    (input.source_title&&source.title===input.source_title)
  );
  const basis=input.basis??"reported";
  const provider=basis==="derived"?"solpient":basis==="assumption"?"solpient_analyst":String(matching?.provider??"research_input");
  const sourceType=basis==="derived"?"Solpient calculation":basis==="assumption"?"Analyst assumption":matching?.source_type??input.source_title??"Research evidence";
  const url=matching?.url??input.source_url??null;
  const retrieved=matching?.retrieved_at??cutoff;
  if(new Date(retrieved).getTime()>new Date(cutoff).getTime()){
    throw new Error("Source retrieval time exceeds research cutoff for "+input.metric_key+".");
  }
  const quality=sourceQualityClass({provider,sourceType,url,basis});
  const sourceKey=canonicalSha256({
    company_id:companyId,provider,source_type:sourceType,title:matching?.title??input.source_title??input.metric_key,
    url,accession_number:matching?.accession_number??null,filing_date:matching?.filing_date??null,
    retrieved_at:retrieved,basis
  });
  return insertOrGet("evidence_sources","source_key",{
    id:randomUUID(),company_id:companyId,source_key:sourceKey,provider,source_type:sourceType,
    title:matching?.title??input.source_title??input.metric_key,source_url:url,
    accession_number:matching?.accession_number??null,form_type:matching?.source_type??null,
    publication_at:matching?.filing_date?String(matching.filing_date)+"T00:00:00.000Z":null,
    retrieved_at:retrieved,document_identifier:matching?.accession_number??url,
    source_version:null,source_quality_class:quality,visibility:"internal",
    metadata:{research_input:true,basis,calculation_method:input.calculation_method??null}
  });
}

async function observationForResearchInput({source,companyId,input,cutoff}){
  const knownAt=source.retrieved_at??cutoff;
  const observationKey=canonicalSha256({
    source_id:source.id,company_id:companyId,module:input.module??"universal",metric_key:input.metric_key,
    value_numeric:input.value_numeric??null,value_text:input.value_text??null,unit:input.unit??null,
    period_start:input.period_start??null,period_end:input.period_end??null,period_type:input.period_type??null,
    known_at:knownAt,basis:input.basis??"reported"
  });
  return insertOrGet("evidence_observations","observation_key",{
    id:randomUUID(),source_id:source.id,company_id:companyId,observation_key:observationKey,
    module:input.module??"universal",metric_key:input.metric_key,
    raw_value_numeric:input.value_numeric??null,raw_value_text:input.value_text??null,unit:input.unit??null,
    economic_period_start:input.period_start??null,economic_period_end:input.period_end??null,
    economic_period_type:input.period_type??null,observation_at:knownAt,known_at:knownAt,
    provider:source.provider,basis:input.basis??"reported",
    source_locator:{source_url:input.source_url??null,source_title:input.source_title??null},
    raw_payload:{calculation_method:input.calculation_method??null,notes:input.notes??null},
    visibility:"internal"
  });
}

async function inputFactsForDerivedMetric({companyId,input,cutoff}){
  const formula=derivedFormulaForMetric(input.metric_key);
  if(!formula)return {formula:null,inputFacts:[]};
  const inputFacts=[];
  for(const metricKey of formula.inputs){
    const values=[companyId,metricKey,cutoff];
    let sql=`select * from public.normalized_facts
      where company_id=$1 and module='universal' and metric_key=$2
        and known_at <= $3::timestamptz and conflict_state<>'superseded'`;
    if(input.period_end){values.push(input.period_end);sql+=` and economic_period_end <= $${values.length}::date`;}
    sql+=" order by economic_period_end desc nulls last,known_at desc limit 20";
    const rows=await pgQuery(sql,values);
    const chosen=rows.find((row)=>!inputFacts.some((f)=>f.id===row.id))??rows[0];
    if(chosen)inputFacts.push(chosen);
  }
  return {formula,inputFacts};
}

export async function ensureResearchInputFactPg({companyId,input,packageSources=[],cutoff}){
  const cutoffAt=cutoffIso(cutoff);
  const values=[companyId,input.module??"universal",input.metric_key,cutoffAt];
  let sql=`select * from public.normalized_facts
    where company_id=$1 and module=$2 and metric_key=$3
      and known_at <= $4::timestamptz and conflict_state<>'superseded'`;
  if(input.period_end){values.push(input.period_end);sql+=` and economic_period_end=$${values.length}::date`;}
  if(input.period_type){values.push(input.period_type);sql+=` and economic_period_type=$${values.length}`;}
  sql+=" order by known_at desc limit 100";
  const data=await pgQuery(sql,values);
  const exact=data.find((row)=>sameValue(row,input));
  if(exact&&exact.conflict_state!=="conflicting")return exact;
  const priorFact=data[0]??null;

  const source=await sourceForResearchInput({companyId,input,packageSources,cutoff:cutoffAt});
  const observation=await observationForResearchInput({source,companyId,input,cutoff:cutoffAt});

  const competing=await pgQuery(`
    select o.*,s.source_quality_class
    from public.evidence_observations o
    join public.evidence_sources s on s.id=o.source_id
    where o.company_id=$1 and o.module=$2 and o.metric_key=$3 and o.known_at <= $4::timestamptz
    order by o.known_at desc limit 100
  `,[companyId,input.module??"universal",input.metric_key,cutoffAt]);
  const periodMatched=competing.filter((row)=>
    String(row.economic_period_end??"")===String(input.period_end??"") &&
    String(row.economic_period_type??"")===String(input.period_type??"")
  );

  const resolutionValues=[companyId,input.module??"universal",input.metric_key,cutoffAt];
  let resolutionSql=`select * from public.evidence_resolution_decisions
    where company_id=$1 and module=$2 and metric_key=$3 and decided_at <= $4::timestamptz`;
  if(input.period_end){resolutionValues.push(input.period_end);resolutionSql+=` and economic_period_end=$${resolutionValues.length}::date`;}
  resolutionSql+=" order by decided_at desc limit 25";
  const resolutionRows=await pgQuery(resolutionSql,resolutionValues);
  const resolutionDecision=resolutionRows.find((row)=>
    String(row.economic_period_type??"")===String(input.period_type??"")
  )??null;

  const {formula,inputFacts}=await inputFactsForDerivedMetric({companyId,input,cutoff:cutoffAt});
  const built=buildNormalizedFact({
    companyId,module:input.module??"universal",metricKey:input.metric_key,unit:input.unit??null,
    economicPeriodStart:input.period_start??null,economicPeriodEnd:input.period_end??null,
    economicPeriodType:input.period_type??null,
    observations:periodMatched.length?periodMatched:[{...observation,source_quality_class:source.source_quality_class}],
    derivationBasis:input.calculation_method??null,formulaIdentifier:formula?.formula_identifier??null,
    calculationEngineVersion:(input.basis??"reported")==="derived"?"research-input-derivation-v1":null,
    calculatedAt:(input.basis??"reported")==="derived"?cutoffAt:null,
    inputFactIds:inputFacts.map((row)=>row.id),visibility:"internal",
    conflictOptions:resolutionDecision?{
      preferredObservationId:resolutionDecision.selected_observation_id,
      resolutionReason:resolutionDecision.decision_reason,
      resolvedAt:resolutionDecision.decided_at,
    }:{},
    supersedesFactId:priorFact?.id??null,
    supersessionReason:priorFact
      ? (resolutionDecision
          ? "Explicit evidence conflict resolution superseded the prior canonical fact."
          : "New research evidence superseded the prior canonical fact.")
      : null,
  });
  if(!built)throw new Error("Could not normalize research input "+input.metric_key+".");

  const selected=built.fact;
  if(!sameValue(selected,input)){
    throw new Error(
      "Material provenance conflict for "+input.metric_key+
      ": canonical selected value differs from reviewed research input. Resolve source selection before publication."
    );
  }

  let fact=await maybeSingleByKey("normalized_facts","fact_key",selected.fact_key);
  if(!fact){
    try{fact=await insertObject("normalized_facts",selected,{returning:"*"});}
    catch(error){
      fact=await maybeSingleByKey("normalized_facts","fact_key",selected.fact_key);
      if(!fact)throw error;
    }
  }

  const remap=(id)=>id===selected.id?fact.id:id;
  for(const row of built.observationLinks){
    await pgQuery(`
      insert into public.normalized_fact_observations(normalized_fact_id,observation_id,observation_role)
      values($1,$2,$3)
      on conflict(normalized_fact_id,observation_id) do nothing
    `,[fact.id,row.observation_id,row.observation_role]);
  }
  for(const row of built.inputLinks){
    await pgQuery(`
      insert into public.normalized_fact_inputs(normalized_fact_id,input_fact_id,input_role,input_order)
      values($1,$2,$3,$4)
      on conflict(normalized_fact_id,input_fact_id,input_role) do nothing
    `,[fact.id,remap(row.input_fact_id),row.input_role,row.input_order??0]);
  }
  return fact;
}

export async function buildResearchInputManifestPg({draft,composition,packagePayload}){
  const companyId=draft.company_id;
  const cutoff=cutoffIso(packagePayload.research?.data_cutoff_at??draft.source_cutoff_at);
  const packageSources=packagePayload.sources??[];
  const observations=(packagePayload.metric_observations??[]).filter((row)=>row?.status==="available");
  const items=[];
  let conflicts=0,provisional=0,assumptions=0;

  for(const input of observations){
    if((input.basis??"reported")==="assumption"){
      assumptions+=1;
      const item={
        normalized_fact_id:null,input_role:"research_metric",module:input.module??"universal",metric_key:input.metric_key,
        value_numeric:input.value_numeric??null,value_text:input.value_text??null,unit:input.unit??null,
        economic_period_start:input.period_start??null,economic_period_end:input.period_end??null,
        economic_period_type:input.period_type??null,known_at:cutoff,basis:"assumption",
        source_confidence_class:"analyst_assumption",conflict_state:"provisional",
        provenance_status:"explicit_assumption",derivation_basis:input.calculation_method??input.notes??null,
        source_lineage:[],lineage_metadata:{notes:input.notes??null}
      };
      item.input_hash=canonicalSha256(item);items.push(item);continue;
    }

    const fact=await ensureResearchInputFactPg({companyId,input,packageSources,cutoff});
    const lineage=await getFactLineagePg(fact.id);
    if(fact.conflict_state==="conflicting")conflicts+=1;
    if(fact.conflict_state==="provisional")provisional+=1;
    const sourceLineage=(lineage.observations??[]).map((row)=>({
      role:row.observation_role,observation_id:row.evidence_observations?.id??null,
      source_id:row.evidence_observations?.source_id??null,
      provider:row.evidence_observations?.provider??null,
      source_quality_class:row.evidence_observations?.evidence_sources?.source_quality_class??null,
      source_url:row.evidence_observations?.evidence_sources?.source_url??null,
      known_at:row.evidence_observations?.known_at??null
    }));
    const item={
      normalized_fact_id:fact.id,input_role:"research_metric",module:input.module??"universal",metric_key:input.metric_key,
      value_numeric:input.value_numeric??null,value_text:input.value_text??null,unit:input.unit??null,
      economic_period_start:input.period_start??null,economic_period_end:input.period_end??null,
      economic_period_type:input.period_type??null,known_at:fact.known_at,basis:input.basis??"reported",
      source_confidence_class:fact.source_confidence_class,conflict_state:fact.conflict_state,
      provenance_status:fact.conflict_state==="verified"?"complete":"provisional",
      derivation_basis:fact.derivation_basis??input.calculation_method??null,
      source_lineage:sourceLineage,
      lineage_metadata:{fact_input_ids:(lineage.inputs??[]).map((x)=>x.input_fact_id),selection_reason:fact.selection_reason}
    };
    item.input_hash=canonicalSha256(item);items.push(item);
  }

  assertManifestCutoff(items,cutoff);
  if(conflicts>0){
    throw new Error("Promotion blocked: "+conflicts+" material provenance conflict(s) must be resolved before publication.");
  }
  const provenanceStatus=provisional>0||assumptions>0?"partial":"complete";
  const manifest={
    draft_id:draft.id,composition_id:composition.id,company_id:companyId,
    context_pack_id:composition.context_pack_id??null,cutoff_at:cutoff,
    manifest_version:PROVENANCE_VERSION,provenance_status:provenanceStatus,items,
    confidence_summary:{
      material_conflicts:conflicts,provisional_facts:provisional,explicit_assumptions:assumptions,
      fact_backed_inputs:items.filter((x)=>x.normalized_fact_id).length,total_inputs:items.length,
      provenance_complete_pct:items.length?items.filter((x)=>x.provenance_status==="complete").length/items.length*100:0
    }
  };
  manifest.manifest_hash=manifestHash(manifest);
  return manifest;
}

export async function stageResearchInputManifestPg(manifest){
  await insertObject("research_input_manifest_staging",{
    draft_id:manifest.draft_id,composition_id:manifest.composition_id,company_id:manifest.company_id,
    context_pack_id:manifest.context_pack_id,cutoff_at:manifest.cutoff_at,manifest_version:manifest.manifest_version,
    manifest_hash:manifest.manifest_hash,provenance_status:manifest.provenance_status,
    items:manifest.items,confidence_summary:manifest.confidence_summary,updated_at:new Date().toISOString()
  },{conflict:["draft_id"],update:true,returning:"draft_id"});
}
