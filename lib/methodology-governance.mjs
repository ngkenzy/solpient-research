import { canonicalSha256 } from "./integrity-hash.mjs";

export const METHODOLOGY_REGISTRY_VERSION="methodology-registry-v1";

export const LIFECYCLE=Object.freeze({
  REGISTERED:"registered",
  CANDIDATE:"candidate",
  VALIDATED:"validated",
  ACTIVE:"active",
  BLOCKED:"blocked",
  DEPRECATED:"deprecated",
  SUPERSEDED:"superseded",
  RETIRED:"retired",
});

export const RISK_CLASS=Object.freeze({
  LOW:"low",
  MODERATE:"moderate",
  HIGH:"high",
  CRITICAL:"critical",
});

const ALLOWED_CATEGORIES=new Set([
  "integrity","research_composition","context","coverage","valuation",
  "ranking","readiness","prediction","calibration","screening","repair",
  "portfolio","governance"
]);
const ALLOWED_RISKS=new Set(Object.values(RISK_CLASS));
const VERSION_RE=/^[a-z0-9][a-z0-9._-]*-v\d+(?:\.\d+){0,2}$/;

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function arr(v){return Array.isArray(v)?v:[];}
function obj(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}

export function normalizeManifest(input={}){
  const m={
    methodology_key:String(input.methodology_key??"").trim(),
    version:String(input.version??"").trim(),
    name:String(input.name??"").trim(),
    category:String(input.category??"").trim(),
    risk_class:String(input.risk_class??"moderate").trim(),
    purpose:String(input.purpose??"").trim(),
    owner:String(input.owner??"Solpient").trim(),
    source_files:[...new Set(arr(input.source_files).map(String).filter(Boolean))].sort(),
    input_contract:obj(input.input_contract),
    output_contract:obj(input.output_contract),
    weights:obj(input.weights),
    thresholds:obj(input.thresholds),
    assumptions:obj(input.assumptions),
    dependencies:arr(input.dependencies).map(d=>({
      methodology_key:String(d?.methodology_key??"").trim(),
      version:String(d?.version??"").trim(),
      required:d?.required!==false,
    })).filter(d=>d.methodology_key&&d.version)
      .sort((a,b)=>(a.methodology_key+"|"+a.version).localeCompare(b.methodology_key+"|"+b.version)),
    known_limitations:arr(input.known_limitations).map(String).filter(Boolean),
    change_summary:String(input.change_summary??"").trim(),
    predecessor_version:input.predecessor_version?String(input.predecessor_version).trim():null,
    impacts:{
      database:Boolean(input.impacts?.database),
      public_ui:Boolean(input.impacts?.public_ui),
      publication:Boolean(input.impacts?.publication),
      ranking:Boolean(input.impacts?.ranking),
      capital_decision:Boolean(input.impacts?.capital_decision),
      historical_interpretation:Boolean(input.impacts?.historical_interpretation),
    },
    legacy_bootstrap:Boolean(input.legacy_bootstrap),
  };
  return m;
}

export function validateManifest(input={}){
  const m=normalizeManifest(input);
  const errors=[];
  const warnings=[];
  if(!m.methodology_key)errors.push("methodology_key is required.");
  if(!m.version)errors.push("version is required.");
  else if(!VERSION_RE.test(m.version))errors.push("version must match <name>-vN or <name>-vN.N style.");
  if(!m.name)errors.push("name is required.");
  if(!ALLOWED_CATEGORIES.has(m.category))errors.push("category is not recognized.");
  if(!ALLOWED_RISKS.has(m.risk_class))errors.push("risk_class is not recognized.");
  if(m.purpose.length<20)errors.push("purpose must explain the methodology in at least 20 characters.");
  if(!m.source_files.length)errors.push("at least one source_file is required.");
  if(!m.change_summary)warnings.push("change_summary is empty.");
  if(!m.known_limitations.length)warnings.push("known_limitations is empty.");
  if(m.predecessor_version===m.version)errors.push("predecessor_version cannot equal version.");
  for(const d of m.dependencies){
    if(d.methodology_key===m.methodology_key&&d.version===m.version){
      errors.push("a methodology cannot depend on itself.");
    }
  }
  return{valid:errors.length===0,errors,warnings,manifest:m};
}

export function manifestHash(input={}){
  const v=validateManifest(input);
  if(!v.valid)throw new Error("Invalid methodology manifest: "+v.errors.join(" "));
  return canonicalSha256({
    registry_version:METHODOLOGY_REGISTRY_VERSION,
    manifest:v.manifest,
  });
}

export function requiredValidations(input={}){
  const {manifest:m}=validateManifest(input);
  const required=new Set(["unit_tests","build"]);
  if(m.impacts.database)required.add("db_invariant");
  if(m.impacts.publication||m.impacts.historical_interpretation)required.add("historical_integrity");
  if(m.impacts.capital_decision||m.risk_class===RISK_CLASS.CRITICAL)required.add("manual_review");
  if(["valuation","ranking","prediction","calibration","screening"].includes(m.category)){
    required.add("methodology_regression");
  }
  return[...required].sort();
}

export function assessActivationReadiness(input={},validations=[]){
  const validation=validateManifest(input);
  if(!validation.valid)return{
    ready:false,
    manifestErrors:validation.errors,
    required:[],
    passed:[],
    waived:[],
    failed:[],
    missing:[],
  };
  const required=requiredValidations(validation.manifest);
  const latest=new Map();
  for(const row of validations){
    const type=String(row?.validation_type??"");
    if(!type)continue;
    const ts=String(row?.validated_at??row?.created_at??"");
    const prior=latest.get(type);
    if(!prior||ts>=String(prior.validated_at??prior.created_at??""))latest.set(type,row);
  }
  const passed=[],waived=[],failed=[],missing=[];
  for(const type of required){
    const row=latest.get(type);
    if(!row)missing.push(type);
    else if(row.status==="pass")passed.push(type);
    else if(row.status==="waived")waived.push(type);
    else failed.push(type);
  }
  const criticalWaiver=validation.manifest.risk_class===RISK_CLASS.CRITICAL&&waived.length>0;
  return{
    ready:failed.length===0&&missing.length===0&&!criticalWaiver,
    manifestErrors:[],
    required,passed,waived,failed,missing,
    criticalWaiverBlocked:criticalWaiver,
  };
}

export function deriveLifecycle(events=[]){
  const ordered=[...events].sort((a,b)=>{
    const t=String(a.effective_at??a.created_at??"").localeCompare(String(b.effective_at??b.created_at??""));
    if(t!==0)return t;
    return String(a.id??"").localeCompare(String(b.id??""));
  });
  let state=LIFECYCLE.REGISTERED;
  for(const e of ordered){
    if(Object.values(LIFECYCLE).includes(e.event_type))state=e.event_type;
  }
  return state;
}

export function canTransition(from,to){
  const allowed={
    registered:new Set(["candidate","active","blocked","retired"]),
    candidate:new Set(["validated","blocked","retired"]),
    validated:new Set(["active","blocked","retired"]),
    active:new Set(["deprecated","superseded","retired","blocked"]),
    blocked:new Set(["candidate","validated","active","retired"]),
    deprecated:new Set(["superseded","retired","active"]),
    superseded:new Set(["retired"]),
    retired:new Set([]),
  };
  return allowed[from]?.has(to)??false;
}

function stableString(v){return JSON.stringify(v??null);}

export function diffMethodologies(previousInput={},nextInput={}){
  const prev=normalizeManifest(previousInput),next=normalizeManifest(nextInput);
  const changes=[];
  const compare=(field,materiality)=>{
    if(stableString(prev[field])!==stableString(next[field])){
      changes.push({field,materiality,before:clone(prev[field]),after:clone(next[field])});
    }
  };
  compare("input_contract","major");
  compare("output_contract","major");
  compare("weights","major");
  compare("thresholds","major");
  compare("assumptions","major");
  compare("dependencies","major");
  compare("impacts","major");
  compare("known_limitations","minor");
  compare("source_files","minor");
  compare("purpose","minor");
  compare("name","patch");
  compare("owner","patch");
  compare("change_summary","patch");

  const levels={none:0,patch:1,minor:2,major:3};
  let highest="none";
  for(const c of changes)if(levels[c.materiality]>levels[highest])highest=c.materiality;
  return{
    changed:changes.length>0,
    materiality:highest,
    changes,
    requiresNewVersion:["major","minor"].includes(highest),
  };
}

export function validateCatalog(catalog=[]){
  const errors=[];
  const warnings=[];
  const seenVersion=new Set();
  const byKey=new Map();
  const normalized=[];

  for(const [index,entry] of catalog.entries()){
    const v=validateManifest(entry);
    if(!v.valid){
      errors.push(...v.errors.map(e=>"entry "+(index+1)+": "+e));
      continue;
    }
    warnings.push(...v.warnings.map(w=>v.manifest.version+": "+w));
    const identity=v.manifest.methodology_key+"|"+v.manifest.version;
    if(seenVersion.has(identity))errors.push("duplicate methodology identity "+identity);
    seenVersion.add(identity);
    normalized.push(v.manifest);
    const list=byKey.get(v.manifest.methodology_key)??[];
    list.push(v.manifest);
    byKey.set(v.manifest.methodology_key,list);
  }

  const available=new Set(normalized.map(m=>m.methodology_key+"|"+m.version));
  for(const m of normalized){
    for(const dep of m.dependencies){
      if(dep.required&&!available.has(dep.methodology_key+"|"+dep.version)){
        warnings.push(m.version+" requires dependency not present in this catalog: "+dep.methodology_key+"|"+dep.version);
      }
    }
    if(m.predecessor_version){
      const predecessor=m.methodology_key+"|"+m.predecessor_version;
      if(!available.has(predecessor)){
        warnings.push(m.version+" predecessor is not present in this catalog: "+predecessor);
      }
    }
  }

  return{valid:errors.length===0,errors,warnings,manifests:normalized};
}

export function registrySummary(definitions=[],events=[],validations=[]){
  const eventsByDef=new Map(),validationsByDef=new Map();
  for(const e of events){
    const list=eventsByDef.get(e.methodology_definition_id)??[];
    list.push(e);eventsByDef.set(e.methodology_definition_id,list);
  }
  for(const v of validations){
    const list=validationsByDef.get(v.methodology_definition_id)??[];
    list.push(v);validationsByDef.set(v.methodology_definition_id,list);
  }
  const rows=definitions.map(d=>{
    const state=deriveLifecycle(eventsByDef.get(d.id)??[]);
    const readiness=assessActivationReadiness(d.manifest??d,validationsByDef.get(d.id)??[]);
    return{...d,lifecycle_state:state,activation_readiness:readiness};
  });
  return{
    total:rows.length,
    active:rows.filter(r=>r.lifecycle_state==="active").length,
    candidate:rows.filter(r=>["candidate","validated"].includes(r.lifecycle_state)).length,
    blocked:rows.filter(r=>r.lifecycle_state==="blocked").length,
    legacy_active:rows.filter(r=>r.lifecycle_state==="active"&&Boolean(r.legacy_bootstrap??r.manifest?.legacy_bootstrap)).length,
    rows,
  };
}
