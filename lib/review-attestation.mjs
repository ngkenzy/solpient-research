import { canonicalSha256 } from "./integrity-hash.mjs";

export const REVIEW_ATTESTATION_VERSION = "human-review-attestation-v1";

export function buildHumanReviewAttestation({ draft, payload }) {
  const artifact = {
    attestation_version: REVIEW_ATTESTATION_VERSION,
    draft_id: draft?.id ?? null,
    company_id: draft?.company_id ?? null,
    generation_version: draft?.generation_version ?? null,
    source_cutoff_at: draft?.source_cutoff_at ?? null,
    merged_review_payload: payload ?? {},
  };
  return {
    version: REVIEW_ATTESTATION_VERSION,
    payload_hash: canonicalSha256(artifact),
    artifact,
  };
}

export function validateHumanReviewAttestation({ draft, review, payload }) {
  const expected = buildHumanReviewAttestation({ draft, payload });
  const storedHash = String(review?.human_verified_payload_hash ?? "").toLowerCase();
  const version = review?.attestation_version ?? null;
  const verifiedAt = review?.human_verified_at ?? null;
  const verifiedBy = review?.human_verified_by ?? null;

  const reasons = [];
  if (!verifiedAt) reasons.push("Human verification timestamp is missing.");
  if (!verifiedBy) reasons.push("Human verifier identity is missing.");
  if (version !== REVIEW_ATTESTATION_VERSION) reasons.push("Human review attestation version is missing or stale.");
  if (!storedHash || storedHash !== expected.payload_hash) reasons.push("The reviewed payload changed after human verification.");

  return {
    valid: reasons.length === 0,
    reasons,
    expected_payload_hash: expected.payload_hash,
    stored_payload_hash: storedHash || null,
    verified_at: verifiedAt,
    verified_by: verifiedBy,
    version,
  };
}
