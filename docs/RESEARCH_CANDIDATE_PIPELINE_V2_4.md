# Research Candidate Pipeline V2.4 Integrity

Research Candidate Pipeline V2.4 does **not** change the economic scoring or readiness thresholds introduced in V2.3. It hardens how a candidate snapshot is selected, evaluated, hashed, and published.

## Contract

A V2.4 materialization must name one immutable `universe_screen_run_id`. It never chooses a screen by "latest".

The evaluation clock is explicit. If `--as-of` is omitted, the selected screen run's immutable `as_of_at` is used. The pipeline engine receives that timestamp directly, so research-freshness gates cannot silently change because the command was run at a different wall-clock time.

Only point-in-time evidence available no later than the evaluation timestamp is eligible:

- published research runs
- reviewed Valuation V3 input packs
- Coverage V2 reports
- reviewed scores tied to the selected research run

A reviewed valuation pack tied to a different universe-screen result is not reused. A pack may be reused when it is either tied to the selected result or intentionally screen-agnostic.

## Source provenance

Every candidate gets a canonical source snapshot and SHA-256 hash covering:

- selected screen-result identity and immutable result hash
- canonical company identity, when onboarded
- selected research run
- reviewed scores
- Coverage V2 snapshot
- reviewed valuation input pack and valuation input
- deterministic evaluation timestamp

The pipeline-run input hash binds all 100 source-snapshot hashes, the selected screen-run hashes, methodology versions, the active Pipeline V2.4 implementation hash, and the materialization protocol version.

## Atomic publication

Large JSON payloads are transported through service-role-only staging tables in bounded chunks.

Publication has three steps:

1. begin or resume an idempotent staging session
2. stage bounded candidate-item chunks
3. finalize in one PostgreSQL transaction

The final transaction verifies:

- the selected screen run still exists and matches its immutable hashes
- the deep-research count matches the staged candidate count
- every staged item belongs to the selected deep-research shortlist
- Pipeline V2.4 is the active registered implementation
- all ordinals are present
- stage-count summaries match the inserted items

Only after those checks pass are the immutable pipeline-run row and every candidate item inserted. A transport or item failure before finalization can leave only ephemeral staging data, not a partial immutable pipeline run.

## Activation

V2.4 requires the exact active dependencies:

- `solpient-universe-screen-v2.3`
- `solpient-valuation-methodology-v3`
- `readiness-v1`

Activation requires passing evidence for unit tests, build, database invariants, historical integrity, and manual review on one exact commit and implementation hash. Activation and supersession of the prior pipeline version occur in one database transaction.

## First production run

The first production V2.4 materialization should bind to Solpient immutable Universe Screen Run #1 rather than a moving "latest" selector.
