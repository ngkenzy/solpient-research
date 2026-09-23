import fs from "node:fs/promises";
import path from "node:path";
import {
  closePostgresPool,
  pgQuery,
  postgresConfigured,
} from "../lib/postgres-node.mjs";

if(!postgresConfigured()){
  throw new Error("SOLPIENT_DATABASE_URL is not configured.");
}

const migration=path.resolve(
  "supabase/migrations/20260923143000_solpient_100_daily_scores_v1.sql"
);

try{
  const sql=await fs.readFile(migration,"utf8");
  await pgQuery(sql);
  const rows=await pgQuery(
    "select to_regclass('public.solpient_100_daily_scores') as relation"
  );
  if(!rows[0]?.relation){
    throw new Error("Daily score table was not created.");
  }
  console.log(JSON.stringify({
    applied:true,
    migration,
    relation:rows[0].relation,
  },null,2));
}finally{
  await closePostgresPool();
}
