# Group A Production Closeout

**Status:** CLOSED  
**Production-ready timestamp:** 2026-09-25 22:23:44.824522 UTC  
**Production-ready local time:** 2026-09-25 18:23:44 EDT  
**Production Supabase project:** `hmfrlpsjszjpvzogrico` — Solpient Research

## Purpose

Group A establishes the trustworthy Research foundation that Group B can safely consume. It provides deterministic coverage/freshness state, targeted invalidation, bounded maintenance, operational observability, SEC monitoring, and historical-integrity protections without regenerating published Research.

Group B was intentionally held until this production gate closed.

## Production migrations

Applied to production and reconciled to Git migration history:

1. `20260925090000_group_a_research_foundation_schema.sql`
2. `20260925090100_group_a_freshness_coverage.sql`
3. `20260925090200_group_a_invalidation_queue.sql`
4. `20260925090300_group_a_contracts_observability.sql`
5. `20260925151000_group_a_queue_coalescing.sql`

The migration ledger was normalized so remote versions match the filenames in Git exactly.

## Schema and policy validation

Validated in production:

- 8 Group A tables
- RLS enabled on all 8 Group A tables
- expected service-role policies present
- append-only guards present
- coverage-state guard present
- normalized-fact invalidation trigger present
- deterministic freshness policies seeded: 9
- deterministic dependency rules seeded: 14
- operational-status RPC works
- research-contract RPC works
- queue claim / completion RPCs work
- fresh database can replay the entire migration chain from zero

Clean-start CI repeatedly passed:

- historical-integrity integration
- evidence-provenance integration
- Group A research-foundation integration
- database lint
- migration status verification

## Production coverage

At closeout:

- coverage states: **23**
- component freshness rows: **207**
- invalidation rows: **224**
- queued maintenance items: **105**
- failed maintenance items: **0**
- succeeded maintenance items: **18**

The remaining queued items represent legitimate review/refresh work; they are not production failures.

## SEC monitoring

Production SEC coverage includes 23 monitored companies, including PFE.

Cloud-hosted SEC access is not reliable:

- GitHub-hosted runners receive SEC HTTP 403 for the direct SEC path.
- Supabase Edge Functions also received SEC HTTP 403 during egress testing.

Therefore SEC polling is intentionally routed through the local Mac worker rather than GitHub/Supabase cloud execution.

The local worker:

- loads `.env.local` directly
- verifies the production Supabase project
- uses a lock to prevent overlapping runs
- runs SEC submissions monitoring
- synchronizes SEC monitor state
- processes a bounded evidence-refresh batch
- writes success/failure audit records

## Production schedule

### Local Mac launchd

Label:

`com.solpient.group-a-sec-worker`

Schedule:

- 08:15 local machine time
- 17:15 local machine time

Responsibilities:

- SEC submissions monitoring
- SEC monitor-state sync
- SEC-dependent `evidence_refresh` maintenance
- bounded batch size: 5 by default

The launchd installer was hardened to resolve the real Node/npm paths and bake them into the installed plist because launchd's default PATH does not include common user-space Node installations.

### GitHub Actions

Workflow:

`SOLPIENT Group A Research Maintenance`

Schedule:

- weekdays at 22:45 UTC

Cloud-safe responsibilities only:

- lightweight market refresh
- coverage/freshness recomputation
- `market_refresh`
- `ownership_refresh`

SEC-dependent evidence work is intentionally excluded from the GitHub scheduled worker.

## Real scheduled-cycle proof

A real launchd cycle ran on 2026-09-25 after schedule installation.

Worker:

`local:37298`

It claimed five `evidence_refresh` items.

Results:

- DECK — succeeded
- BLBD — succeeded
- DPZ — succeeded
- DCI — succeeded
- ICE — failed

The scheduled execution itself was confirmed working. Queue coalescing remained correct with **zero duplicate queued normalized-fact batches**.

The ICE failure was then investigated rather than ignored.

### ICE failure 1: lost structured error

The initial ICE failure surfaced as:

`[object Object]`

PR #111 hardened maintenance/provider error serialization and made single-ticker SEC failures return nonzero status so retry semantics remain accurate.

### ICE failure 2: SEC duplicate-period normalization

The next audited ICE retry exposed the real database error:

`21000 | ON CONFLICT DO UPDATE command cannot affect row a second time`

Cause:

SEC Companyfacts normalization produced multiple rows sharing the database uniqueness key:

`company_id + period_end + form + provider`

PR #112 added deterministic pre-upsert deduplication using that exact database key.

Preference order:

1. newer SEC filing
2. more complete snapshot when filing dates tie
3. fiscal year / observed-time deterministic tie-breakers

A focused regression test was added to Build Check.

### Final ICE retry

Final audited retry:

- ticker: ICE
- action: `evidence_refresh`
- status: **succeeded**
- follow-on items: 0
- SEC normalized quarters stored: **37**
- duplicate rows removed: **7**
- fiscal years covered: **12**
- latest period: **2026-06-30**

At closeout, failed maintenance queue items = **0**.

## Queue safety

A production canary exposed normalized-fact queue fan-out before schedules were enabled.

The system originally produced many redundant queue items from individual normalized facts.

PR #108 repaired this by preserving every per-fact invalidation while coalescing operational queue work to one item per:

`company + required_action + UTC day`

Historical duplicate queue rows were not deleted. They were marked `cancelled` and retained for auditability.

Production result:

- redundant items cancelled during repair: **73**
- duplicate queued normalized-fact batches at closeout: **0**

## Manual maintenance canaries

A bounded market-refresh canary was run in production.

The first attempt failed because an empty `SUPABASE_SECRET_KEY` environment variable prevented fallback to the valid service-role key.

The credential fallback was corrected in the maintenance scripts.

The same queue item retried successfully through normal queue semantics.

No manual queue mutation was required.

## Historical integrity

Published Research remained immutable throughout Group A rollout, migration repair, queue repair, SEC canaries, scheduled execution, and ICE recovery.

Representative ADBE published run:

- run ID: `525cf700-695d-4979-b094-657b7cb20f4d`
- version: 2
- data cutoff: 2026-09-20 15:30:00 UTC

Original and final SHA-256 values match exactly:

- published-run hash:  
  `bd720beb5eab9a24f88150678ef2bb369f4c8749221bf7f320cc6dcaf5056ba1`

- child-package hash:  
  `4e1c8d10c98b6cc5267de60fa00233c0dcc07892875604103866d12a5e7d7010`

Child counts remained:

- business assessments: 1
- valuations: 1
- thesis variables: 5
- risk register: 5
- sources: 4
- research_v2_sections: 0

Production immutable / append-only state at closeout:

- published Research runs: **18**
- locked prediction snapshots: **1**
- realized outcomes: **0**
- prediction scores: **0**
- ranking-history rows: **326**
- normalized facts: **407,244**
- evidence observations: **422,445**

The increase in ranking-history rows from the earlier baseline was traced to the independent scheduled **Phase 3 Decision Ranking** workflow at 2026-09-25 17:03 UTC. It appended a new immutable ranking snapshot and did not mutate published Research.

## Key PRs

- #105 — Group A trustworthy research foundation
- #106 — production recovery and SEC worker hardening
- #108 — normalized-fact queue coalescing
- #109 — production schedule enablement
- #110 — launchd runtime PATH hardening
- #111 — maintenance/provider error diagnostics
- #112 — SEC Companyfacts duplicate-key normalization

## Known limitations

1. **SEC cloud egress**
   GitHub-hosted and Supabase Edge environments currently receive HTTP 403 from SEC endpoints. SEC work therefore depends on the configured local Mac worker until a suitable stable self-hosted/VPS path is introduced.

2. **Local machine availability**
   The launchd SEC worker requires the Mac to be available. macOS may execute a calendar job after wake rather than exactly at the requested minute.

3. **Existing maintenance backlog**
   105 queued maintenance items remain at closeout. They are bounded, auditable, and non-failed; Group A does not require the queue to be empty.

4. **Freshness states are intentionally not all CURRENT**
   Some components are `NEW_EVIDENCE`, `REVIEW_DUE`, `STALE`, or `NOT_SUPPORTED`. These states are part of the Group A contract and are not themselves production defects.

5. **GitHub scheduled maintenance**
   The weekday 22:45 UTC workflow is enabled and CI-validated. The real scheduled-cycle requirement for Group A closeout was satisfied by the launchd production cycle described above.

6. **Performance-advisor informational findings**
   Previously observed Group A foreign-key covering-index recommendations are performance improvements, not correctness/security blockers.

## Closeout decision

Group A production gate is **CLOSED** as of:

**2026-09-25 22:23:44.824522 UTC**

The system has demonstrated:

- reproducible clean-start deployment
- production migration correctness
- deterministic coverage/freshness
- targeted invalidation
- bounded audited maintenance
- queue coalescing
- real scheduled execution
- SEC normalization recovery
- zero failed maintenance items at closeout
- exact published-Research immutability

**Group B may begin from this point.**
