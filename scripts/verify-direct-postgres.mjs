import { closePostgresPool, pgMaybeOne, postgresConfigured } from "../lib/postgres-node.mjs";

if(!postgresConfigured()){
  throw new Error("SOLPIENT_DATABASE_URL is not configured. Run npm run local:configure-app first.");
}

try{
  const row=await pgMaybeOne(`
    select
      current_database() as database,
      current_user as database_user,
      now() as timestamp_sample,
      (select count(*)::int from public.companies) as companies,
      (select count(*)::int from public.normalized_facts) as normalized_facts,
      (select count(*)::int from public.market_snapshots) as market_snapshots
  `);

  const timestampParseable=Number.isFinite(Date.parse(row?.timestamp_sample??""));
  if(!timestampParseable){
    throw new Error("PostgreSQL timestamptz parser is not JavaScript-compatible: "+row?.timestamp_sample);
  }

  console.log(JSON.stringify({
    ok:true,
    connection_source:"project-.env.local",
    timestamp_parseable:true,
    ...row,
  },null,2));
}finally{
  await closePostgresPool();
}
