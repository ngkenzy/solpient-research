# Methodology Validation & Activation V1

## Purpose

Methodology Validation & Activation V1 is the governed handoff from a candidate universe methodology to an authoritative, immutable production screening run.

The V1.1 hardening layer does **not** change screening scores, weights, thresholds, sector evidence ceilings, or taxonomy. It governs the already-reviewed stack:

1. `solpient-universe-sector-model-v2.3`
2. `solpient-sector-evidence-model-v2.1`
3. `solpient-universe-screen-v2.3`
4. `research-candidate-pipeline-v2.3`

## Full-universe activation gate

The validation bundle is computed from the exact canonical universe input that will be screened.

Activation requires:

- zero Universe QA blocker findings
- zero obvious operating-company Unknown classifications
- zero untracked unresolved classifications
- a nonempty deep-research shortlist
- a configurable minimum universe size, defaulting to 1,000 issuers
- explicit acknowledgement of nonblocking QA review items
- explicit acknowledgement of the classification review queue
- explicit manual approval for the capital-decision candidate pipeline
- live database invariant evidence
- successful required GitHub Actions for the exact 40-character activation commit SHA
- a clean worktree matching that commit

A nonzero `review_required` classification queue is permitted. Those names remain evidence-capped and cannot auto-promote.

## Cryptographic bindings

V1.1 records three independent SHA-256 identities:

- **validation hash** — the complete activation acceptance/QA/classification bundle
- **universe input hash** — every canonical universe input row, independent of input row ordering
- **implementation hash** — SHA-256 fingerprints of every declared source file for each target methodology

The target methodology definition, validation evidence, VALIDATED event, ACTIVE event, and immutable universe screen metadata are bound to these hashes.

This means a later edit to a V2.3 source file cannot silently continue to operate as the already-activated V2.3 implementation. Production materialization fails closed on implementation drift.

## Exact dependency semantics

Required dependencies are version-pinned.

- External dependencies must have the exact required version in ACTIVE state.
- Methodologies being promoted in the same atomic activation may satisfy one another once they have reached VALIDATED.
- A same-key predecessor used as implementation lineage must be registered, but it is not falsely required to remain the active production version after its successor is promoted.

An unrelated active version of the same methodology key never satisfies an exact dependency.

## Verified CI evidence

Activation no longer self-attests `unit_tests=pass` or `build=pass`.

The activation CLI queries GitHub Actions for the exact commit SHA and requires successful runs for:

- SOLPIENT Build Check
- Methodology Registry Governance
- Universe QA V1
- Solpient 100 Universe Screening
- Research Candidate Pipeline

The verified workflow run IDs are stored in methodology validation evidence.

## Atomic activation lifecycle

Registration and validation remain append-only because a stopped validation should leave a truthful audit trail.

For each target:

`registered → candidate → validated`

Only after **all four target methodologies** are validated does PostgreSQL execute:

`activate_universe_methodology_stack_v1_1(...)`

inside one transaction.

That transaction:

1. rechecks required validation evidence
2. requires immutable implementation hashes
3. activates every validated target
4. supersedes older active versions of the same methodology keys
5. binds every ACTIVE event to the same validation hash, universe input hash, implementation hash, activation version, actor, and commit SHA

If any target fails, no target receives a new ACTIVE event.

## Materialization gate

### Dry run

A dry run:

- computes the screen
- computes the full-universe validation gate
- shows the validation hash and universe input hash
- never writes to Supabase
- does not require active methodologies

The default 1,000-issuer minimum still appears as a failed validation item when a small fixture is used.

### Production materialization

A non-dry run refuses to write unless:

- the input meets the minimum full-universe size
- an explicit `as_of_at` is supplied by the input or `--as-of`
- the exact screen-time methodologies are ACTIVE:
  - Sector Model V2.3
  - Sector Evidence V2.1
  - Universe Screen V2.3
- each active methodology implementation hash matches the current source files
- each ACTIVE event has the same validation hash and universe input hash as the materialization input

Therefore the production screen must use the **same canonical universe and validation bundle that activated the methodology stack**.

## Atomic immutable screen publication

The old materializer wrote `universe_screen_runs` first and then inserted result batches. A later result failure could therefore leave an immutable but incomplete run.

V1.1 replaces that path with:

`publish_universe_screen_package_v1_1(run, results)`

The RPC inserts the run and every result in one PostgreSQL transaction. If any row fails, the complete package rolls back.

The immutable run metadata records:

- validation hash
- universe input hash
- QA version/status
- QA blocker/review counts
- classification review/unresolved/obvious-Unknown counts
- minimum universe size
- exact active methodology stack
- implementation hashes
- activation commit SHAs
- activation framework version
- atomic-publication marker

## Local workflow

### 1. Preview the exact full-universe file

```bash
node scripts/validate-activate-universe-methodologies.mjs \
  --input=data/universe/sec-us-screening-full-v2.json \
  --limit=100 \
  --min-input-count=1000 \
  --acknowledge-review-items \
  --acknowledge-classification-review-queue \
  --output=data/universe/methodology-validation-v1.json
```

Record the printed `validation_hash` and `universe_input_hash`.

### 2. Merge V1.1 and apply its migration

Apply:

`supabase/migrations/20260922032500_methodology_activation_v1_1_hardening.sql`

Do not activate before the migration is present in production.

### 3. Wait for exact-main CI

The merge commit itself must have successful runs for all five required workflows. Activation checks those workflow runs directly.

### 4. Activate the governed stack

From a clean checkout of that exact main commit:

```bash
node scripts/validate-activate-universe-methodologies.mjs \
  --input=data/universe/sec-us-screening-full-v2.json \
  --limit=100 \
  --min-input-count=1000 \
  --acknowledge-review-items \
  --acknowledge-classification-review-queue \
  --approve-manual-review \
  --db-invariant-evidence="docs/validation/UNIVERSE_METHODOLOGY_DB_INVARIANT_2026-09-22.md" \
  --github-repo=ngkenzy/solpient-research \
  --commit-sha="$(git rev-parse HEAD)" \
  --activate
```

### 5. Materialize Screen Run #1 using the same file

```bash
node scripts/run-universe-screen.mjs \
  --input=data/universe/sec-us-screening-full-v2.json \
  --as-of=<EXACT_FEED_TIMESTAMP> \
  --limit=100 \
  --min-input-count=1000 \
  --acknowledge-review-items \
  --acknowledge-classification-review-queue
```

If the file contents, minimum universe size, shortlist limit, methodology implementation, or validation state differs from activation, materialization fails closed.

## Safety

- Candidate score is still not final Solpient 100 membership.
- Final membership still requires review.
- Review-required taxonomy names remain blocked from automated candidate promotion.
- Historical V1/V2/V2.1/V2.2 engines and prior governance events remain immutable.
- Re-running an identical successfully published screen remains idempotent through `input_hash`.
- No V1.1 hardening change alters an investment score, score weight, threshold, evidence ceiling, taxonomy rule, or sector quota.
