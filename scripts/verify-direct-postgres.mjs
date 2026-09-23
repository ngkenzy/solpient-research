import { closePostgresPool, pgMaybeOne, postgresConfigured } from "../lib/postgres-node.mjs";

if(!postgresConfigured()){
  throw new Error("SOLPIENT_DATABASE_URL is not configured. Run npm run local:configure-app first.");
}

try{
  const row=await pgMaybeOne(`
    select
      current_database() as database,
      current_user as database_user,
      (select count(*)::int from public.companies) as companies,
      (select count(*)::int from public.normalized_facts) as normalized_facts,
      (select count(*)::int from public.market_snapshots) as market_snapshots
  `);

  console.log(JSON.stringify({
    ok:true,
    connection_source:"project-.env.local",
    ...row,
  },null,2));
}finally{
  await closePostgresPool();
}
