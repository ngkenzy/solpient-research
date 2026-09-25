# Group A Production Object Manifest

**Repository baseline:** main at or after `6a4b9e68665e8c5052b01f143ac3b21b760883d2`

This manifest pins the exact Group A migration files and the database objects they are intended to create or modify.

## Migration 20260925090000

File:

`supabase/migrations/20260925090000_group_a_research_foundation_schema.sql`

Git blob SHA:

`9485c7033ef88e68de8e37e48c38a41ede8f9734`

Creates/defines:

### Tables
- `research_coverage_states`
- `research_coverage_history`
- `research_freshness_policies`
- `research_component_freshness`
- `research_dependency_rules`
- `research_component_invalidations`
- `research_maintenance_queue`
- `research_maintenance_attempts`

### Deterministic seeds
- 9 `research-freshness-v1` rows in `research_freshness_policies`
- 14 `research-dependency-v1` rows in `research_dependency_rules`

### Indexes
- `research_coverage_history_company_time_idx`
- `research_component_freshness_status_due_idx`
- `research_component_freshness_company_status_idx`
- `research_component_invalidations_fact_component_uniq`
- `research_component_invalidations_company_status_idx`
- `research_maintenance_queue_claim_idx`
- `research_maintenance_queue_company_idx`
- `research_maintenance_attempts_item_idx`

### RLS
Enables RLS on all eight Group A tables.

### Grants / revokes
- revokes public/anon/authenticated access from all eight Group A tables;
- service_role manages current state, freshness, invalidations, queue, attempts;
- service_role receives read access to versioned policy/rule tables;
- coverage history remains append-oriented.

### Policies
- `service role manages research coverage states`
- `service role reads research coverage history`
- `service role inserts research coverage history`
- `service role reads research freshness policies`
- `service role manages research component freshness`
- `service role reads research dependency rules`
- `service role manages research component invalidations`
- `service role manages research maintenance queue`
- `service role manages research maintenance attempts`

### Triggers
- `research_coverage_history_append_only_guard`
- `research_freshness_policies_append_only_guard`
- `research_dependency_rules_append_only_guard`

These use the pre-existing `private.guard_append_only_history()` function.

### Other
- ensures `pgcrypto` extension exists in `extensions`;
- ensures `private` schema exists;
- adds table comments describing authoritative Group A state.

## Migration 20260925090100

File:

`supabase/migrations/20260925090100_group_a_freshness_coverage.sql`

Git blob SHA:

`bf6d8f35ee50aa3d1653231cce30638f36b744ff`

Creates/replaces:

### Public functions / RPCs
- `get_normalized_facts_as_of_v1(uuid,timestamptz,text)`
- `record_research_component_check_v1(uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,boolean,timestamptz)`
- `evaluate_research_coverage_v1(uuid,timestamptz)`
- `refresh_research_coverage_v1(uuid,timestamptz)`
- `refresh_research_foundation_state_v1(uuid,timestamptz)`

### Private function
- `private.guard_research_coverage_state_v1()`

### Trigger
- `research_coverage_state_guard` on `research_coverage_states`

### Existing object modified
- compatibility projection writes to existing `research_freshness`

### Security
Public/anon/authenticated execution revoked from Group A RPCs; execute granted to service_role.

## Migration 20260925090200

File:

`supabase/migrations/20260925090200_group_a_invalidation_queue.sql`

Git blob SHA:

`9ff0d6e4efe5ba305b7f61ebb44a486b7791824c`

Creates/replaces:

### Private function
- `private.invalidate_research_from_fact_v1()`

### Public functions / RPCs
- `enqueue_due_research_maintenance_v1(uuid,timestamptz)`
- `claim_research_maintenance_batch_v1(integer,text,text[])`
- `complete_research_maintenance_item_v1(uuid,text,uuid,text,jsonb)`

### Trigger
- `zz_normalized_facts_research_invalidation` on existing `normalized_facts`

### Existing objects modified at runtime
The invalidation trigger may write targeted rows into:
- `research_component_invalidations`
- `research_component_freshness`
- `research_maintenance_queue`

It does not rewrite published Research.

### Security
Public/anon/authenticated execution revoked; service_role execution granted.

## Migration 20260925090300

File:

`supabase/migrations/20260925090300_group_a_contracts_observability.sql`

Git blob SHA:

`250c6bcfa5567e21fd96f949eafe5eaa702c69f7`

Creates/replaces:

### Public functions / RPCs
- `get_company_research_contract_v1(uuid,timestamptz)`
- `get_research_foundation_operational_status_v1(timestamptz)`

### Security
Public/anon/authenticated execution revoked; service_role execution granted.

## Live production state discovered before repair

Read-only production probes on 2026-09-25 found:

- all eight Group A tables exist;
- all eight tables expose the columns expected by migration 90000;
- all eight tables contain 0 rows;
- therefore the 9 freshness-policy rows are absent;
- therefore the 14 dependency-rule rows are absent;
- the two Group A contract/observability RPCs from migration 90300 are unavailable;
- service-role RPC probes also indicate later Group A function work is not yet operational.

This is not a valid closed Group A state.

## Production recovery rule

Do not blindly run `supabase db push` until live migration history and database metadata are inspected.

Required direct-metadata checks:

1. `supabase_migrations.schema_migrations`
2. exact table definitions / constraints / defaults;
3. indexes listed above;
4. RLS enabled state;
5. policies listed above;
6. append-only triggers;
7. `research_coverage_state_guard`;
8. `zz_normalized_facts_research_invalidation`;
9. all public/private Group A functions;
10. permissions/grants.

## Recovery / rollback strategy

Group A migrations are additive. The recovery strategy is therefore **stop-and-reconcile**, not automatic destructive rollback.

If a migration or repair fails:

1. stop before any later Group A migration;
2. capture migration history and live object state;
3. determine whether the failed unit committed fully, partially, or not at all;
4. preserve all existing historical Research and prediction ledgers;
5. repair the incomplete Group A object set through an audited migration or controlled migration-history reconciliation;
6. re-run health/integrity checks before continuing.

Do not drop production Group A tables as a convenience. Do not rewrite historical Research. Do not mutate locked prediction snapshots. Do not begin Group B while Group A production state is inconsistent.
