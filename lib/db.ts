import "server-only";

import { Pool, types, type QueryResultRow } from "pg";

// node-postgres normally converts PostgreSQL date/time values to JavaScript Date
// objects. Solpient's existing read models were built against PostgREST/Supabase,
// which returns these fields as strings. Preserve that contract during migration
// so code such as value.slice(0, 10) keeps receiving YYYY-MM-DD text.
types.setTypeParser(1082, (value) => value); // date
types.setTypeParser(1114, (value) => value.replace(" ", "T")); // timestamp
types.setTypeParser(1184, (value) => value.replace(" ", "T")); // timestamptz

declare global {
  // Reuse the pool across Next.js hot reloads in development.
  // eslint-disable-next-line no-var
  var __solpientPostgresPool: Pool | undefined;
}

function connectionString() {
  return process.env.SOLPIENT_DATABASE_URL?.trim() || null;
}

export function databaseConfigured() {
  return Boolean(connectionString());
}

export function getDbPool() {
  const url = connectionString();
  if (!url) return null;

  if (!globalThis.__solpientPostgresPool) {
    globalThis.__solpientPostgresPool = new Pool({
      connectionString: url,
      max: Number(process.env.SOLPIENT_DB_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: "solpient-next",
    });
  }

  return globalThis.__solpientPostgresPool;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const pool = getDbPool();
  if (!pool) {
    throw new Error("SOLPIENT_DATABASE_URL is not configured.");
  }

  const result = await pool.query<T>(sql, values);
  return result.rows;
}
