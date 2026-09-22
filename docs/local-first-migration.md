# Solpient local-first migration

The goal is to remove hosted Supabase as an infrastructure dependency without breaking the existing research application.

## Architecture during the migration

```text
Next.js
  |
  | current fluent query API
  v
local loopback gateway :54321
  |
  v
PostgREST 16.3
  |
  v
PostgreSQL 17
```

The PostgREST bridge is temporary. It lets the existing application run against a database owned by Solpient while the application query layer is converted to direct PostgreSQL access.

## Phase 1: local owned infrastructure

1. Install/start Docker Desktop.
2. Copy the stack configuration:

   ```bash
   cp .env.local-stack.example .env.local-stack
   ```

3. Change `SOLPIENT_DB_PASSWORD` in `.env.local-stack`.
4. Start the local database/API:

   ```bash
   npm run local:up
   ```

5. Verify:

   ```bash
   npm run local:status
   curl -sS http://127.0.0.1:54321/ >/dev/null && echo "local API reachable"
   ```

## Phase 2: export the existing Supabase PostgreSQL database

Supabase's current migration guidance recommends using `supabase db dump` rather than raw `pg_dump`, because the CLI filters Supabase-managed schemas and reserved roles.

Authenticate and link this repo to the existing Solpient Research project:

```bash
supabase login
supabase link --project-ref hmfrlpsjszjpvzogrico
```

The link command may ask for the hosted database password.

Then export the schema and data:

```bash
bash scripts/export-supabase-public.sh
```

The export is written to:

```text
backups/supabase-export/schema.sql
backups/supabase-export/data.sql
```

The default Supabase dump excludes managed schemas such as Auth and Storage. Solpient currently needs the application-facing `public` schema and its data for this migration.

## Phase 3: restore into Solpient-owned PostgreSQL

With the local stack running:

```bash
bash scripts/restore-local-public.sh
```

This resets only the local `public` schema, restores the exported schema/data, grants the local PostgREST compatibility role access, and reloads the PostgREST schema cache.

Never point this restore script at production.

## Phase 4: run Solpient against local data

Add these values to the application's `.env.local`:

```bash
NEXT_PUBLIC_SOLPIENT_DATA_API_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SOLPIENT_DATA_API_KEY=local-dev-only
SOLPIENT_ADMIN_DATA_API_URL=http://127.0.0.1:54321
SOLPIENT_ADMIN_DATA_API_KEY=local-dev-only
```

Then run:

```bash
npm run dev
```

Do not delete the old Supabase variables until the local app has passed its existing tests and the core research pages work.

## Phase 5: remove the Supabase client package

After local parity is proven:

- add a server-only PostgreSQL data access layer;
- move reads/writes behind repository functions;
- convert Server Components, route handlers, scripts, and review actions;
- eliminate browser-side database access;
- remove `@supabase/supabase-js`;
- remove the temporary PostgREST/nginx compatibility bridge.

This phase is deliberately last because Solpient currently has many chained `.from(...).select(...)` queries, nested relation reads, upserts, and RPC-style database functions. Converting them behind a stable repository layer is safer than rewriting all call sites at once.

## Phase 6: production VPS

The production design should not expose PostgreSQL or a privileged PostgREST role to the public internet.

Recommended shape:

```text
Internet
  |
reverse proxy / TLS
  |
Next.js server
  |
private Docker network
  |
PostgreSQL
```

Backups must be copied off the VPS. A VPS is not a backup.

## Local AI on macOS

Run Ollama as the macOS application rather than inside Docker so it can use Mac GPU acceleration. Solpient can call Ollama on `http://127.0.0.1:11434`. No model API key is required for local inference.
