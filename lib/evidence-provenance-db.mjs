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
  const d=new Date(value);if(!Number.isFinite(d.getTime()))throw new Error("Invalid research cutoff.");
  return d.toISOString();
}
async function maybeSingleByKey(supabase,table,column,value){
  const {data,error}=await supabase.from(table).select("*").eq(column,value).limit(1).maybeSingle();
  if(error)throw error;return data;
}
async function insertOrGet(supabase,table,keyColumn,row){
  const existing=await maybeSingleByKey(supabase,table,keyColumn,row[keyColumn]);
  if(existing)return existing;
  const {data,error}=await supabase.from(table).insert(row).select("*").single();
  if(error){
    const again=await maybeSingleByKey(supabase,table,keyColumn,row[keyColumn]);
    if(again)return again;
    throw error;
  }
  return data;
}

export async function getFactAsOf(supabase,{companyId,module="universal",metricKey,asOf,economicPeriodEnd=null,economicPeriodType=null}){
  let query=supabase.from("normalized_facts").select("*")
    .eq("company_id",companyId).eq("module",module).eq("metric_key",metricKey)
    .lte("known_at",cutoffIso(asOf))
    .neq("conflict_state","superseded")
    .order("economic_period_end",{ascending:false,nullsFirst:false})
    .order("known_at",{ascending:false})
    .limit(50);
  if(economicPeriodEnd)query=query.eq("economic_period_end",economicPeriodEnd);
  if(economicPeriodType)query=query.eq("economic_period_type",economicPeriodType);
  const {data,error}=await query;
  if(error)throw error;
  return (data??[])[0]??null;
}

export async function getCompanyFactsAsOf(supabase,{companyId,asOf,metricKeys=null,modules=null,limit=2000}){
  let query=supabase.from("normalized_facts").select("*")
    .eq("company_id",companyId).lte("known_at",cutoffIso(asOf))
    .neq("conflict_state","superseded")
    .order("known_at",{ascending:false})
    .limit(limit);
  if(Array.isArray(metricKeys)&&metricKeys.length)query=query.in("metric_key",metricKeys);
  if(Array.isArray(modules)&&modules.length)query=query.in("module",modules);
  const {data,error}=await query;
  if(error)throw error;
  const latest=new Map();
  for(const row of data??[]){
    const key=[row.module,row.metric_key,row.economic_period_end??"",row.economic_period_type??""].join("|");
    if(!latest.has(key))latest.set(key,row);
  }
  return [...latest.values()];
}

export async function getFactLineage(supabase,factId){
  const [factR,obsLinksR,inputLinksR]=await Promise.all([
    supabase.from("normalized_facts").select("*").eq("id",factId).maybeSingle(),
    supabase.from("normalized_fact_observations")
      .select("observation_role,evidence_observations(*,evidence_sources(*))")
      .eq("normalized_fact_id",factId),
    supabase.from("normalized_fact_inputs")
      .select("input_role,input_order,input_fact_id")
      .eq("normalized_fact_id",factId).order("input_order"),
  ]);
  for(const r of [factR,obsLinksR,inputLinksR])if(r.error)throw r.error;
  return {fact:factR.data,observations:obsLinksR.data??[],inputs:inputLinksR.data??[]};
}

export async function getResearchInputManifest(supabase,researchRunId){
  const {data:manifest,error}=await supabase.from("research_input_manifests")
    .select("*").eq("research_run_id",researchRunId).maybeSingle();
  if(error)throw error;
  if(!manifest)return null;
  const {data:items,error:itemsError}=await supabase.from("research_input_manifest_items")
    .select("*").eq("manifest_id",manifest.id).order("input_role").order("module").order("metric_key");
  if(itemsError)throw itemsError;
  return {...manifest,items:items??[]};
}

export async function getSourceEvidence(supabase,sourceId){
  const {data,error}=await supabase.from("evidence_sources").select("*").eq("id",sourceId).maybeSingle();
  if(error)throw error;return data;
}

export async function resolveResearchTemporalContext(supabase,researchRunId){
  const {data:run,error}=await supabase.from("research_runs")
    .select("id,company_id,version,data_cutoff_at,researched_at,source_context_pack_id")
    .eq("id",researchRunId).maybeSingle();
  if(error)throw error;
  if(!run)return null;
  const cutoff=cutoffIso(run.data_cutoff_at??run.researched_at);
  let contextPack=null;
  if(run.source_context_pack_id){
    const {data,error:contextError}=await supabase.from("research_context_packs")
      .select("*").eq("id",run.source_context_pack_id).maybeSingle();
    if(contextError)throw contextError;
    contextPack=data;
  }else{
    const cutoffDate=cutoff.slice(0,10);
    const {data,error:contextError}=await supabase.from("research_context_packs")
      .select("*").eq("company_id",run.company_id)
      .lte("as_of_date",cutoffDate)
      .lte("generated_at",cutoff)
      .order("as_of_date",{ascending:false})
      .order("generated_at",{ascending:false})
      .limit(1).maybeSingle();
    if(contextError)throw contextError;
    contextPack=data;
  }
  return {run,cutoff,contextPack,legacyContextFallback:!run.source_context_pack_id};
}

async function sourceForResearchInput(supabase,{companyId,input,packageSources,cutoff}){
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
  return insertOrGet(supabase,"evidence_sources","source_key",{
    id:randomUUID(),company_id:companyId,source_key:sourceKey,provider,source_type:sourceType,
    title:matching?.title??input.source_title??input.metric_key,source_url:url,
    accession_number:matching?.accession_number??null,form_type:matching?.source_type??null,
    publication_at:matching?.filing_date?String(matching.filing_date)+"T00:00:00.000Z":null,
    retrieved_at:retrieved,document_identifier:matching?.accession_number??url,
    source_version:null,source_quality_class:quality,visibility:"internal",
    metadata:{research_input:true,basis,calculation_method:input.calculation_method??null}
  });
}

async function observationForResearchInput(supabase,{source,companyId,input,cutoff}){
  const knownAt=source.retrieved_at??cutoff;
  const observationKey=canonicalSha256({
    source_id:source.id,company_id:companyId,module:input.module??"universal",metric_key:input.metric_key,
    value_numeric:input.value_numeric??null,value_text:input.value_text??null,unit:input.unit??null,
    period_start:input.period_start??null,period_end:input.period_end??null,period_type:input.period_type??null,
    known_at:knownAt,basis:input.basis??"reported"
  });
  return insertOrGet(supabase,"evidence_observations","observation_key",{
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

async function inputFactsForDerivedMetric(supabase,{companyId,input,cutoff}){
  const formula=derivedFormulaForMetric(input.metric_key);
  if(!formula)return {formula:null,inputFacts:[]};
  const inputFacts=[];
  for(const metricKey of formula.inputs){
    let query=supabase.from("normalized_facts").select("*")
      .eq("company_id",companyId).eq("module","universal").eq("metric_key",metricKey)
      .lte("known_at",cutoff).neq("conflict_state","superseded")
      .order("economic_period_end",{ascending:false,nullsFirst:false}).order("known_at",{ascending:false}).limit(20);
    if(input.period_end)query=query.lte("economic_period_end",input.period_end);
    const {data,error}=await query;
    if(error)throw error;
    const chosen=(data??[]).find((row)=>!inputFacts.some((f)=>f.id===row.id))??data?.[0];
    if(chosen)inputFacts.push(chosen);
  }
  return {formula,inputFacts};
}

export async function ensureResearchInputFact(supabase,{companyId,input,packageSources=[],cutoff}){
  const cutoffAt=cutoffIso(cutoff);
  let query=supabase.from("normalized_facts").select("*")
    .eq("company_id",companyId)
    .eq("module",input.module??"universal")
    .eq("metric_key",input.metric_key)
    .lte("known_at",cutoffAt)
    .neq("conflict_state","superseded")
    .order("known_at",{ascending:false}).limit(100);
  if(input.period_end)query=query.eq("economic_period_end",input.period_end);
  if(input.period_type)query=query.eq("economic_period_type",input.period_type);
  const {data,error}=await query;
  if(error)throw error;
  const exact=(data??[]).find((row)=>sameValue(row,input));
  if(exact&&exact.conflict_state!=="conflicting")return exact;

  const source=await sourceForResearchInput(supabase,{companyId,input,packageSources,cutoff:cutoffAt});
  const observation=await observationForResearchInput(supabase,{source,companyId,input,cutoff:cutoffAt});

  const {data:competing,error:competingError}=await supabase.from("evidence_observations")
    .select("*,evidence_sources(source_quality_class)")
    .eq("company_id",companyId)
    .eq("module",input.module??"universal")
    .eq("metric_key",input.metric_key)
    .lte("known_at",cutoffAt)
    .order("known_at",{ascending:false}).limit(100);
  if(competingError)throw competingError;
  const periodMatched=(competing??[]).filter((row)=>
    String(row.economic_period_end??"")===String(input.period_end??"") &&
    String(row.economic_period_type??"")===String(input.period_type??"")
  ).map((row)=>({...row,source_quality_class:row.evidence_sources?.source_quality_class}));

  let resolutionQuery=supabase.from("evidence_resolution_decisions")
    .select("*")
    .eq("company_id",companyId)
    .eq("module",input.module??"universal")
    .eq("metric_key",input.metric_key)
    .lte("decided_at",cutoffAt)
    .order("decided_at",{ascending:false})
    .limit(25);
  if(input.period_end)resolutionQuery=resolutionQuery.eq("economic_period_end",input.period_end);
  const {data:resolutionRows,error:resolutionError}=await resolutionQuery;
  if(resolutionError)throw resolutionError;
  const resolutionDecision=(resolutionRows??[]).find((row)=>
    String(row.economic_period_type??"")===String(input.period_type??"")
  )??null;

  const {formula,inputFacts}=await inputFactsForDerivedMetric(supabase,{companyId,input,cutoff:cutoffAt});
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
    }:{},
  });
  if(!built)throw new Error("Could not normalize research input "+input.metric_key+".");

  const selected=built.fact;
  if(!sameValue(selected,input)){
    throw new Error(
      "Material provenance conflict for "+input.metric_key+
      ": canonical selected value differs from reviewed research input. Resolve source selection before publication."
    );
  }

  const existingFact=await maybeSingleByKey(supabase,"normalized_facts","fact_key",selected.fact_key);
  let fact=existingFact;
  if(!fact){
    const {data:inserted,error:factError}=await supabase.from("normalized_facts").insert(selected).select("*").single();
    if(factError){
      fact=await maybeSingleByKey(supabase,"normalized_facts","fact_key",selected.fact_key);
      if(!fact)throw factError;
    }else fact=inserted;
  }

  const remap=(id)=>id===selected.id?fact.id:id;
  const observationLinks=built.observationLinks.map((row)=>({...row,normalized_fact_id:fact.id}));
  if(observationLinks.length){
    const {error:linkError}=await supabase.from("normalized_fact_observations")
      .upsert(observationLinks,{onConflict:"normalized_fact_id,observation_id",ignoreDuplicates:true});
    if(linkError)throw linkError;
  }
  const inputLinks=built.inputLinks.map((row)=>({...row,normalized_fact_id:fact.id,input_fact_id:remap(row.input_fact_id)}));
  if(inputLinks.length){
    const {error:inputError}=await supabase.from("normalized_fact_inputs")
      .upsert(inputLinks,{onConflict:"normalized_fact_id,input_fact_id,input_role",ignoreDuplicates:true});
    if(inputError)throw inputError;
  }
  return fact;
}

export async function buildResearchInputManifest(supabase,{draft,composition,packagePayload}){
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

    const fact=await ensureResearchInputFact(supabase,{companyId,input,packageSources,cutoff});
    const lineage=await getFactLineage(supabase,fact.id);
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

export async function stageResearchInputManifest(supabase,manifest){
  const {error}=await supabase.from("research_input_manifest_staging").upsert({
    draft_id:manifest.draft_id,composition_id:manifest.composition_id,company_id:manifest.company_id,
    context_pack_id:manifest.context_pack_id,cutoff_at:manifest.cutoff_at,manifest_version:manifest.manifest_version,
    manifest_hash:manifest.manifest_hash,provenance_status:manifest.provenance_status,
    items:manifest.items,confidence_summary:manifest.confidence_summary,updated_at:new Date().toISOString()
  },{onConflict:"draft_id"});
  if(error)throw error;
}
