# Human Review Attestation V1

Human Review Attestation V1 separates **machine preparation** from **human verification** in the private Solpient Research publication workflow.

A generated package may be structurally complete and promotion-ready without having been reviewed by a person. The legacy `reviewed_at` field could be populated by automated preparation paths, so it is no longer sufficient proof of human verification.

V1 adds explicit provenance: `prepared_at`, `preparation_source`, `human_verified_at`, `human_verified_by`, `human_verified_payload_hash`, and `attestation_version`. No legacy row is retroactively marked verified.

## Contract

Evidence → Draft → Composition / automated preparation → Promotion readiness validation → Explicit human verification → Hash exact merged review payload → Deliberate publication → Immutable research version.

The attestation hash binds the draft ID, company ID, baseline generation version, source cutoff, and exact merged review payload. Any subsequent save, composer application, enrichment application, or package rebuild clears the human attestation. The package must then be verified again.

## Enforcement

The web workbench refuses promotion when no explicit human attestation exists, the attestation version is stale, the reviewer identity is absent, or the current merged payload hash differs from the verified hash. The core `promoteReviewedBaseline()` engine performs the same check, so alternate callers cannot bypass the contract.

The authorized GitHub promotion workflow remains supported. Running it with an explicit reviewed patch creates the human attestation in the same deliberate promotion operation and records `GITHUB_ACTOR` as the verifier when available.

## Historical rule

Existing review rows are not backfilled with verification timestamps or hashes. Solpient does not claim historical human-review provenance that it did not record at the time.
