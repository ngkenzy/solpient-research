import fs from "node:fs/promises";
import process from "node:process";
import { pgQuery, pgMaybeOne, postgresConfigured } from "../lib/postgres-node.mjs";
import { createPostgresCompatClient } from "../lib/pg-supabase-compat.mjs";

if(!postgresConfigured())throw new Error("SOLPIENT_DATABASE_URL is not configured.");

const requiredFunctions=[
  "publish_reviewed_research_v2",
  "create_research_factory_run_v1",
  "transition_research_factory_item_v1",
  "publish_autonomous_valuation_pack_v2_1",
];
const requiredTables=[
  "companies",
  "baseline_drafts",
  "baseline_reviews",
  "research_compositions",
  "research_runs",
  "research_input_manifest_staging",
  "normalized_facts",
  "evidence_sources",
  "evidence_observations",
  "research_factory_runs",
  "research_factory_items",
  "research_factory_autonomous_runs",
  "research_factory_autonomous_decisions",
  "research_factory_industry_assignments",
  "research_factory_valuation_drafts",
  "automation_runs",
  "research_repair_jobs",
];

const workerFiles=[
  "scripts/assign-research-factory-industry-v2-1.mjs",
  "scripts/audit-capital-intelligence.mjs",
  "scripts/backfill-research-change-events.mjs",
  "scripts/build-autonomous-valuation-pack-v2-1.mjs",
  "scripts/build-baseline-draft.mjs",
  "scripts/build-company-change-events.mjs",
  "scripts/build-data-coverage.mjs",
  "scripts/build-decision-triggers.mjs",
  "scripts/build-historical-peer-context.mjs",
  "scripts/build-missing-baselines.mjs",
  "scripts/build-research-factory-valuation-drafts.mjs",
  "scripts/build-research-repair-queue.mjs",
  "scripts/compose-research-drafts.mjs",
  "scripts/enrich-baseline-draft.mjs",
  "scripts/export-pending-capital-coverage.mjs",
  "scripts/import-capital-coverage-batch.mjs",
  "scripts/import-capital-intelligence-batch.mjs",
  "scripts/import-research.mjs",
  "scripts/materialize-research-factory-v1.mjs",
  "scripts/onboard-research-factory-v1.mjs",
  "scripts/plan-research-updates.mjs",
  "scripts/process-research-repairs.mjs",
  "scripts/promote-baseline-review.mjs",
  "scripts/refresh-generated-baselines.mjs",
  "scripts/refresh-research-factory-v1.mjs",
  "scripts/run-autonomous-research-factory-v2-1.mjs",
  "scripts/run-research-factory-batch.mjs",
  "scripts/run-research-factory-expansion-v1-1.mjs",
  "scripts/sync-capital-intelligence.mjs",
  "scripts/sync-evidence-provenance.mjs",
  "scripts/sync-market-history.mjs",
  "scripts/sync-marketbeat-capital-intelligence.mjs",
  "scripts/sync-quiver-political-intelligence.mjs",
  "scripts/sync-sec-companyfacts-backfill.mjs",
  "scripts/sync-yahoo-capital-intelligence.mjs",
  "scripts/sync-yahoo-fundamentals-fallback.mjs",
  "scripts/validate-activate-universe-methodologies.mjs",
];

const functionRows=await pgQuery(
  `select distinct p.proname
   from pg_proc p
   join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=any($1::text[])`,
  [requiredFunctions],
);
const foundFunctions=new Set(functionRows.map((row)=>row.proname));
const missingFunctions=requiredFunctions.filter((name)=>!foundFunctions.has(name));

const tableRows=await pgQuery(
  `select table_name
   from information_schema.tables
   where table_schema='public' and table_name=any($1::text[])`,
  [requiredTables],
);
const foundTables=new Set(tableRows.map((row)=>row.table_name));
const missingTables=requiredTables.filter((name)=>!foundTables.has(name));

const dbInfo=await pgMaybeOne(`
  select
    current_database() as database_name,
    current_user as database_user,
    pg_size_pretty(pg_database_size(current_database())) as database_size,
    (select count(*)::int from public.companies) as companies,
    (select count(*)::int from public.baseline_drafts) as drafts,
    (select count(*)::int from public.research_runs) as research_runs,
    (select count(*)::int from public.normalized_facts) as normalized_facts
`);

const client=createPostgresCompatClient();
const smoke=await client
  .from("companies")
  .select("id,ticker,company_name")
  .order("ticker",{ascending:true})
  .limit(1)
  .maybeSingle();
if(smoke.error)throw new Error("PostgreSQL compatibility smoke query failed: "+smoke.error.message);

const forbidden=[
  "@supabase/supabase-js",
  "process.env.SUPABASE_URL",
  "process.env.SUPABASE_SERVICE_ROLE_KEY",
  "process.env.SUPABASE_SECRET_KEY",
];
const sourceProblems=[];
for(const file of workerFiles){
  const content=await fs.readFile(file,"utf8");
  for(const token of forbidden){
    if(content.includes(token))sourceProblems.push({file,token});
  }
  if(content.includes('SOLPIENT_DATABASE_URL.");\\n')){
    sourceProblems.push({file,token:"literal-backslash-n-in-initialization"});
  }
}

const privileges=await pgMaybeOne(`
  select
    has_table_privilege(current_user,'public.baseline_drafts','SELECT,INSERT,UPDATE') as baseline_drafts_rw,
    has_table_privilege(current_user,'public.baseline_reviews','SELECT,INSERT,UPDATE') as baseline_reviews_rw,
    has_table_privilege(current_user,'public.research_runs','SELECT,INSERT,UPDATE') as research_runs_rw,
    has_table_privilege(current_user,'public.normalized_facts','SELECT,INSERT,UPDATE') as normalized_facts_rw,
    has_table_privilege(current_user,'public.research_factory_items','SELECT,INSERT,UPDATE') as factory_items_rw
`);

const privilegeOk=Object.values(privileges??{}).every(Boolean);
const ok=!missingFunctions.length&&!missingTables.length&&!sourceProblems.length&&privilegeOk;

console.log(JSON.stringify({
  ok,
  phase:"3B",
  database:dbInfo,
  compatibility_smoke:smoke.data,
  functions:{required:requiredFunctions,missing:missingFunctions},
  tables:{required:requiredTables.length,missing:missingTables},
  privileges,
  migrated_worker_files:workerFiles.length,
  source_problems:sourceProblems,
  legacy_supabase_package_retained_for_phase4:true,
},null,2));

if(!ok)process.exitCode=1;
