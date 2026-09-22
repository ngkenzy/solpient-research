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
   docker compose -f docker-compose.local.yml --env-file .env.local-stack ps
   curl http://127.0.0.1:54321/
   ```

## Phase 2: copy the existing Supabase PostgreSQL database

Get the direct PostgreSQL connection string for the existing Solpient Research database and keep it out of Git.

```bash
export SUPABASE_DB_URL='postgresql://...'
bash scripts/export-supabase-public.sh
bash scripts/restore-local-public.sh
```

The dump contains only the `public` schema and its data. Supabase Auth, Storage, internal schemas, and platform metadata are intentionally not copied.

## Phase 3: run Solpient against local data

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

## Phase 4: remove the Supabase client package

After local parity is proven:

- add a server-only PostgreSQL data access layer;
- move reads/writes behind repository functions;
- convert Server Components, route handlers, scripts, and review actions;
- eliminate browser-side database access;
- remove `@supabase/supabase-js`;
- remove the temporary PostgREST/nginx compatibility bridge.

This phase is deliberately last because Solpient currently has many chained `.from(...).select(...)` queries, nested relation reads, upserts, and RPC-style database functions. Converting them behind a stable repository layer is safer than rewriting all call sites at once.

## Phase 5: production VPS

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
