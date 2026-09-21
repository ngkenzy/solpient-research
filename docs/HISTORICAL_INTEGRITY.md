# Historical Integrity

Solpient Phase 1 establishes a database-enforced historical record for published research, predictions, realized outcomes, and ranking snapshots.

## Authoritative research publication path

Normal research publication is:

```text
Verified evidence
→ Baseline Draft
→ Historical / Peer Context Pack
→ Research Composition
→ Human Review
→ Research Standard v2 validation
→ publish_reviewed_research_v2()
→ immutable published package
```

The reviewed V2 workbench is the only normal production publication path.

`scripts/import-research.mjs` is retained for historical compatibility and validation, but direct publishing is quarantined. The legacy GitHub workflow is manual and validation-only. Database guards also reject ordinary direct inserts of published research.

## What becomes immutable

A published `research_runs` row is the immutable root of a research package. Once its status is `published`, the root and the following children cannot be updated or deleted:

- `financial_metrics`
- `scores`
- `valuations`
- `business_assessments`
- `metric_observations`
- `risk_register`
- `expected_return_scenarios`
- `thesis_variables`
- `sources`
- `research_v2_sections`
- `research_changes`

Drafts, reviews, enrichment records, context packs, and compositions remain mutable before publication.

Historical predictions are locked at `prediction_snapshots.locked_at`. The forecast snapshot cannot be updated or deleted after lock. Its predicted outcomes cannot be inserted or deleted after lock, and only resolver metadata on a predicted outcome may change later:

- `resolver_status`
- `resolved_at`
- `resolution_note`

The forecast values themselves remain immutable.

`realized_outcomes`, `prediction_scores`, `ranking_history`, and `ranking_explanations` are append-only ledgers. They cannot be updated or deleted.

Foreign keys linking these historical records use `RESTRICT` rather than destructive cascades, so deleting a company, research version, prediction, or ranking cannot silently erase its historical evidence.

## Corrections and supersession

A correction never edits the original record.

The minimal correction model is carried by immutable root/ledger rows:

- `research_runs.supersedes_id`
- `prediction_snapshots.supersedes_id`
- `realized_outcomes.supersedes_id`
- `ranking_history.supersedes_id`

A correction also records `correction_reason` and `corrected_at`.

The corrected record points backward to the record it supersedes. The original row is never updated to add a forward pointer. The current authoritative interpretation is therefore the newest row in the correction chain; the complete chain remains queryable.

Research child rows do not each receive correction fields. They belong to the corrected research version as one immutable package.

## Transaction boundary

`public.publish_reviewed_research_v2(...)` is the authoritative database transaction.

It locks the draft/review/company state, verifies an applied composition, verifies review readiness and V2 publication metadata, checks for a stale concurrent publication, then writes:

1. the research root;
2. every versioned child table;
3. material research changes;
4. the draft promotion state; and
5. the review promotion state.

A PostgreSQL function call is one transaction. If any child insert fails, the function raises and none of the publication writes persist.

This replaces application-side “insert children, then delete the parent on error” cleanup.

Prediction locking follows the same principle through `public.publish_prediction_package_v1(...)`, which creates the snapshot and all predicted outcomes atomically.

## Integrity hashes

New reviewed research versions persist SHA-256 digests for:

- evidence/source package
- normalized research inputs
- valuation/model inputs
- research composition
- complete published output

Application-side hashes use deterministic canonical serialization defined by `lib/integrity-hash.mjs`:

- recursively sorted object keys;
- stable JSON serialization;
- array order preserved;
- non-finite numbers normalized to `null`.

The canonicalization version and hash algorithm are stored with each publication.

Research versions also preserve:

- publication engine version
- methodology version
- research cutoff date
- publication timestamp
- source draft/review/composition IDs

Prediction and ranking snapshots store integrity hashes and methodology/model identifiers as well.

Hashes prove whether a later payload matches the stored publication payload. They are not signatures and contain no secrets.

## Prediction history

A prediction is not considered locked until the atomic prediction publication function commits.

After lock:

- `predicted_at` cannot change;
- model/version metadata cannot change;
- forecast values cannot change;
- predicted outcomes cannot be removed;
- later realized outcomes are separate append-only records.

If a realized outcome was wrong, a new `realized_outcomes` row supersedes it. The original observation remains preserved.

Prediction scores are also append-only. A changed scoring methodology therefore creates a new score record rather than rewriting a historical score.

## Ranking history

Each new ranking snapshot stores `methodology_version` and an integrity hash.

Historical rank, score, price, and fair value cannot be rewritten when future scoring logic changes. If a historical ranking row itself needs a factual correction, a new ranking row supersedes the original.

## Privilege and trigger boundary

RLS remains enabled, but Phase 1 does not rely on RLS for immutability because the service role bypasses RLS.

The migration:

- revokes ordinary historical-table writes from `anon` and `authenticated`;
- restricts service-role writes to append-only operations actually needed by automations;
- allows reviewed research/prediction creation through narrowly granted RPCs;
- enforces immutability through PostgreSQL triggers, which still fire for service-role writes.

The RPCs are `SECURITY DEFINER`, have an empty `search_path`, and are not executable by `PUBLIC`, `anon`, or `authenticated`.

## Legacy history

Rows created before this migration have an important limitation.

Existing prediction and ranking rows are sealed and hashed at migration time. Their legacy hash proves their state **when Phase 1 sealed them**, not that the row had never been changed before Phase 1.

Existing published research versions remain preserved and become immutable when the migration is applied, but Phase 1 does not fabricate publication hashes for historical research packages whose exact original canonical inputs cannot be reconstructed safely.

Accordingly:

- legacy research may have null integrity metadata;
- new reviewed V2 publications have full integrity metadata;
- legacy prediction/ranking rows use `legacy-sealed-v1` where appropriate.

This distinction must remain visible in audit tooling and must not be represented as retroactive cryptographic proof.

## Verification

Deterministic application tests cover canonical hashes and publication package hashing.

`supabase/tests/historical_integrity.sql` is a transactional database integration test that verifies:

- published research UPDATE is rejected;
- published research DELETE is rejected;
- a successful publication writes the complete package;
- a failed publication leaves no partial research run;
- research correction preserves the original;
- locked prediction UPDATE/DELETE are rejected;
- ranking UPDATE/DELETE are rejected;
- ranking correction preserves the original.

The integration fixture ends with `ROLLBACK` and does not retain test data.
