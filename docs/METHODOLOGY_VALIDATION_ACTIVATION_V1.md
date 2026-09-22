# Methodology Validation & Activation V1

## Purpose

Methodology Validation & Activation V1 is the governed handoff from a candidate universe methodology to an authoritative, immutable production screening run.

It does **not** change screening scores, weights, thresholds, sector evidence ceilings, or taxonomy. It governs the already-reviewed stack:

1. `solpient-universe-sector-model-v2.3`
2. `solpient-sector-evidence-model-v2.1`
3. `solpient-universe-screen-v2.3`
4. `research-candidate-pipeline-v2.3`

## Full-universe activation gate

The validation bundle is computed from the exact universe input that will be screened.

Activation requires:

- zero Universe QA blocker findings
- zero obvious operating-company Unknown classifications
- zero untracked unresolved classifications
- a nonempty deep-research shortlist
- a configurable minimum universe size (default 1,000 issuers)
- explicit acknowledgement of nonblocking QA review items

A nonzero `review_required` classification queue is permitted. Those names remain evidence-capped and cannot auto-promote.

The bundle receives a deterministic SHA-256 validation hash.

## Required methodology evidence

The orchestrator records required Methodology Registry validation evidence according to the existing governance manifest rules.

The stack receives:

- unit tests
- production build
- historical-integrity evidence
- methodology regression evidence where required
- live database invariant evidence where required
- explicit manual review for the capital-decision candidate pipeline

No required validation is silently waived.

## Activation lifecycle

For each target methodology, activation is append-only:

`registered → candidate → validated → active`

After the new version becomes active, an older active version with the same methodology key is appended as `superseded`.

Historical events are never updated or deleted.

## Materialization gate

`scripts/run-universe-screen.mjs` now behaves differently by mode.

### Dry run

A dry run:

- computes the screen
- computes the validation gate
- shows the validation hash and blocker/review state
- never writes to Supabase
- does not require active methodologies

### Materialization

A non-dry run refuses to write unless:

- the full input validation bundle is activation-ready
- all exact screen-time methodologies are registered and `active`:
  - Sector Model V2.3
  - Sector Evidence V2.1
  - Universe Screen V2.3

The immutable `universe_screen_runs.metadata` records:

- validation hash
- QA version/status
- QA blocker/review counts
- classification review/unresolved/obvious-Unknown counts
- exact active methodology stack
- activation framework version

This permanently ties the first Solpient screen to the methodology state that produced it.

## Local workflow

### 1. Preview validation

```bash
node scripts/validate-activate-universe-methodologies.mjs \
  --input=data/universe/sec-us-screening-full-v2.json \
  --limit=100 \
  --min-input-count=1000 \
  --acknowledge-review-items \
  --output=data/universe/methodology-validation-v1.json
```

Review the output before activation.

### 2. Activate the governed stack

Activation additionally requires a live DB-invariant evidence reference and explicit manual approval:

```bash
node scripts/validate-activate-universe-methodologies.mjs \
  --input=data/universe/sec-us-screening-full-v2.json \
  --limit=100 \
  --min-input-count=1000 \
  --acknowledge-review-items \
  --approve-manual-review \
  --db-invariant-evidence="live-db-invariants-verified" \
  --activate
```

### 3. Materialize the first immutable screen

```bash
node scripts/run-universe-screen.mjs \
  --input=data/universe/sec-us-screening-full-v2.json \
  --limit=100 \
  --acknowledge-review-items
```

The script refuses to materialize if the exact methodology stack is not active.

## Safety

- Candidate score is still not final Solpient 100 membership.
- Final membership still requires review.
- Review-required taxonomy names remain blocked from automated candidate promotion.
- Re-running identical materialization input is idempotent through the existing `input_hash` uniqueness constraint.
- Historical V1/V2/V2.1/V2.2 engines and prior governance events remain immutable.
