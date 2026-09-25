# Group A — Trustworthy Research Foundation

## Purpose

Group A hardens the existing Solpient Research system so the next consumer layer can safely build:

```text
Portfolio -> Thesis -> Materiality -> What Matters
```

This implementation extends the existing historical-integrity, provenance, Research Factory, company-change, and update-planner architecture. It does not replace them.

## Reused architecture

Group A preserves and relies on:

- immutable published `research_runs` and child Research state,
- correction/supersession instead of historical mutation,
- locked prediction snapshots and separate realized outcomes,
- append-oriented ranking/history protections,
- `evidence_sources -> evidence_observations -> normalized_facts`,
- normalized-fact supersession and provider conflict lineage,
- frozen `research_input_manifests`,
- knowledge-time cutoffs at publication,
- existing company-change events and state snapshots,
- existing coarse `research_freshness` and `research_update_plans` for compatibility,
- methodology governance and existing Research Factory workflows.

## New authoritative state

### Coverage

- `research_coverage_states` — current deterministic state.
- `research_coverage_history` — append-only transitions.

Coverage methodology: `research-coverage-v1`.

### Component freshness

- `research_freshness_policies` — versioned policy.
- `research_component_freshness` — machine-readable component state.

Freshness statuses:

- `CURRENT`
- `STALE`
- `REVIEW_DUE`
- `NEW_EVIDENCE`
- `NOT_SUPPORTED`
- `UNKNOWN`

The existing `research_freshness` table remains populated as a compatibility projection; it is no longer the full freshness model.

### Dependency invalidation

- `research_dependency_rules` — versioned deterministic dependency mapping.
- `research_component_invalidations` — targeted invalidation ledger.

When a new immutable normalized fact supersedes an older fact and materially differs, the database trigger maps the fact to affected components and creates targeted maintenance work.

### Maintenance queue

- `research_maintenance_queue` — authoritative work item.
- `research_maintenance_attempts` — attempt history.

Each queue item retains company, trigger, trigger evidence, detected time, affected components, priority, required action, status, attempts, completion, error, and resulting Research version where applicable.

## Coverage eligibility

### MONITORED

A canonical `companies` row exists. No reviewed Research is implied.

### RESEARCHED

The latest published Research version must have all of:

1. `business_assessments` row,
2. one or more `thesis_variables`,
3. `valuations` row,
4. one or more `risk_register` rows,
5. frozen `research_input_manifests` row.

### DEEP_COVERAGE

All RESEARCHED conditions plus:

1. at least two published Research versions,
2. at least one locked prediction,
3. at least 12 valuation-history observations,
4. at least three fiscal years of capital-allocation history,
5. every freshness component flagged `required_for_deep_coverage` is `CURRENT`.

The current state has a database guard: a service cannot persist a coverage label that the deterministic evaluator says is ineligible.

## Freshness calculation

The policy distinguishes a **check clock** from a **review clock**.

General precedence:

1. unsupported source -> `NOT_SUPPORTED`
2. evidence later than the current Research cutoff for a review-triggering component -> `NEW_EVIDENCE`
3. open dependency invalidation -> `REVIEW_DUE`
4. overdue/missing required review -> `REVIEW_DUE` or `UNKNOWN`
5. overdue/missing source check -> `STALE` or `UNKNOWN`
6. otherwise -> `CURRENT`

Important: the SEC monitor bridge records `last_checked_at` even when no new filing exists.

## Temporal read contract

`get_normalized_facts_as_of_v1(company_id, cutoff, metric_key)` returns the latest fact per economic-period identity that was known by the cutoff. Later facts are excluded.

Publication-time provenance protections remain unchanged and continue to enforce the Research input cutoff.

## Group B contract

`get_company_research_contract_v1(company_id, as_of)` returns a sanitized JSON contract containing:

- canonical company identity,
- historical/current coverage,
- latest published Research,
- Research history,
- canonical thesis variables,
- component freshness,
- new normalized evidence after the current Research cutoff,
- open invalidated components,
- frozen evidence-manifest metadata.

The RPC is service-role only in Group A. Group B can later expose an authenticated consumer API without granting arbitrary access to internal tables.

## Operational observability

`get_research_foundation_operational_status_v1()` returns:

- coverage counts,
- freshness-status counts,
- open invalidation count,
- maintenance queue counts,
- failed queue items with errors.

Routine operational status does not require reading raw logs.

## Automation clocks

### Market clock

Cheap/frequent market ingestion remains separate from Research publication. After market data is ingested, run:

```bash
npm run sync:research-foundation
```

### Evidence clock

SEC monitor:

```bash
node scripts/monitor-sec.mjs
npm run sync:sec-monitor-state
```

The bridge records successful quiet checks and new filings in authoritative database state.

Canonical provenance synchronization remains:

```bash
npm run sync:provenance
npm run sync:research-foundation
```

### Research clock

Research maintenance is event/staleness driven:

```text
new evidence / overdue component
  -> invalidation/freshness
  -> maintenance queue
  -> targeted action
  -> reviewed publication only when warranted
```

Do not schedule full deep Research for every company every day.

## Clean-start verification

A fresh environment must support:

1. install dependencies,
2. create documented environment variables,
3. create/reset a fresh Postgres/Supabase database,
4. apply every migration from zero in filename order,
5. run deterministic seed/fixtures as required by existing Research tests,
6. run historical-integrity integration tests,
7. run evidence-provenance integration tests,
8. run `supabase/tests/group_a_research_foundation.sql`,
9. run `npm run test:research-foundation`,
10. run `npm run build`,
11. synchronize provenance/freshness for at least one representative ticker,
12. verify the Group B contract and operational-status RPC.

No undocumented manual database mutation is part of the process.

## Production rollout gate

Group A code may merge before production scheduling is enabled, but production automation must remain manual-only until the new database contract exists.

Required rollout order:

1. Merge the reviewed Group A code after all PR CI is green.
2. Link the Supabase CLI to the production project using an authorized operator environment.
3. Apply pending migrations with `supabase db push`. Existing migration-history entries are not replayed; the production rollout should apply only migration files not already registered remotely.
4. Confirm the four Group A migrations are registered:
   - `20260925090000_group_a_research_foundation_schema.sql`
   - `20260925090100_group_a_freshness_coverage.sql`
   - `20260925090200_group_a_invalidation_queue.sql`
   - `20260925090300_group_a_contracts_observability.sql`
5. Run the manual **SOLPIENT Group A Production Health** workflow.
6. Require a successful canary response from:
   - `get_research_foundation_operational_status_v1()`
   - `get_company_research_contract_v1()`
7. Run **SEC & Ownership Monitor** manually once and verify authoritative check state is persisted.
8. Run **SOLPIENT Group A Research Maintenance** manually once and inspect queue/failure counts.
9. Only after those canaries pass, add the intended weekday schedules in a separate small PR.

The initial Group A merge intentionally leaves the SEC monitor and Group A maintenance workflows as `workflow_dispatch` only. This prevents code/schema deployment races and keeps production unchanged until the database migration is explicitly completed.

The clean-start workflow is a permanent regression gate. It starts a disposable local Supabase stack, replays every tracked migration from zero, runs historical-integrity, provenance, and Group A database integration tests, lints the database, and destroys the local stack.

## Environment

Server-side workflows require:

- `SUPABASE_URL`
- one of `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`

SEC direct monitoring additionally uses:

- `SEC_CONTACT`
- `SEC_USER_AGENT`

Never place service-role credentials in client-side `NEXT_PUBLIC_*` variables.

## Known boundaries

- Group A deliberately does not build Portfolio, user thesis preferences, materiality, What Matters, Money, brokerage, or banking.
- `earnings_guidance` is `NOT_SUPPORTED` until a supported evidence source is actually present; Group A does not fabricate a check.
- DEEP_COVERAGE is intentionally conservative and may downgrade when required freshness becomes stale.
- Maintenance items that require a human/reviewed Research judgment remain queued for the existing review/publication path; Group A does not allow automation to bypass immutable publication controls.
