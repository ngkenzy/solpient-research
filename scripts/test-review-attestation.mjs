import assert from "node:assert/strict";
import { REVIEW_ATTESTATION_VERSION, buildHumanReviewAttestation, validateHumanReviewAttestation } from "../lib/review-attestation.mjs";

const draft={id:"11111111-1111-1111-1111-111111111111",company_id:"22222222-2222-2222-2222-222222222222",generation_version:"baseline-v-test",source_cutoff_at:"2026-09-22T12:00:00.000Z"};
const payload={research:{summary:"Reviewed summary",status:"draft"},scores:{overall_score:88,quality_score:91},thesis_variables:[{variable_name:"FCF durability",status:"unchanged"}]};
const attestation=buildHumanReviewAttestation({draft,payload});
assert.equal(attestation.version,REVIEW_ATTESTATION_VERSION);
assert.match(attestation.payload_hash,/^[0-9a-f]{64}$/);
const reordered={thesis_variables:[{status:"unchanged",variable_name:"FCF durability"}],scores:{quality_score:91,overall_score:88},research:{status:"draft",summary:"Reviewed summary"}};
assert.equal(buildHumanReviewAttestation({draft,payload:reordered}).payload_hash,attestation.payload_hash);
const review={human_verified_at:"2026-09-22T12:30:00.000Z",human_verified_by:"authorized-reviewer",human_verified_payload_hash:attestation.payload_hash,attestation_version:REVIEW_ATTESTATION_VERSION};
assert.equal(validateHumanReviewAttestation({draft,review,payload}).valid,true);
const changed=structuredClone(payload); changed.scores.overall_score=89;
const stale=validateHumanReviewAttestation({draft,review,payload:changed});
assert.equal(stale.valid,false);
assert.ok(stale.reasons.some(x=>x.includes("changed after human verification")));
assert.equal(validateHumanReviewAttestation({draft,review:{},payload}).valid,false);
console.log("Human review attestation tests passed.");
