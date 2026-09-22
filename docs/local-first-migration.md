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

The export is explicitly limited to Solpient's `public` and `private` schemas. Supabase-managed Auth, Storage, Realtime, Cron, and extension schemas are not part of this application-data backup.

The export is written to:

```text
backups/supabase-export/schema.sql
backups/supabase-export/data.sql
```

Solpient currently uses two application schemas: `public` and `private`. The export command selects exactly those schemas so managed platform objects cannot leak into the plain-PostgreSQL restore.

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

### Direct PostgreSQL checkpoint

After pulling the migration branch and installing dependencies:

```bash
npm install
npm run local:configure-app
npm run local:verify-db
npm run dev
```

Then verify the Next.js server is using PostgreSQL directly:

```bash
curl http://127.0.0.1:3000/api/health/db
```

A successful response includes `"mode":"postgres"`.

The homepage, research ranking, core company research record, company-change panel, decision-trigger panel, research-coverage panel, and prediction history now prefer direct PostgreSQL. Remaining legacy modules continue to use the compatibility bridge until they are migrated and verified.

## Phase 2 checkpoint: read path decoupled

The primary read-only application surface now prefers direct PostgreSQL through server-only repository modules.

Direct PostgreSQL readers now cover:

- home dashboard and rankings;
- company research core records;
- company performance and historical charts;
- capital / ownership intelligence;
- advanced research modules;
- valuation bridge;
- Research Standard v1 and v2;
- company change engine;
- decision triggers and active trigger feed;
- research coverage;
- prediction history;
- Research Health & Repair Center.

The React components above no longer query Supabase directly. During migration, their repository modules retain a Supabase/PostgREST fallback only when `SOLPIENT_DATABASE_URL` is absent.

Verify Phase 2 locally:

```bash
npm install
npm run local:configure-app
npm run local:verify-db
npm run local:verify-research
npm run build
npm run dev
```

Then check:

```text
/
/research
/research/ADBE
/research/DECK
/research/PFE
/research-health
/alerts
/api/health/db
```

Do not remove the compatibility bridge or `@supabase/supabase-js` yet. Write-heavy review, publication, ingestion, repair, automation, and research-factory workflows still need to be migrated.

## Phase 3A checkpoint: review workbench writes

The internal review workbench now supports direct PostgreSQL for both reads and the first set of write operations.

Direct PostgreSQL now covers:

- review queue reads;
- individual draft/review/enrichment/composition reads;
- saving a review;
- human verification / attestation updates;
- applying verified enrichment;
- applying Research Composer output;
- bulk preparing generated V2 review packages.

These mutations use PostgreSQL transactions so related review/draft/composition changes commit together or roll back together.

Verify the local review database before using the workbench:

```bash
npm run local:verify-review
npm run build
npm run dev
```

Then open:

```text
/review/login
/review
```

Phase 3A originally left fresh factory builds and final publication on the legacy adapter. Phase 3B now migrates those paths, together with provenance and automation workers, to direct PostgreSQL.

## Phase 3B checkpoint: publication, provenance, and automation

Phase 3B moves the high-impact research pipeline and operational workers to Solpient-owned PostgreSQL.

Direct PostgreSQL now covers:

- fresh baseline/factory draft creation;
- Research Composer persistence;
- review preparation and human attestation;
- final reviewed publication through `publish_reviewed_research_v2`;
- provenance normalization, lineage, conflict checks, and research-input manifest staging;
- research-factory materialization and state transitions;
- autonomous industry assignment and valuation policy workers;
- autonomous factory orchestration;
- research repair-job processing;
- SEC and Yahoo fundamentals/history ingestion;
- research context, coverage, update planning, enrichment, and change-event workers;
- capital-intelligence ingestion, provider auditing, and coverage workflows;
- methodology activation/validation workers.

The existing PostgreSQL functions remain authoritative for atomic state transitions and publication. The application now calls those functions directly through `pg`; it does not need PostgREST or Supabase service-role credentials for these local workflows.

A small server-only compatibility client remains temporarily for legacy worker query syntax. It translates the existing `.from(...).select()/upsert()/rpc()` subset directly into SQL through `pg`; it does **not** call Supabase or PostgREST.

Verify Phase 3B:

```bash
npm install
npm run local:configure-app
npm run local:verify-db
npm run local:verify-research
npm run local:verify-review
npm run local:verify-phase3b
npm run build
```

The Phase 3B verifier checks:

- required publication/factory PostgreSQL functions;
- required research/provenance/factory tables;
- database write privileges;
- a direct compatibility-layer smoke query;
- all migrated operational worker files for leftover Supabase client imports or Supabase database credentials.

Do not remove the hosted Supabase project yet. First verify the local review build/publish workflow and at least one factory/automation run against local PostgreSQL.

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
