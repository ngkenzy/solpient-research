export const ENRICHMENT_ENGINE_VERSION="enrichment-v1";

function allowedHost(host,domains=[]){return domains.some(d=>host===d||host.endsWith("."+d));}
export function validateEnrichmentPack(pack){
  const errors=[],sources=new Map();
  if(!pack?.ticker) errors.push("ticker required");
  if(!pack?.run_key) errors.push("run_key required");
  for(const s of pack?.sources??[]){
    if(!s.key||!s.title||!s.url){errors.push("invalid source");continue;}
    sources.set(s.key,s);
    try{const u=new URL(s.url);if(u.protocol!=="https:"||!allowedHost(u.hostname,pack.allowed_domains??[]))errors.push("source host not allowed: "+s.key);}catch{errors.push("invalid source url: "+s.key);}
  }
  for(const i of pack?.items??[]){
    if(!i.item_key||!i.item_type||!i.label||!i.source_key)errors.push("invalid item");
    if(!["metric","evidence","gap_note"].includes(i.item_type))errors.push("invalid item type: "+i.item_key);
    if(!["reported","derived","assessment"].includes(i.basis))errors.push("invalid basis: "+i.item_key);
    if(!["high","medium","low"].includes(i.confidence))errors.push("invalid confidence: "+i.item_key);
    if(i.item_type==="metric"&&!i.metric_key)errors.push("metric_key required: "+i.item_key);
    if(!sources.has(i.source_key))errors.push("unknown source: "+i.item_key);
  }
  return {valid:errors.length===0,errors};
}

export function materializeEnrichmentItems(pack,{draftId,runId}){
  const check=validateEnrichmentPack(pack);if(!check.valid)throw new Error(check.errors.join("; "));
  const sources=new Map(pack.sources.map(s=>[s.key,s]));
  return pack.items.map(i=>{const s=sources.get(i.source_key);return{
    run_id:runId,draft_id:draftId,item_key:i.item_key,item_type:i.item_type,module:i.module??null,metric_key:i.metric_key??null,
    label:i.label,fact_text:i.fact_text??null,value_numeric:i.value_numeric??null,value_text:i.value_text??null,unit:i.unit??null,
    period_end:i.period_end??null,period_type:i.period_type??null,basis:i.basis,confidence:i.confidence,
    source_title:s.title,source_url:s.url,source_type:s.source_type??null,source_date:s.source_date??null,
    interpretation:i.interpretation??null,status:"proposed",
    metadata:{calculation_method:i.calculation_method??null,caveat:i.caveat??null,source_primary:Boolean(s.primary)}
  }});
}

function metricFrom(i){
  const available=i.value_numeric!==null&&i.value_numeric!==undefined||Boolean(i.value_text);
  return {module:i.module??"universal",metric_key:i.metric_key,label:i.label,value_numeric:i.value_numeric==null?null:Number(i.value_numeric),
    value_text:i.value_text??null,unit:i.unit??null,period_end:i.period_end??null,period_type:i.period_type??null,basis:i.basis,
    status:available?"available":"not_available",source_title:i.source_title,source_url:i.source_url,
    calculation_method:i.metadata?.calculation_method??null,notes:[i.interpretation,i.metadata?.caveat].filter(Boolean).join(" ")||null};
}
export function buildEnrichmentReviewPatch(items=[]){
  const eligible=items.filter(i=>i.status!=="rejected"&&["high","medium"].includes(i.confidence)&&["reported","derived"].includes(i.basis));
  const metrics=new Map(),sources=new Map(),evidence=[];
  for(const i of eligible){
    if(i.item_type==="metric"&&i.metric_key){const m=metricFrom(i);metrics.set((m.module??"universal")+":"+m.metric_key,m);}
    sources.set(i.source_url,{source_type:i.source_type??"Primary source",title:i.source_title,url:i.source_url,filing_date:i.source_date??null,accession_number:null});
    if(i.fact_text)evidence.push({fact:i.fact_text,source:i.source_title,url:i.source_url,confidence:i.confidence,basis:i.basis,interpretation:i.interpretation??null});
  }
  return {metric_observations:[...metrics.values()],sources:[...sources.values()],business_assessment:{evidence}};
}
function mergeMetrics(a=[],b=[]){const m=new Map();for(const r of [...a,...b])m.set((r.module??"universal")+":"+r.metric_key,{...(m.get((r.module??"universal")+":"+r.metric_key)??{}),...r});return[...m.values()];}
function mergeSources(a=[],b=[]){const m=new Map();for(const r of [...a,...b])if(r?.url)m.set(r.url,r);return[...m.values()];}
export function mergeReviewPatches(base={},incoming={}){
  const out=structuredClone(base??{});
  if(incoming.business_assessment){
    const old=out.business_assessment??{},inc=incoming.business_assessment,e=new Map();
    for(const x of [...(old.evidence??[]),...(inc.evidence??[])])e.set((x.url??"")+"|"+(x.fact??""),x);
    out.business_assessment={...old,...inc,evidence:[...e.values()]};
  }
  if(incoming.metric_observations)out.metric_observations=mergeMetrics(out.metric_observations??[],incoming.metric_observations);
  if(incoming.sources)out.sources=mergeSources(out.sources??[],incoming.sources);
  return out;
}
