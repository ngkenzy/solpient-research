import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  UNIVERSE_METHOD_STACK,
  METHODOLOGY_ACTIVATION_VERSION,
  buildMethodologyValidationBundle,
  methodologyStackStatus,
  activationReadinessForStack,
  requiredValidationEvidence,
} from "../lib/methodology-activation-v1.mjs";
import { deriveLifecycle, canTransition } from "../lib/methodology-governance.mjs";

function arg(name,fallback=null){
  const prefix="--"+name+"=";
  const hit=process.argv.find(x=>x.startsWith(prefix));
  return hit?hit.slice(prefix.length):fallback;
}
const has=(flag)=>process.argv.includes("--"+flag);
const inputPath=arg("input",process.env.UNIVERSE_INPUT_PATH??null);
const outputPath=arg("output",null);
const limit=Math.max(1,Number(arg("limit","100"))||100);
const minInputCount=Math.max(1,Number(arg("min-input-count","1000"))||1000);
const commitSha=arg("commit-sha",process.env.GITHUB_SHA??(()=>{
  try{return execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();}
  catch{return null;}
})());
const actor=arg("actor",process.env.GITHUB_ACTOR??"methodology-validation-activation-v1");
const dbInvariantEvidence=arg("db-invariant-evidence",null);
const activate=has("activate");
const acknowledgeReviewItems=has("acknowledge-review-items");
const acknowledgeClassificationReviewQueue=has("acknowledge-classification-review-queue");
const approveManualReview=has("approve-manual-review");

if(!inputPath)throw new Error("Provide --input=/path/to/full-universe.json.");

function parse(filePath){
  const raw=fs.readFileSync(filePath,"utf8");
  const ext=path.extname(filePath).toLowerCase();
  if(ext===".jsonl"||ext===".ndjson"){
    return raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(JSON.parse);
  }
  const parsed=JSON.parse(raw);
  if(Array.isArray(parsed))return parsed;
  if(Array.isArray(parsed.securities))return parsed.securities;
  throw new Error("Universe input must be an array, JSONL/NDJSON, or object with securities.");
}

const rows=parse(inputPath);
const bundle=buildMethodologyValidationBundle(rows,{
  limit,
  acknowledgeReviewItems,
  acknowledgeClassificationReviewQueue,
  minInputCount,
});

bundle.commit_sha=commitSha;
bundle.actor=actor;
bundle.manual_review_approved=approveManualReview;
bundle.activation_requested=activate;

if(outputPath){
  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  fs.writeFileSync(outputPath,JSON.stringify(bundle,null,2)+"\n");
}

if(!activate){
  console.log(JSON.stringify({
    activation_version:METHODOLOGY_ACTIVATION_VERSION,
    mode:"validation_preview",
    ready:bundle.ready,
    validation_hash:bundle.validation_hash,
    input_count:bundle.input_count,
    shortlist_count:bundle.shortlist_count,
    qa_status:bundle.qa_status,
    qa_blockers:bundle.qa_blockers,
    qa_review_items:bundle.qa_review_items,
    classification:{
      review_required_count:bundle.classification.review_required_count,
      unresolved_count:bundle.classification.unresolved_count,
      obvious_unknown_count:bundle.classification.obvious_unknown_count,
    },
    acceptance:bundle.acceptance,
    blocking_reasons:bundle.blocking_reasons,
    output:outputPath,
  },null,2));
  process.exit(bundle.ready?0:2);
}

if(!bundle.ready)throw new Error(
  "Full-universe validation bundle is not activation-ready: "+bundle.blocking_reasons.join(" ")
);
if(!approveManualReview)throw new Error(
  "Activation requires --approve-manual-review for the capital-decision candidate pipeline."
);
if(!dbInvariantEvidence)throw new Error(
  "Activation requires --db-invariant-evidence=<reference> from a live database invariant verification."
);

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
execFileSync(process.execPath,[path.join(root,"scripts/register-methodologies.mjs")],{
  cwd:root,stdio:"inherit",env:process.env,
});

const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

async function loadRegistry(){
  const {data:definitions,error:defError}=await sb.from("methodology_definitions")
    .select("*");
  if(defError)throw defError;
  const ids=(definitions??[]).map(x=>x.id);
  const {data:events,error:eventError}=ids.length
    ?await sb.from("methodology_lifecycle_events").select("*").in("methodology_definition_id",ids)
    :{data:[],error:null};
  if(eventError)throw eventError;
  const {data:validations,error:validationError}=ids.length
    ?await sb.from("methodology_validation_runs").select("*").in("methodology_definition_id",ids)
    :{data:[],error:null};
  if(validationError)throw validationError;
  return{definitions:definitions??[],events:events??[],validations:validations??[]};
}

let registry=await loadRegistry();
const stackStatus=methodologyStackStatus(registry.definitions,registry.events);
if(stackStatus.missing.length){
  throw new Error("Methodology registration failed for: "+stackStatus.missing.join(", "));
}

const evidenceByIdentity=requiredValidationEvidence(bundle);
for(const spec of UNIVERSE_METHOD_STACK){
  registry=await loadRegistry();
  const def=registry.definitions.find(d=>
    d.methodology_key===spec.methodology_key&&d.version===spec.version
  );
  if(!def)throw new Error("Registered definition not found: "+spec.methodology_key+" "+spec.version);

  for(const dependency of def.manifest?.dependencies??[]){
    if(dependency.required===false)continue;
    const exact=registry.definitions.find(d=>
      d.methodology_key===dependency.methodology_key&&d.version===dependency.version
    );
    if(!exact){
      throw new Error(
        "Required methodology dependency is not registered: "+
        dependency.methodology_key+" "+dependency.version
      );
    }
    if(dependency.methodology_key===spec.methodology_key)continue;
    const compatibleActive=registry.definitions
      .filter(d=>d.methodology_key===dependency.methodology_key)
      .some(d=>deriveLifecycle(
        registry.events.filter(e=>e.methodology_definition_id===d.id)
      )==="active");
    if(!compatibleActive){
      throw new Error(
        "Required methodology dependency has no active version: "+
        dependency.methodology_key
      );
    }
  }

  let state=deriveLifecycle(registry.events.filter(e=>e.methodology_definition_id===def.id));
  if(state==="registered"){
    const {error}=await sb.from("methodology_lifecycle_events").insert({
      methodology_definition_id:def.id,
      event_type:"candidate",
      reason:"Entered governed full-universe validation under "+METHODOLOGY_ACTIVATION_VERSION+".",
      actor,commit_sha:commitSha,
      metadata:{activation_version:METHODOLOGY_ACTIVATION_VERSION,validation_hash:bundle.validation_hash},
    });
    if(error)throw error;
    state="candidate";
  }
  if(!["candidate","validated","active"].includes(state)){
    throw new Error("Methodology cannot activate from lifecycle state "+state+": "+spec.methodology_key+" "+spec.version);
  }

  const requiredEvidence=evidenceByIdentity[spec.methodology_key+"|"+spec.version]??[];
  for(const evidence of requiredEvidence){
    const evidenceRef=evidence.validation_type==="db_invariant"
      ?dbInvariantEvidence
      :evidence.evidence_ref;
    registry=await loadRegistry();
    const existing=registry.validations.find(v=>
      v.methodology_definition_id===def.id&&
      v.validation_type===evidence.validation_type&&
      v.status==="pass"&&
      String(v.commit_sha??"")===String(commitSha??"")&&
      String(v.evidence_ref??"")===String(evidenceRef??"")
    );
    if(existing)continue;
    const {error}=await sb.from("methodology_validation_runs").insert({
      methodology_definition_id:def.id,
      validation_type:evidence.validation_type,
      status:"pass",
      validator:actor,
      commit_sha:commitSha,
      evidence_ref:evidenceRef,
      details:{
        activation_version:METHODOLOGY_ACTIVATION_VERSION,
        validation_hash:bundle.validation_hash,
        input_count:bundle.input_count,
        shortlist_count:bundle.shortlist_count,
        qa_status:bundle.qa_status,
        qa_blockers:bundle.qa_blockers,
        qa_review_items:bundle.qa_review_items,
        classification_review_required_count:bundle.classification.review_required_count,
        classification_unresolved_count:bundle.classification.unresolved_count,
        classification_obvious_unknown_count:bundle.classification.obvious_unknown_count,
      },
    });
    if(error)throw error;
  }

  registry=await loadRegistry();
  const readiness=activationReadinessForStack(
    [def],
    registry.events.filter(e=>e.methodology_definition_id===def.id),
    registry.validations.filter(v=>v.methodology_definition_id===def.id),
    [spec]
  ).rows[0]?.activation_readiness;
  if(!readiness?.ready){
    throw new Error(
      "Methodology is not activation-ready: "+spec.methodology_key+" "+spec.version+
      " missing="+(readiness?.missing??[]).join(",")+
      " failed="+(readiness?.failed??[]).join(",")
    );
  }

  registry=await loadRegistry();
  state=deriveLifecycle(registry.events.filter(e=>e.methodology_definition_id===def.id));
  if(state==="candidate"){
    if(!canTransition("candidate","validated"))throw new Error("Invalid candidate -> validated transition.");
    const {error}=await sb.from("methodology_lifecycle_events").insert({
      methodology_definition_id:def.id,
      event_type:"validated",
      reason:"All required validation gates passed under "+METHODOLOGY_ACTIVATION_VERSION+".",
      actor,commit_sha:commitSha,
      metadata:{validation_hash:bundle.validation_hash,activation_readiness:readiness},
    });
    if(error)throw error;
    state="validated";
  }
  if(state==="validated"){
    if(!canTransition("validated","active"))throw new Error("Invalid validated -> active transition.");
    const {error}=await sb.from("methodology_lifecycle_events").insert({
      methodology_definition_id:def.id,
      event_type:"active",
      reason:"Activated after full-universe validation under "+METHODOLOGY_ACTIVATION_VERSION+".",
      actor,commit_sha:commitSha,
      metadata:{validation_hash:bundle.validation_hash,activation_readiness:readiness},
    });
    if(error)throw error;
    state="active";
  }
  if(state!=="active")throw new Error(
    "Methodology did not reach active state: "+spec.methodology_key+" "+spec.version
  );

  registry=await loadRegistry();
  for(const prior of registry.definitions.filter(d=>
    d.methodology_key===spec.methodology_key&&d.id!==def.id
  )){
    const priorState=deriveLifecycle(
      registry.events.filter(e=>e.methodology_definition_id===prior.id)
    );
    if(priorState!=="active"||!canTransition("active","superseded"))continue;
    const {error}=await sb.from("methodology_lifecycle_events").insert({
      methodology_definition_id:prior.id,
      event_type:"superseded",
      reason:"Superseded by "+spec.version+" after governed full-universe validation.",
      actor,commit_sha:commitSha,
      metadata:{
        successor_version:spec.version,
        activation_version:METHODOLOGY_ACTIVATION_VERSION,
        validation_hash:bundle.validation_hash,
      },
    });
    if(error)throw error;
  }
}

registry=await loadRegistry();
const finalStatus=methodologyStackStatus(registry.definitions,registry.events);
if(!finalStatus.ready)throw new Error(
  "Activation completed incompletely: "+JSON.stringify(finalStatus)
);

console.log(JSON.stringify({
  activation_version:METHODOLOGY_ACTIVATION_VERSION,
  activated:true,
  validation_hash:bundle.validation_hash,
  input_count:bundle.input_count,
  shortlist_count:bundle.shortlist_count,
  qa_status:bundle.qa_status,
  qa_review_items:bundle.qa_review_items,
  classification_review_required_count:bundle.classification.review_required_count,
  methodology_stack:finalStatus.rows.map(x=>({
    methodology_key:x.methodology_key,
    version:x.version,
    lifecycle_state:x.lifecycle_state,
  })),
},null,2));
