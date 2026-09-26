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

## Hybrid auth: local PostgREST validates Supabase-cloud JWTs

The local stack is data-plane only: PostgreSQL + PostgREST + nginx gateway. There is no local auth server. Authentication stays on Supabase cloud, so the local PostgREST must be able to validate Supabase-issued JWTs. This is what makes `auth.uid()` work locally: PostgREST validates the token signature with `PGRST_JWT_SECRET`, then sets the `request.jwt.claim.sub`, `request.jwt.claim.role`, and `request.jwt.claims` session GUCs from the token. `infra/postgres/init/00-bootstrap.sql` already shims `auth.uid()`, `auth.role()`, and `auth.jwt()` to read those GUCs, so existing RLS policies keep working: PostgREST validates cloud JWT → `request.jwt.claim.sub` → `auth.uid()` → existing policies apply.

### Where the secret comes from (one-time, owner-only setup)

1. Open the Supabase dashboard for the production project.
2. Go to **Settings → API** (project API settings).
3. Copy the **JWT Secret** value.
4. Paste it into your **uncommitted** `.env.local-stack` as: `SOLPIENT_JWT_SECRET=<the value you copied>`
5. `docker compose -f docker-compose.local.yml up` — no code change needed; compose picks the variable up automatically.

Never commit the secret. `.env.local-stack` is gitignored; only the placeholder (`.env.local-stack.example`) is in the repo. If the secret is unset, `PGRST_JWT_SECRET: ${SOLPIENT_JWT_SECRET:-}` resolves to empty and PostgREST behaves as before (anonymous access only, JWTs rejected).

### RLS audit (PR #98 head, 2026-09-26)

Grepped every `CREATE POLICY` in `supabase/migrations` (31 policy statements). Result: **zero policies reference `auth.uid()`, `auth.jwt()`, `user_id`, `auth.users`, or `storage.*`.** Every policy is role-granted — `TO service_role`, `TO anon`, or `TO anon, authenticated` — with simple `USING (true)` / `WITH CHECK (true)` bodies or `EXISTS` subqueries on table data (e.g. "public read frozen research history" in `20260921204308_phase2_provenance_public_read_hardening.sql`, which checks `research_runs.status='published'`).

| Policy group | Migration(s) | Local result | Why |
|---|---|---|---|
| "service role manages/inserts/reads *" (research factory, pipelines, methodology registry, universe screens, etc.) | `20260922060000_*` … `20260922133000_*` (~25 policies) | Works | `TO service_role USING (true)`; no auth.* calls. |
| "public read frozen research history" | `20260921204308_phase2_provenance_public_read_hardening.sql` | Works | `TO anon,authenticated USING (EXISTS … published)`; no auth.* calls. |
| "deny public *" (evidence sources, observations, normalized facts, resolution decisions, manifest staging) | same as above | Works | `FOR … USING (false)` style denies; no auth.* calls. |
| Any policy reading `auth.jwt()` claims (`aal`, `amr`, `app_metadata`/`user_metadata`) | — | N/A | None exist in this repo. |
| `storage.*` policies | — | N/A | None exist; no storage service runs locally. |
| Policies joining `auth.users` or relying on Supabase Auth webhooks | — | N/A | None exist. |

**Known permissiveness (not introduced by this change):** the local bootstrap creates `solpient_dev_api` as `bypassrls` and PostgREST's `PGRST_DB_ANON_ROLE` is `solpient_dev_api`, so RLS is effectively not enforced on the local bridge today — intentionally, because the stack is bound to `127.0.0.1` only. The JWT secret restores *identity* (`auth.uid()` returns the real signed-in user's `sub`), which is what per-user logic and any future hardened policies need. When the role model is tightened later, the shimmed `auth.uid()`/`auth.role()` functions in the bootstrap already read the right GUCs.

### Manual verification checklist

1. Set `SOLPIENT_JWT_SECRET` in `.env.local-stack` and restart the stack: `docker compose -f docker-compose.local.yml up -d`.
2. Sign in through the app exactly as before — auth still hits Supabase cloud and returns a normal Supabase JWT.
3. With the token, query a protected path through the local gateway (`http://127.0.0.1:54321`), e.g. `GET /research_public_history_items` with `Authorization: Bearer <cloud JWT>` — expect the same rows as the anonymous request (both roles are granted).
4. Confirm identity propagates: open `psql` inside the `db` container; with the secret set, a request carrying a valid cloud JWT makes `auth.uid()` return the token's `sub` (your user UUID); without the secret, it returns NULL (anonymous behavior).
5. Check `/api/health/db` (Next.js) reports the data plane healthy.
6. Negative test: `PGRST_JWT_SECRET` set but token signed with a *different* secret must be rejected (401) — proves signature validation is live.

<!-- ===== WORKER A SECTION — Hybrid auth-vs-data endpoint split (merge-safe) ===== -->
## Hybrid auth-vs-data endpoint split

The local PostgREST bridge is data-plane only: it has no `/auth/v1`, so
`supabase.auth.*` calls (sign-in, sign-up, sign-out, session, claims) cannot
run against it. Hybrid architecture:

```text
data queries  ->  local PostgREST bridge (:54321)            (lib/supabase.ts, lib/admin-supabase.ts)
auth/session  ->  Supabase cloud (NEXT_PUBLIC_SUPABASE_URL)   (lib/supabase/auth-client.ts)
```

Local PostgREST validates cloud-issued JWTs via `PGRST_JWT_SECRET`
(configured separately — see the JWT section above).

### The seam

- `lib/auth-endpoints.mjs` — pure, dependency-free env resolvers (unit-tested
  in `scripts/test-auth-endpoints.mjs`):
  - `resolveDataEndpoint(env)`: local bridge first, cloud fallback
    (unchanged from current behavior).
  - `resolveAuthEndpoint(env)`: **cloud only** — the local bridge URL/key
    vars are deliberately absent, so auth can never be pointed at the bridge.
  - `isLocalBridgeEndpoint(endpoint, env)`: guard helper for the invariant.
- `lib/supabase/auth-client.ts` — server-only `createAuthServerClient()`
  built from the cloud URL + anon key. This is the single entry point for any
  `supabase.auth.*` call site (sign-in/sign-up/sign-out/session). Returns
  `null` when cloud auth env is missing, same convention as the other
  factories. Session/cookie behavior is untouched: same non-persistent,
  non-refreshing auth config as the other factories, no new cookie names or
  storage.
- `lib/supabase.ts` (`getSupabase()`) now delegates endpoint resolution to
  `resolveDataEndpoint`; fallback order is identical, no call sites change.

### Env vars (all cloud, none hardcoded)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase-anon-key>
```

Documented (commented-out) in `.env.local-stack.example`. Leaving them unset
disables cloud auth gracefully; nothing falls back to the bridge.

### Verification

```bash
node scripts/test-auth-endpoints.mjs   # 12 assertions: cloud/auth split, bridge never used for auth
```
<!-- ===== END WORKER A SECTION ===== -->

## Migration verification and destructive-restore warning

### 1. The restore script is destructive (drops BOTH schemas)

`scripts/restore-local-public.sh` does **not** merge data. Before restoring it runs:

```sql
drop schema if exists private cascade;
drop schema if exists public cascade;
```

(Phase 3 above says the script "resets only the local `public` schema" — that is
inaccurate: the `private` schema is dropped too.) Everything currently in the
local `public` and `private` schemas is permanently destroyed by the restore.

The script now checks for existing local tables before the reset. If it finds
any, it prints a prominent warning and aborts unless you explicitly opt in:

```bash
RESTORE_OVERWRITE=1 bash scripts/restore-local-public.sh
```

**Before restoring over an existing local database:** back up the Docker volume
holding the data first (`docker volume ls`, then back up the volume mounted by
the `db` service in `docker-compose.local.yml`).

### 2. Cloud preconditions for the export

- The export reads from the hosted Supabase project (`supabase db dump
  --linked`). **If the project is paused for inactivity, unpause it in the
  Supabase dashboard first** — a paused project refuses connections.
- The free-tier **database size limit blocks writes, not reads or exports**; a
  project that hit the size cap can still be fully exported.
- `supabase db dump` needs the credentials from the auth setup described in
  Phase 2 (`supabase login` + `supabase link`, which may ask for the hosted
  database password). No new credential flow is introduced here — never commit
  passwords, access tokens, or connection strings.

### 3. Verifying the migration

After the restore, compare every table in the `public` and `private` schemas
cloud-vs-local:

```bash
VERIFY_SOURCE_URL='postgresql://postgres:***@db.<ref>.supabase.co:5432/postgres' \
VERIFY_TARGET_URL='postgresql://solpient:***@127.0.0.1:55432/solpient' \
npm run local:verify
```

`VERIFY_SOURCE_URL` is the cloud connection string (Supabase dashboard ->
Database settings -> Connection string -> URI). If `VERIFY_TARGET_URL` is
unset, the script builds it from `.env.local-stack` (`SOLPIENT_DB_USER` /
`SOLPIENT_DB_PASSWORD` / `SOLPIENT_DB_NAME` / `SOLPIENT_DB_PORT`).

The script prints a PASS/FAIL row per table with row counts on both sides and
exits non-zero on any mismatch. `0 = 0` on an empty table is a PASS. Exit
codes: `0` = all tables match, `1` = any mismatch, `2` = config/connection
error.

**End-to-end manual checklist (owner):**

1. `bash scripts/export-supabase-public.sh`
2. `bash scripts/restore-local-public.sh` (read the overwrite warning first)
3. `npm run local:verify` — expect `VERIFICATION PASSED`
