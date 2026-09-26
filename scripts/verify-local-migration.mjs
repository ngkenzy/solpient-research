#!/usr/bin/env node
/**
 * verify-local-migration.mjs
 *
 * Verifies a completed Supabase -> local-Postgres migration by comparing
 * row counts table-by-table between the cloud (source) database and the
 * local Solpient-owned (target) database.
 *
 * Pair with:
 *   scripts/export-supabase-public.sh   (export schema + data from Supabase)
 *   scripts/restore-local-public.sh     (restore into local PostgreSQL)
 *
 * Schemas compared: public, private  (must match the `--schema public,private`
 * flag used by the export script).
 *
 * Connection strings (required in the environment):
 *   VERIFY_SOURCE_URL  - cloud Supabase Postgres connection string
 *                        (Database settings -> Connection string -> URI,
 *                        pooler or direct; never commit this value)
 *   VERIFY_TARGET_URL  - local Postgres connection string, e.g.
 *                        postgresql://solpient:<password>@127.0.0.1:55432/solpient
 *
 * If VERIFY_TARGET_URL is not set, the script falls back to building it from
 * the local stack config (SOLPIENT_DB_USER / SOLPIENT_DB_PASSWORD /
 * SOLPIENT_DB_NAME / SOLPIENT_DB_PORT in .env.local-stack at the repo root).
 * There is no fallback for VERIFY_SOURCE_URL.
 *
 * Exit codes:
 *   0 - every table matches on both sides (0 = 0 on empty tables is a PASS)
 *   1 - at least one table mismatches (count differs, or table missing/extra)
 *   2 - configuration or connection error
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// Schemas covered by scripts/export-supabase-public.sh (`--schema public,private`).
const SCHEMAS = ["public", "private"];

function fail(code, message) {
  console.error(`ERROR: ${message}`);
  process.exit(code);
}

const SOURCE_URL = process.env.VERIFY_SOURCE_URL;
const TARGET_URL = process.env.VERIFY_TARGET_URL ?? localStackUrl();

if (!SOURCE_URL) {
  fail(
    2,
    "VERIFY_SOURCE_URL is not set. Export the cloud Supabase Postgres connection\n" +
      "string (Database settings -> Connection string -> URI) as VERIFY_SOURCE_URL,\n" +
      "e.g.  VERIFY_SOURCE_URL='postgresql://postgres:***@db.<ref>.supabase.co:5432/postgres'\n" +
      "Do not commit this value anywhere."
  );
}
if (!TARGET_URL) {
  fail(
    2,
    "VERIFY_TARGET_URL is not set and no usable .env.local-stack was found.\n" +
      "Either set VERIFY_TARGET_URL, e.g.\n" +
      "  VERIFY_TARGET_URL='postgresql://solpient:<password>@127.0.0.1:55432/solpient'\n" +
      "or create .env.local-stack from .env.local-stack.example so the script\n" +
      "can build the local URL from SOLPIENT_DB_USER/SOLPIENT_DB_PASSWORD/\n" +
      "SOLPIENT_DB_NAME/SOLPIENT_DB_PORT."
  );
}

/**
 * Build a local Postgres URL from .env.local-stack at the repo root.
 * Returns null when the file (or required keys) is missing.
 */
function localStackUrl() {
  const envPath = path.resolve(process.cwd(), ".env.local-stack");
  if (!fs.existsSync(envPath)) return null;
  const vars = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const user = vars.SOLPIENT_DB_USER;
  const password = vars.SOLPIENT_DB_PASSWORD;
  const name = vars.SOLPIENT_DB_NAME;
  const port = vars.SOLPIENT_DB_PORT;
  if (!user || !password || !name || !port) return null;
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${encodeURIComponent(name)}`;
}

function redacted(url) {
  // Hide the password when echoing connection details.
  return url.replace(/:\/\/([^:@/]+):([^@/]*)@/, "://$1:****@");
}

async function listTables(pool) {
  const { rows } = await pool.query(
    `select table_schema as schema, table_name as name
       from information_schema.tables
      where table_schema = any($1)
        and table_type = 'BASE TABLE'
      order by 1, 2`,
    [SCHEMAS]
  );
  return rows.map((r) => ({ schema: r.schema, name: r.name, qualified: `${r.schema}.${r.name}` }));
}

function quoteIdent(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function countRows(pool, table) {
  const { rows } = await pool.query(
    `select count(*)::bigint as c from ${quoteIdent(table.schema)}.${quoteIdent(table.name)}`
  );
  return String(rows[0].c);
}

function pad(value, width) {
  const s = String(value);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

async function main() {
  // Dynamic import keeps the "set VERIFY_*_URL" error path dependency-free.
  let Pool;
  try {
    ({ Pool } = await import("pg"));
  } catch {
    fail(2, "the 'pg' package is required but not installed. Run `npm install` from the repo root first.");
  }

  const source = new Pool({ connectionString: SOURCE_URL, max: 1, connectionTimeoutMillis: 15000 });
  const target = new Pool({ connectionString: TARGET_URL, max: 1, connectionTimeoutMillis: 15000 });

  let sourceTables, targetTables;
  try {
    try {
      sourceTables = await listTables(source);
    } catch (err) {
      fail(
        2,
        `could not read tables from the SOURCE (cloud) database at ${redacted(SOURCE_URL)}.\n` +
          `  ${err.message}\n` +
          "  If the Supabase project is paused for inactivity, unpause it in the\n" +
          "  dashboard first. Note: the free-tier database size limit blocks writes,\n" +
          "  not reads or exports."
      );
    }
    try {
      targetTables = await listTables(target);
    } catch (err) {
      fail(
        2,
        `could not read tables from the TARGET (local) database at ${redacted(TARGET_URL)}.\n` +
          `  ${err.message}\n` +
          "  Make sure the local stack is running (npm run local:up) and that\n" +
          "  scripts/restore-local-public.sh has been run after the export."
      );
    }
  } finally {
    // Pools stay open until comparison finishes; closed below.
  }

  const byQualified = new Map();
  for (const t of [...sourceTables, ...targetTables]) byQualified.set(t.qualified, t);
  const allTables = [...byQualified.values()].sort((a, b) => a.qualified.localeCompare(b.qualified));
  const sourceSet = new Set(sourceTables.map((t) => t.qualified));
  const targetSet = new Set(targetTables.map((t) => t.qualified));

  const rows = [];
  for (const table of allTables) {
    const q = table.qualified;
    if (!targetSet.has(q)) {
      rows.push({ table: q, source: "n/a", target: "MISSING", ok: false, note: "table missing on target" });
      continue;
    }
    if (!sourceSet.has(q)) {
      rows.push({ table: q, source: "n/a", target: "EXTRA", ok: false, note: "table not present on source" });
      continue;
    }
    let sourceCount, targetCount;
    try {
      [sourceCount, targetCount] = await Promise.all([countRows(source, table), countRows(target, table)]);
    } catch (err) {
      rows.push({ table: q, source: "ERR", target: "ERR", ok: false, note: `count failed: ${err.message}` });
      continue;
    }
    rows.push({
      table: q,
      source: sourceCount,
      target: targetCount,
      ok: sourceCount === targetCount,
      note: sourceCount === targetCount ? "" : "row count mismatch",
    });
  }

  const failures = rows.filter((r) => !r.ok);
  const tableWidth = Math.max(5, ...rows.map((r) => r.table.length));
  const countWidth = Math.max(6, ...rows.map((r) => Math.max(r.source.length, r.target.length)));

  console.log(`\nMigration verification: source (cloud) vs target (local)`);
  console.log(`Schemas compared: ${SCHEMAS.join(", ")}`);
  console.log(`${pad("table", tableWidth)}  ${pad("source", countWidth)}  ${pad("target", countWidth)}  status`);
  console.log("-".repeat(tableWidth + countWidth * 2 + 18));
  for (const r of rows) {
    const status = r.ok ? "PASS" : `FAIL${r.note ? ` (${r.note})` : ""}`;
    console.log(`${pad(r.table, tableWidth)}  ${pad(r.source, countWidth)}  ${pad(r.target, countWidth)}  ${status}`);
  }
  console.log("-".repeat(tableWidth + countWidth * 2 + 18));
  console.log(`Tables: ${rows.length}  Passed: ${rows.length - failures.length}  Failed: ${failures.length}`);

  await source.end();
  await target.end();

  if (failures.length > 0) {
    console.error(
      `\nVERIFICATION FAILED: ${failures.length} table(s) differ between cloud and local.\n` +
        "Re-run scripts/restore-local-public.sh after a fresh export, then verify again.\n" +
        "(Empty tables with 0 rows on both sides count as PASS.)"
    );
    process.exit(1);
  }
  console.log("\nVERIFICATION PASSED: all tables match between cloud and local.");
}

main().catch((err) => fail(2, `unexpected error: ${err && err.message ? err.message : err}`));
