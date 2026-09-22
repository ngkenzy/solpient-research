import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  UNIVERSE_METHOD_STACK,
  METHODOLOGY_ACTIVATION_VERSION,
  buildMethodologyValidationBundle,
  methodologyStackStatus,
  methodologyDependencyStatus,
  activationReadinessForStack,
  requiredValidationEvidence,
} from "../lib/methodology-activation-v1.mjs";
import {
  deriveLifecycle,
  canTransition,
  validateCatalog,
  manifestHash,
} from "../lib/methodology-governance.mjs";
import { buildMethodologyImplementationFingerprint } from "../lib/methodology-implementation-hash.mjs";

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
const actor=arg("actor",process.env.GITHUB_ACTOR??"methodology-validation-activation-v1.1");
const dbInvariantEvidence=arg("db-invariant-evidence",null);
const githubRepo=arg("github-repo",process.env.GITHUB_REPOSITORY??"ngkenzy/solpient-research");
const activate=has("activate");
const acknowledgeReviewItems=has("acknowledge-review-items");
const acknowledgeClassificationReviewQueue=has("acknowledge-classification-review-queue");
const approveManualReview=has("approve-manual-review");

const REQUIRED_CI_WORKFLOWS=Object.freeze([
  "SOLPIENT Build Check",
  "Methodology Registry Governance",
  "Universe QA V1",
  "Solpient 100 Universe Screening",
  "Research Candidate Pipeline",
]);

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

function git(command,args=[]){
  try{return execFileSync(command,args,{encoding:"utf8"}).trim();}
  catch{return null;}
}

function verifyLocalCommit(){
  if(!commitSha||!/^[0-9a-f]{40}$/i.test(commitSha)){
    throw new Error("Activation requires an exact 40-character --commit-sha or GITHUB_SHA.");
  }
  const head=git("git",["rev-parse","HEAD"]);
  if(head&&head!==commitSha){
    throw new Error("Activation commit SHA does not match checked-out HEAD. expected="+commitSha+" head="+head);
  }
  const unstaged=git("git",["diff","--name-only"]);
  const staged=git("git",["diff","--cached","--name-only"]);
  if(unstaged||staged){
    throw new Error(
      "Activation requires no tracked source changes so implementation hashes match the audited commit."
    );
  }
}

async function verifyGitHubCI(){
  if(!githubRepo||!/^[^/]+\/[^/]+$/.test(githubRepo)){
    throw new Error("Activation requires --github-repo=owner/repo.");
  }
  const headers={
    Accept:"application/vnd.github+json",
    "X-GitHub-Api-Version":"2022-11-28",
    "User-Agent":"solpient-methodology-activation-v1.1",
  };
  const token=process.env.GITHUB_TOKEN??process.env.GH_TOKEN??null;
  if(token)headers.Authorization="Bearer "+token;
  const endpoint=
    "https://api.github.com/repos/"+githubRepo+
    "/actions/runs?head_sha="+encodeURIComponent(commitSha)+"&per_page=100";
  let body=null;
  const response=await fetch(endpoint,{headers});
  if(response.ok){
    body=await response.json();
  }else if(!token){
    const ghBody=git("gh",[
      "api",
      "--method","GET",
      "repos/"+githubRepo+"/actions/runs",
      "-f","head_sha="+commitSha,
      "-f","per_page=100",
    ]);
    if(ghBody){
      try{body=JSON.parse(ghBody);}catch{}
    }
  }
  if(!body){
    throw new Error(
      "Unable to verify GitHub Actions for private repository "+githubRepo+
      " at "+commitSha+". Set GH_TOKEN/GITHUB_TOKEN or authenticate GitHub CLI with gh auth login."
    );
  }
  const runs=Array.isArray(body.workflow_runs)?body.workflow_runs:[];
  const selected=[];
  const missing=[];
  for(const workflowName of REQUIRED_CI_WORKFLOWS){
    const candidates=runs
      .filter(run=>run.name===workflowName)
      .sort((a,b)=>Number(b.run_attempt??1)-Number(a.run_attempt??1));
    const passed=candidates.find(run=>
      run.status==="completed"&&run.conclusion==="success"
    );
    if(!passed){
      missing.push(workflowName);
      continue;
    }
    selected.push({
      name:workflowName,
      run_id:passed.id,
      run_number:passed.run_number,
      html_url:passed.html_url,
      event:passed.event,
    });
  }
  if(missing.length){
    throw new Error(
      "Activation requires successful GitHub Actions for the exact commit. Missing/failed: "+
      missing.join(", ")
    );
  }
  return{
    repository:githubRepo,
    commit_sha:commitSha,
    workflows:selected,
    evidence_ref:
      "github-actions://"+githubRepo+"/commit/"+commitSha+
      "?runs="+selected.map(x=>x.run_id).join(","),
  };
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
    universe_input_hash:bundle.universe_input_hash,
    input_count:bundle.input_count,
    min_input_count:bundle.min_input_count,
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

verifyLocalCommit();
const ciEvidence=await verifyGitHubCI();

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");

const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const catalogPath=path.resolve("methodologies/catalog.json");
const catalog=JSON.parse(fs.readFileSync(catalogPath,"utf8"));
const catalogValidation=validateCatalog(catalog.methodologies??[]);
if(!catalogValidation.valid){
  throw new Error("Invalid methodology catalog: "+catalogValidation.errors.join(" "));
}
const catalogByIdentity=new Map(catalogValidation.manifests.map(m=>[
  m.methodology_key+"|"+m.version,m
]));
const targetIdentitySet=new Set(
  UNIVERSE_METHOD_STACK.map(x=>x.methodology_key+"|"+x.version)
);

function requiredCatalogManifests(){
  const required=new Map();
  const visit=(identity)=>{
    if(required.has(identity))return;
    const manifest=catalogByIdentity.get(identity);
    if(!manifest)throw new Error("Required methodology missing from catalog: "+identity);
    required.set(identity,manifest);
    for(const dep of manifest.dependencies??[]){
      if(dep.required!==false)visit(dep.methodology_key+"|"+dep.version);
    }
  };
  for(const spec of UNIVERSE_METHOD_STACK)visit(spec.methodology_key+"|"+spec.version);
  return [...required.values()];
}

const fingerprints=new Map(
  requiredCatalogManifests().map(manifest=>[
    manifest.methodology_key+"|"+manifest.version,
    buildMethodologyImplementationFingerprint(manifest),
  ])
);

async function registerMissingRequiredDefinitions(){
  for(const manifest of requiredCatalogManifests()){
    const identity=manifest.methodology_key+"|"+manifest.version;
    const implementation=fingerprints.get(identity);
    const {data:existing,error:existingError}=await sb.from("methodology_definitions")
      .select("id,methodology_key,version,manifest_hash,implementation_hash")
      .eq("methodology_key",manifest.methodology_key)
      .eq("version",manifest.version)
      .maybeSingle();
    if(existingError)throw existingError;

    let definition=existing;
    const expectedHash=manifestHash(manifest);
    if(existing&&targetIdentitySet.has(identity)&&existing.manifest_hash!==expectedHash){
      throw new Error(
        "Target methodology already exists with a different immutable manifest hash: "+identity
      );
    }
    if(existing&&targetIdentitySet.has(identity)&&
       existing.implementation_hash!==implementation.implementation_hash){
      throw new Error(
        "Target methodology already exists without the exact audited implementation hash: "+identity
      );
    }

    if(!definition){
      const {data,error}=await sb.from("methodology_definitions").insert({
        methodology_key:manifest.methodology_key,
        version:manifest.version,
        name:manifest.name,
        category:manifest.category,
        risk_class:manifest.risk_class,
        purpose:manifest.purpose,
        owner:manifest.owner,
        source_files:manifest.source_files,
        input_contract:manifest.input_contract,
        output_contract:manifest.output_contract,
        weights:manifest.weights,
        thresholds:manifest.thresholds,
        assumptions:manifest.assumptions,
        dependencies:manifest.dependencies,
        known_limitations:manifest.known_limitations,
        change_summary:manifest.change_summary,
        predecessor_version:manifest.predecessor_version,
        impacts:manifest.impacts,
        legacy_bootstrap:manifest.legacy_bootstrap,
        registry_version:catalog.registry_version??"methodology-registry-v1",
        manifest,
        manifest_hash:expectedHash,
        implementation_hash:implementation.implementation_hash,
      }).select("id,methodology_key,version,manifest_hash,implementation_hash").single();
      if(error)throw error;
      definition=data;
    }

    const {data:events,error:eventsError}=await sb.from("methodology_lifecycle_events")
      .select("id,event_type")
      .eq("methodology_definition_id",definition.id);
    if(eventsError)throw eventsError;
    if(!(events??[]).some(e=>e.event_type==="registered")){
      const {error}=await sb.from("methodology_lifecycle_events").insert({
        methodology_definition_id:definition.id,
        event_type:"registered",
        reason:"Registered by "+METHODOLOGY_ACTIVATION_VERSION+
          " as a required target/dependency version.",
        actor,
        commit_sha:commitSha,
        metadata:{
          activation_version:METHODOLOGY_ACTIVATION_VERSION,
          implementation_hash:implementation.implementation_hash,
        },
      });
      if(error)throw error;
    }
  }
}

await registerMissingRequiredDefinitions();

async function loadRegistry(){
  const {data:definitions,error:defError}=await sb.from("methodology_definitions").select("*");
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
const activationIdentities=new Set(
  UNIVERSE_METHOD_STACK.map(x=>x.methodology_key+"|"+x.version)
);

for(const spec of UNIVERSE_METHOD_STACK){
  registry=await loadRegistry();
  const identity=spec.methodology_key+"|"+spec.version;
  const def=registry.definitions.find(d=>
    d.methodology_key===spec.methodology_key&&d.version===spec.version
  );
  if(!def)throw new Error("Registered definition not found: "+identity);
  const implementation=fingerprints.get(identity);
  if(def.implementation_hash!==implementation.implementation_hash){
    throw new Error("Implementation hash drift detected for "+identity);
  }

  let state=deriveLifecycle(
    registry.events.filter(e=>e.methodology_definition_id===def.id)
  );
  if(state==="registered"){
    const {error}=await sb.from("methodology_lifecycle_events").insert({
      methodology_definition_id:def.id,
      event_type:"candidate",
      reason:"Entered governed full-universe validation under "+METHODOLOGY_ACTIVATION_VERSION+".",
      actor,
      commit_sha:commitSha,
      metadata:{
        activation_version:METHODOLOGY_ACTIVATION_VERSION,
        validation_hash:bundle.validation_hash,
        universe_input_hash:bundle.universe_input_hash,
        implementation_hash:implementation.implementation_hash,
      },
    });
    if(error)throw error;
    state="candidate";
  }
  if(!["candidate","validated","active"].includes(state)){
    throw new Error(
      "Methodology cannot validate from lifecycle state "+state+": "+identity
    );
  }

  registry=await loadRegistry();
  const dependencyStatus=methodologyDependencyStatus(
    registry.definitions,
    registry.events,
    def.manifest??def,
    {activationIdentities}
  );
  if(!dependencyStatus.ready){
    throw new Error(
      "Exact required methodology dependency is not satisfied for "+identity+
      ": "+JSON.stringify(dependencyStatus)
    );
  }

  const requiredEvidence=evidenceByIdentity[identity]??[];
  for(const evidence of requiredEvidence){
    let evidenceRef=evidence.evidence_ref;
    if(evidence.validation_type==="db_invariant")evidenceRef=dbInvariantEvidence;
    if(evidence.validation_type==="unit_tests"||evidence.validation_type==="build"){
      evidenceRef=ciEvidence.evidence_ref;
    }
    if(evidence.validation_type==="manual_review"){
      evidenceRef="manual-review://"+actor+"/"+commitSha;
    }

    registry=await loadRegistry();
    const existing=registry.validations.find(v=>
      v.methodology_definition_id===def.id&&
      v.validation_type===evidence.validation_type&&
      v.status==="pass"&&
      String(v.commit_sha??"")===String(commitSha)&&
      String(v.evidence_ref??"")===String(evidenceRef??"")&&
      String(v.details?.validation_hash??"")===bundle.validation_hash&&
      String(v.details?.universe_input_hash??"")===bundle.universe_input_hash&&
      String(v.details?.implementation_hash??"")===implementation.implementation_hash
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
        universe_input_hash:bundle.universe_input_hash,
        implementation_hash:implementation.implementation_hash,
        input_count:bundle.input_count,
        min_input_count:bundle.min_input_count,
        shortlist_count:bundle.shortlist_count,
        qa_status:bundle.qa_status,
        qa_blockers:bundle.qa_blockers,
        qa_review_items:bundle.qa_review_items,
        classification_review_required_count:bundle.classification.review_required_count,
        classification_unresolved_count:bundle.classification.unresolved_count,
        classification_obvious_unknown_count:bundle.classification.obvious_unknown_count,
        ci_workflows:ciEvidence.workflows,
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
      "Methodology is not activation-ready: "+identity+
      " missing="+(readiness?.missing??[]).join(",")+
      " failed="+(readiness?.failed??[]).join(",")
    );
  }

  registry=await loadRegistry();
  state=deriveLifecycle(
    registry.events.filter(e=>e.methodology_definition_id===def.id)
  );
  if(state==="candidate"){
    if(!canTransition("candidate","validated")){
      throw new Error("Invalid candidate -> validated transition.");
    }
    const {error}=await sb.from("methodology_lifecycle_events").insert({
      methodology_definition_id:def.id,
      event_type:"validated",
      reason:"All required validation gates passed under "+METHODOLOGY_ACTIVATION_VERSION+".",
      actor,
      commit_sha:commitSha,
      metadata:{
        validation_hash:bundle.validation_hash,
        universe_input_hash:bundle.universe_input_hash,
        implementation_hash:implementation.implementation_hash,
        activation_readiness:readiness,
        ci_evidence_ref:ciEvidence.evidence_ref,
      },
    });
    if(error)throw error;
  }
}

registry=await loadRegistry();
const targetDefinitions=UNIVERSE_METHOD_STACK.map(spec=>{
  const def=registry.definitions.find(d=>
    d.methodology_key===spec.methodology_key&&d.version===spec.version
  );
  if(!def)throw new Error("Target disappeared before atomic activation.");
  const state=deriveLifecycle(
    registry.events.filter(e=>e.methodology_definition_id===def.id)
  );
  if(!["validated","active"].includes(state)){
    throw new Error(
      "Atomic activation requires all targets validated first: "+
      spec.methodology_key+" "+spec.version+" state="+state
    );
  }
  return{
    definition_id:def.id,
    methodology_key:spec.methodology_key,
    version:spec.version,
  };
});

const {data:activationResult,error:activationError}=await sb.rpc(
  "activate_universe_methodology_stack_v1_1",
  {
    p_targets:targetDefinitions,
    p_validation_hash:bundle.validation_hash,
    p_universe_input_hash:bundle.universe_input_hash,
    p_activation_version:METHODOLOGY_ACTIVATION_VERSION,
    p_actor:actor,
    p_commit_sha:commitSha,
  }
);
if(activationError)throw activationError;

registry=await loadRegistry();
const finalStatus=methodologyStackStatus(registry.definitions,registry.events);
if(!finalStatus.ready){
  throw new Error("Atomic activation completed incompletely: "+JSON.stringify(finalStatus));
}
for(const row of finalStatus.rows){
  if(row.active_event?.metadata?.validation_hash!==bundle.validation_hash||
     row.active_event?.metadata?.universe_input_hash!==bundle.universe_input_hash||
     row.active_event?.metadata?.implementation_hash!==row.implementation_hash){
    throw new Error(
      "Active methodology is not cryptographically bound to the validated input/implementation: "+
      row.methodology_key+" "+row.version
    );
  }
}

console.log(JSON.stringify({
  activation_version:METHODOLOGY_ACTIVATION_VERSION,
  activated:true,
  atomic_activation:activationResult,
  validation_hash:bundle.validation_hash,
  universe_input_hash:bundle.universe_input_hash,
  input_count:bundle.input_count,
  min_input_count:bundle.min_input_count,
  shortlist_count:bundle.shortlist_count,
  qa_status:bundle.qa_status,
  qa_review_items:bundle.qa_review_items,
  classification_review_required_count:bundle.classification.review_required_count,
  ci_evidence:ciEvidence,
  methodology_stack:finalStatus.rows.map(x=>({
    methodology_key:x.methodology_key,
    version:x.version,
    lifecycle_state:x.lifecycle_state,
    implementation_hash:x.implementation_hash,
  })),
},null,2));
