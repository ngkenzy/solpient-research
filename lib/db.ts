import "server-only";

import { Pool, type QueryResultRow } from "pg";

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
