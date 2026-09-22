import { Pool } from "pg";

const connectionString = process.env.SOLPIENT_DATABASE_URL;
if (!connectionString) {
  throw new Error("SOLPIENT_DATABASE_URL is not configured. Run npm run local:configure-app first.");
}

const pool = new Pool({ connectionString, max: 1 });

try {
  const { rows } = await pool.query(`
    select
      current_database() as database,
      (select count(*)::int from public.companies) as companies,
      (select count(*)::int from public.normalized_facts) as normalized_facts,
      (select count(*)::int from public.market_snapshots) as market_snapshots
  `);

  console.log(JSON.stringify({ ok: true, ...rows[0] }, null, 2));
} finally {
  await pool.end();
}
