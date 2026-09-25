import fs from "node:fs/promises";
import process from "node:process";

const url=process.env.SUPABASE_URL?.trim();
const secret=process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if(!url||!secret) throw new Error("Missing SUPABASE_URL and server secret.");

const response=await fetch(url.replace(/\/$/,"")+"/rest/v1/",{
  headers:{
    apikey:secret,
    Authorization:"Bearer "+secret,
    Accept:"application/openapi+json",
  },
});
if(!response.ok){
  throw new Error(`PostgREST OpenAPI fetch failed: ${response.status} ${await response.text()}`);
}
const spec=await response.json();

const tables=[
  "research_coverage_states",
  "research_coverage_history",
  "research_freshness_policies",
  "research_component_freshness",
  "research_dependency_rules",
  "research_component_invalidations",
  "research_maintenance_queue",
  "research_maintenance_attempts",
];

const functions=[
  "get_normalized_facts_as_of_v1",
  "record_research_component_check_v1",
  "evaluate_research_coverage_v1",
  "refresh_research_coverage_v1",
  "refresh_research_foundation_state_v1",
  "enqueue_due_research_maintenance_v1",
  "claim_research_maintenance_batch_v1",
  "complete_research_maintenance_item_v1",
  "get_company_research_contract_v1",
  "get_research_foundation_operational_status_v1",
];

const definitions=spec.definitions??spec.components?.schemas??{};
const paths=spec.paths??{};
const out={
  captured_at:new Date().toISOString(),
  tables:{},
  functions:{},
};

for(const table of tables){
  const schema=definitions[table]??null;
  out.tables[table]=schema?{
    present:true,
    required:schema.required??[],
    columns:Object.keys(schema.properties??{}).sort(),
    properties:schema.properties??{},
  }:{present:false};
}

for(const fn of functions){
  const path="/rpc/"+fn;
  const entry=paths[path]??null;
  out.functions[fn]=entry?{
    present:true,
    methods:Object.keys(entry).filter(k=>["get","post"].includes(k)),
  }:{present:false};
}

const output=process.env.GROUP_A_OPENAPI_OUTPUT?.trim()||"group-a-postgrest-openapi.json";
await fs.writeFile(output,JSON.stringify(out,null,2)+"\n","utf8");
console.log(JSON.stringify(out,null,2));
