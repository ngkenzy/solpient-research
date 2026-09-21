import fs from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  METHODOLOGY_REGISTRY_VERSION,
  validateCatalog,
  manifestHash,
} from "../lib/methodology-governance.mjs";

const dryRun=process.argv.includes("--dry-run");
const catalogPath=process.env.METHODOLOGY_CATALOG_PATH??"methodologies/catalog.json";
const catalog=JSON.parse(fs.readFileSync(catalogPath,"utf8"));
const validation=validateCatalog(catalog.methodologies??[]);
if(!validation.valid)throw new Error("Invalid methodology catalog:\n"+validation.errors.join("\n"));

const preview=validation.manifests.map(m=>({
  methodology_key:m.methodology_key,
  version:m.version,
  category:m.category,
  risk_class:m.risk_class,
  legacy_bootstrap:m.legacy_bootstrap,
  manifest_hash:manifestHash(m),
}));

if(dryRun){
  console.log(JSON.stringify({
    registry_version:METHODOLOGY_REGISTRY_VERSION,
    valid:true,
    warnings:validation.warnings,
    methodologies:preview,
  },null,2));
  process.exit(0);
}

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

let insertedDefinitions=0,insertedEvents=0;
for(const m of validation.manifests){
  const hash=manifestHash(m);
  const {data:existing,error:existingError}=await sb.from("methodology_definitions")
    .select("id,manifest_hash,legacy_bootstrap")
    .eq("methodology_key",m.methodology_key)
    .eq("version",m.version)
    .maybeSingle();
  if(existingError)throw existingError;

  let definition=existing;
  if(existing&&existing.manifest_hash!==hash){
    throw new Error(
      "Methodology "+m.methodology_key+" "+m.version+
      " already exists with a different manifest hash. Create a new version instead of mutating it."
    );
  }

  if(!definition){
    const {data,error}=await sb.from("methodology_definitions").insert({
      methodology_key:m.methodology_key,
      version:m.version,
      name:m.name,
      category:m.category,
      risk_class:m.risk_class,
      purpose:m.purpose,
      owner:m.owner,
      source_files:m.source_files,
      input_contract:m.input_contract,
      output_contract:m.output_contract,
      weights:m.weights,
      thresholds:m.thresholds,
      assumptions:m.assumptions,
      dependencies:m.dependencies,
      known_limitations:m.known_limitations,
      change_summary:m.change_summary,
      predecessor_version:m.predecessor_version,
      impacts:m.impacts,
      legacy_bootstrap:m.legacy_bootstrap,
      registry_version:METHODOLOGY_REGISTRY_VERSION,
      manifest:m,
      manifest_hash:hash,
    }).select("id,manifest_hash,legacy_bootstrap").single();
    if(error)throw error;
    definition=data;
    insertedDefinitions+=1;
  }

  const {data:events,error:eventsError}=await sb.from("methodology_lifecycle_events")
    .select("id,event_type,metadata")
    .eq("methodology_definition_id",definition.id)
    .order("effective_at",{ascending:true});
  if(eventsError)throw eventsError;

  if(!(events??[]).some(e=>e.event_type==="registered")){
    const {error}=await sb.from("methodology_lifecycle_events").insert({
      methodology_definition_id:definition.id,
      event_type:"registered",
      reason:"Imported into Methodology Registry V1.",
      actor:"methodology-registry-bootstrap",
      metadata:{registry_version:METHODOLOGY_REGISTRY_VERSION},
    });
    if(error)throw error;
    insertedEvents+=1;
  }

  if(m.legacy_bootstrap&&!(events??[]).some(e=>e.event_type==="active")){
    const {error}=await sb.from("methodology_lifecycle_events").insert({
      methodology_definition_id:definition.id,
      event_type:"active",
      reason:"Legacy production methodology imported as the current baseline. This event does not imply retroactive compliance with Methodology Registry V1 activation gates.",
      actor:"methodology-registry-bootstrap",
      metadata:{legacy_bootstrap:true,retroactive_validation:false},
    });
    if(error)throw error;
    insertedEvents+=1;
  }
}

console.log(JSON.stringify({
  registry_version:METHODOLOGY_REGISTRY_VERSION,
  catalog_entries:validation.manifests.length,
  inserted_definitions:insertedDefinitions,
  inserted_lifecycle_events:insertedEvents,
  warnings:validation.warnings,
},null,2));
