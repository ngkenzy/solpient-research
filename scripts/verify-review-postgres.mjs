import { closePostgresPool, pgMaybeOne, postgresConfigured } from "../lib/postgres-node.mjs";

if(!postgresConfigured()){
  throw new Error("SOLPIENT_DATABASE_URL is not configured. Run npm run local:configure-app first.");
}

try{
  const row=await pgMaybeOne(`
    select
      current_user as db_user,
      has_table_privilege(current_user,'public.baseline_drafts','SELECT,UPDATE') as baseline_drafts_rw,
      has_table_privilege(current_user,'public.baseline_reviews','SELECT,INSERT,UPDATE') as baseline_reviews_rw,
      has_table_privilege(current_user,'public.baseline_enrichment_items','SELECT,UPDATE') as enrichment_items_rw,
      has_table_privilege(current_user,'public.baseline_enrichment_runs','SELECT,UPDATE') as enrichment_runs_rw,
      has_table_privilege(current_user,'public.research_compositions','SELECT,UPDATE') as compositions_rw,
      (select count(*)::int from public.baseline_drafts) as drafts,
      (select count(*)::int from public.baseline_reviews) as reviews,
      (select count(*)::int from public.research_compositions) as compositions
  `);

  const privileges=[
    row.baseline_drafts_rw,
    row.baseline_reviews_rw,
    row.enrichment_items_rw,
    row.enrichment_runs_rw,
    row.compositions_rw,
  ];

  console.log(JSON.stringify({
    ok:privileges.every(Boolean),
    mode:"postgres",
    connection_source:"project-.env.local",
    ...row,
  },null,2));

  if(!privileges.every(Boolean))process.exitCode=1;
}finally{
  await closePostgresPool();
}
