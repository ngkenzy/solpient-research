import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  assessActivationReadiness,
  canTransition,
  deriveLifecycle,
} from "../lib/methodology-governance.mjs";

function arg(name,fallback=null){
  const prefix="--"+name+"=";
  const hit=process.argv.find(x=>x.startsWith(prefix));
  return hit?hit.slice(prefix.length):fallback;
}
const key=arg("key");
const version=arg("version");
const event=arg("event");
const validationType=arg("validation-type");
const validationStatus=arg("validation-status");
const reason=arg("reason","");
const evidenceRef=arg("evidence-ref");
const commitSha=arg("commit-sha",process.env.GITHUB_SHA??null);
const actor=arg("actor",process.env.GITHUB_ACTOR??"methodology-governance-cli");

if(!key||!version)throw new Error("Provide --key=<methodology_key> and --version=<version>.");
if(Boolean(event)===Boolean(validationType)){
  throw new Error("Choose exactly one action: --event=<lifecycle> OR --validation-type=<type>.");
}

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const {data:def,error:defError}=await sb.from("methodology_definitions")
  .select("*")
  .eq("methodology_key",key)
  .eq("version",version)
  .maybeSingle();
if(defError)throw defError;
if(!def)throw new Error("Methodology is not registered: "+key+" "+version);

if(validationType){
  if(!["pass","fail","waived"].includes(validationStatus)){
    throw new Error("--validation-status must be pass, fail, or waived.");
  }
  if(validationStatus==="waived"&&!reason){
    throw new Error("A waived validation requires --reason.");
  }
  const {data,error}=await sb.from("methodology_validation_runs").insert({
    methodology_definition_id:def.id,
    validation_type:validationType,
    status:validationStatus,
    validator:actor,
    commit_sha:commitSha,
    evidence_ref:evidenceRef,
    details:{reason:reason||null},
  }).select("id,validation_type,status,validated_at").single();
  if(error)throw error;
  console.log(JSON.stringify({recorded_validation:data},null,2));
  process.exit(0);
}

const {data:events,error:eventsError}=await sb.from("methodology_lifecycle_events")
  .select("*")
  .eq("methodology_definition_id",def.id)
  .order("effective_at",{ascending:true})
  .order("created_at",{ascending:true});
if(eventsError)throw eventsError;

const current=deriveLifecycle(events??[]);
if(current===event){
  console.log(JSON.stringify({skipped:true,reason:"already_in_state",state:current},null,2));
  process.exit(0);
}
if(!canTransition(current,event)){
  throw new Error("Invalid methodology lifecycle transition: "+current+" -> "+event);
}
if(!reason)throw new Error("Lifecycle changes require --reason.");

const {data:validations,error:validationError}=await sb.from("methodology_validation_runs")
  .select("*")
  .eq("methodology_definition_id",def.id)
  .order("validated_at",{ascending:true});
if(validationError)throw validationError;

const readiness=assessActivationReadiness(def.manifest??def,validations??[]);
if(["validated","active"].includes(event)&&!readiness.ready){
  throw new Error(
    "Methodology is not activation-ready. Missing: "+readiness.missing.join(", ")+
    (readiness.failed.length?" Failed: "+readiness.failed.join(", "):"")+
    (readiness.criticalWaiverBlocked?" Critical methodologies cannot activate with waived required checks.":"")
  );
}

const {data:created,error:createError}=await sb.from("methodology_lifecycle_events").insert({
  methodology_definition_id:def.id,
  event_type:event,
  reason,
  actor,
  commit_sha:commitSha,
  metadata:{
    prior_state:current,
    activation_readiness:readiness,
  },
}).select("id,event_type,effective_at").single();
if(createError)throw createError;

console.log(JSON.stringify({
  methodology_key:key,
  version,
  prior_state:current,
  new_state:event,
  event:created,
  activation_readiness:readiness,
},null,2));
