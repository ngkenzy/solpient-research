import fs from "node:fs/promises";

const schemaPath=process.argv[2]??"production-public-schema.sql";
const migrationPath=process.argv[3]??"migration-list-before.txt";
const sql=await fs.readFile(schemaPath,"utf8");
const migrationText=await fs.readFile(migrationPath,"utf8");

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
const policies=[
  "service role manages research coverage states",
  "service role reads research coverage history",
  "service role inserts research coverage history",
  "service role reads research freshness policies",
  "service role manages research component freshness",
  "service role reads research dependency rules",
  "service role manages research component invalidations",
  "service role manages research maintenance queue",
  "service role manages research maintenance attempts",
];
const triggers=[
  "research_coverage_history_append_only_guard",
  "research_freshness_policies_append_only_guard",
  "research_dependency_rules_append_only_guard",
  "research_coverage_state_guard",
  "zz_normalized_facts_research_invalidation",
];
const functions=[
  "get_normalized_facts_as_of_v1",
  "record_research_component_check_v1",
  "evaluate_research_coverage_v1",
  "guard_research_coverage_state_v1",
  "refresh_research_coverage_v1",
  "refresh_research_foundation_state_v1",
  "invalidate_research_from_fact_v1",
  "enqueue_due_research_maintenance_v1",
  "claim_research_maintenance_batch_v1",
  "complete_research_maintenance_item_v1",
  "get_company_research_contract_v1",
  "get_research_foundation_operational_status_v1",
];

const has=(needle)=>sql.includes(needle);
const versions=["20260925090000","20260925090100","20260925090200","20260925090300"];
const history={};
for(const v of versions){
  const lines=migrationText.split(/\r?\n/).filter(line=>line.includes(v));
  history[v]=lines;
}

const report={
  generated_at:new Date().toISOString(),
  migration_history_lines:history,
  schema_presence:{
    tables:Object.fromEntries(tables.map(x=>[x,has(x)])),
    policies:Object.fromEntries(policies.map(x=>[x,has(x)])),
    triggers:Object.fromEntries(triggers.map(x=>[x,has(x)])),
    functions:Object.fromEntries(functions.map(x=>[x,has(x)])),
  },
};

const countTrue=(obj)=>Object.values(obj).filter(Boolean).length;
report.counts={
  tables:`${countTrue(report.schema_presence.tables)}/${tables.length}`,
  policies:`${countTrue(report.schema_presence.policies)}/${policies.length}`,
  triggers:`${countTrue(report.schema_presence.triggers)}/${triggers.length}`,
  functions:`${countTrue(report.schema_presence.functions)}/${functions.length}`,
};

const remoteApplied=Object.fromEntries(versions.map(v=>{
  const lines=history[v];
  const applied=lines.some(line=>{
    const clean=line.replace(/\x1b\[[0-9;]*m/g,"");
    const parts=clean.split("|").map(x=>x.trim().replaceAll(String.fromCharCode(96),""));
    return parts.length>=2 && parts[1]===v;
  });
  return [v,applied];
}));
report.remote_applied=remoteApplied;

let classification="UNKNOWN";
if(countTrue(report.schema_presence.tables)===8 &&
   countTrue(report.schema_presence.policies)===0 &&
   countTrue(report.schema_presence.triggers)===0 &&
   countTrue(report.schema_presence.functions)===0){
  classification="SCHEMA_TABLES_ONLY";
}else if(countTrue(report.schema_presence.tables)===8 &&
         countTrue(report.schema_presence.functions)<12){
  classification="PARTIAL_GROUP_A_SCHEMA";
}else if(countTrue(report.schema_presence.tables)===8 &&
         countTrue(report.schema_presence.policies)===9 &&
         countTrue(report.schema_presence.triggers)===5 &&
         countTrue(report.schema_presence.functions)===12){
  classification="GROUP_A_SCHEMA_COMPLETE";
}
report.classification=classification;

await fs.writeFile("group-a-schema-diagnosis.json",JSON.stringify(report,null,2)+"\n","utf8");
console.log(JSON.stringify(report,null,2));
