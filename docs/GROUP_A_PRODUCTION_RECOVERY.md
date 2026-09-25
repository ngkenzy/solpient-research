# Group A Production Recovery State

**Status:** BLOCKED — Group A is not production-closed.  
**Production application changes performed by this recovery work:** none.  
**Group B may begin:** no.

## Why this recovery exists

The Group A repository work was merged at `6a4b9e68665e8c5052b01f143ac3b21b760883d2` and passed clean-start reconstruction from zero.

A production read-only probe on 2026-09-25 discovered that live Supabase does not match either of the expected clean states ("Group A absent" or "Group A fully migrated").

## Live production baseline

Captured at **2026-09-25T13:05:25.124Z** through the existing production service-role API.

All eight Group A tables exist, and all eight are empty:

- `research_coverage_states`: 0
- `research_coverage_history`: 0
- `research_freshness_policies`: 0
- `research_component_freshness`: 0
- `research_dependency_rules`: 0
- `research_component_invalidations`: 0
- `research_maintenance_queue`: 0
- `research_maintenance_attempts`: 0

The following Group A contract RPCs were not available:

- `get_research_foundation_operational_status_v1`
- `get_company_research_contract_v1`

This is a **partial deployment signature**.

In particular, a fully applied `20260925090000_group_a_research_foundation_schema.sql` would seed:

- 9 `research-freshness-v1` policy rows;
- 14 `research-dependency-v1` rules.

Both seed tables are currently empty.

## Historical baseline retained before recovery

Ledger counts:

- published Research runs: 18
- normalized facts: 397,454
- evidence observations: 410,244
- locked prediction snapshots: 1
- realized outcomes: 0
- prediction scores: 0
- ranking history rows: 311

Representative immutable Research baseline:

- company: ADBE / Adobe Inc.
- latest published Research run: `525cf700-695d-4979-b094-657b7cb20f4d`
- version: 2
- data cutoff: `2026-09-20T15:30:00+00:00`
- root snapshot SHA-256: `bd720beb5eab9a24f88150678ef2bb369f4c8749221bf7f320cc6dcaf5056ba1`
- child-package SHA-256: `4e1c8d10c98b6cc5267de60fa00233c0dcc07892875604103866d12a5e7d7010`

The child package contained:

- business assessments: 1
- valuations: 1
- thesis variables: 5
- risks: 5
- sources: 4
- Research V2 sections: 0

These hashes/counts are the production historical-integrity comparison baseline. A Group A closeout must not change them unless an independently justified new immutable publication occurs.

## Current credential boundary

GitHub Actions currently has:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

It does not currently have a remote Postgres/Supabase CLI credential path.

Missing:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`

No alternative direct database URL secret was found under:

- `SUPABASE_DB_URL`
- `SUPABASE_DATABASE_URL`
- `SUPABASE_DIRECT_URL`
- `DATABASE_URL`
- `POSTGRES_URL_NON_POOLING`
- `POSTGRES_URL`

Do not put these values in source code or chat transcripts.

## Required next diagnostic

Before any DDL, obtain one authorized read/write database path:

### Preferred linked-project path

Add repository Actions secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`

### Alternative direct database path

Add a protected repository Actions secret containing a valid Postgres connection string, preferably:

- `SUPABASE_DB_URL`

The production gate accepts either path.

Once available, rerun **Group A Production Gate** from the exact pinned ops commit.

The diagnostic must first capture:

1. remote `supabase_migrations.schema_migrations` history;
2. live `public` schema dump;
3. Group A table/policy/trigger/function presence;
4. the immutable historical baseline above.

The diagnostic deliberately does **not** run `db push`.

## Recovery decision tree

### Case A — 20260925090000 is pending remotely

The existing tables were created outside recorded migration history.

Do not blindly run the migration.

Inspect whether the nine Group A policies and three 90000 append-only triggers already exist.

If the live objects exactly match the migration except for deterministic seeds/migration history, prepare an explicit reconciliation plan. Any use of `migration repair --status applied` must be justified by schema equivalence evidence.

If the live objects are incomplete or differ, create a reviewed idempotent recovery migration / controlled SQL repair that brings 90000 state exactly to the repository contract, then reconcile migration history only after verification.

### Case B — 20260925090000 is marked applied remotely but seeds are absent

Remote migration history and live schema disagree.

Do not modify the historical migration file to hide the discrepancy.

Create a new audited repair migration that restores the missing deterministic state and verifies permissions/triggers/policies. Then continue with later Group A migrations only after repair passes.

### Case C — 20260925090100–90300 are marked applied but their RPCs/functions are absent

Treat migration history as unreliable.

Stop. Dump and compare the full Group A schema, then repair through a new migration. Do not mark Group A production-ready.

### Case D — all four versions are pending but only 90000 table objects exist

Reconcile the partial 90000 footprint first. Do not let `db push` discover the failure halfway through production.

## Recovery safety rules

- No automatic destructive rollback.
- No dropping Group A tables that contain production data without explicit evidence and review.
- Do not edit or rewrite historical Research.
- Do not mutate prediction snapshots.
- Do not use Group B migrations as a vehicle for Group A repair.
- Do not enable SEC/maintenance schedules during recovery.
- Do not create `GROUP_A_PRODUCTION_CLOSEOUT.md` until the complete production gate and one scheduled cycle pass.
- Do not begin Group B until Group A is formally closed.

## Ops implementation

The recovery workflow is isolated on:

`ops/group-a-production-closeout`

It pins checkout to the triggering commit and currently runs diagnostic-only. It intentionally refuses to execute production migrations while the partial deployment is unresolved.
