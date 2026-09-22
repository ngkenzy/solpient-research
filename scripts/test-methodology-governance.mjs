import assert from "node:assert/strict";
import fs from "node:fs";
import {
  LIFECYCLE,
  validateManifest,
  validateCatalog,
  manifestHash,
  requiredValidations,
  assessActivationReadiness,
  deriveLifecycle,
  canTransition,
  diffMethodologies,
} from "../lib/methodology-governance.mjs";

const catalog=JSON.parse(fs.readFileSync(new URL("../methodologies/catalog.json",import.meta.url),"utf8"));
const validation=validateCatalog(catalog.methodologies);
assert.equal(validation.valid,true,validation.errors.join("\n"));
assert.equal(validation.manifests.length,20);
assert.ok(validation.manifests.some(m=>m.version==="decision-ranking-v1"));
assert.ok(validation.manifests.some(m=>m.version==="context-v2-provenance"));
assert.ok(validation.manifests.some(m=>m.version==="evidence-provenance-v1"));
assert.ok(validation.manifests.some(m=>m.version==="canonical-fact-v1"));
assert.ok(validation.manifests.some(m=>m.version==="research-candidate-pipeline-v1"));
assert.ok(validation.manifests.some(m=>m.version==="research-candidate-pipeline-v2"));
assert.ok(validation.manifests.some(m=>m.version==="research-candidate-pipeline-v2.1"));
assert.ok(validation.manifests.some(m=>m.version==="research-candidate-pipeline-v2.2"));
assert.ok(validation.manifests.some(m=>m.version==="solpient-universe-sector-model-v2"));
assert.ok(validation.manifests.some(m=>m.version==="solpient-universe-sector-model-v2.2"));
assert.ok(validation.manifests.some(m=>m.version==="solpient-sector-evidence-model-v2.1"));
assert.ok(validation.manifests.some(m=>m.version==="solpient-universe-screen-v1"));
assert.ok(validation.manifests.some(m=>m.version==="solpient-universe-screen-v2"));
assert.ok(validation.manifests.some(m=>m.version==="solpient-universe-screen-v2.1"));
assert.ok(validation.manifests.some(m=>m.version==="solpient-universe-screen-v2.2"));
assert.ok(validation.manifests.some(m=>m.version==="solpient-valuation-methodology-v3"));

const decision=validation.manifests.find(m=>m.version==="decision-ranking-v1");
const decisionCheck=validateManifest(decision);
assert.equal(decisionCheck.valid,true);
assert.match(manifestHash(decision),/^[0-9a-f]{64}$/);

const required=requiredValidations(decision);
assert.deepEqual(required,[
  "build",
  "db_invariant",
  "historical_integrity",
  "manual_review",
  "methodology_regression",
  "unit_tests",
]);

const notReady=assessActivationReadiness(decision,[
  {validation_type:"unit_tests",status:"pass",validated_at:"2026-09-21T10:00:00Z"},
  {validation_type:"build",status:"pass",validated_at:"2026-09-21T10:01:00Z"},
]);
assert.equal(notReady.ready,false);
assert.ok(notReady.missing.includes("manual_review"));
assert.ok(notReady.missing.includes("db_invariant"));
assert.ok(notReady.missing.includes("methodology_regression"));

const ready=assessActivationReadiness(decision,[
  {validation_type:"unit_tests",status:"pass",validated_at:"2026-09-21T10:00:00Z"},
  {validation_type:"build",status:"pass",validated_at:"2026-09-21T10:01:00Z"},
  {validation_type:"db_invariant",status:"pass",validated_at:"2026-09-21T10:02:00Z"},
  {validation_type:"historical_integrity",status:"pass",validated_at:"2026-09-21T10:02:30Z"},
  {validation_type:"manual_review",status:"pass",validated_at:"2026-09-21T10:03:00Z"},
  {validation_type:"methodology_regression",status:"pass",validated_at:"2026-09-21T10:04:00Z"},
]);
assert.equal(ready.ready,true);
assert.equal(ready.missing.length,0);

const blockedByLatestFailure=assessActivationReadiness(decision,[
  {validation_type:"unit_tests",status:"pass",validated_at:"2026-09-21T10:00:00Z"},
  {validation_type:"unit_tests",status:"fail",validated_at:"2026-09-21T11:00:00Z"},
  {validation_type:"build",status:"pass",validated_at:"2026-09-21T10:01:00Z"},
  {validation_type:"db_invariant",status:"pass",validated_at:"2026-09-21T10:02:00Z"},
  {validation_type:"historical_integrity",status:"pass",validated_at:"2026-09-21T10:02:30Z"},
  {validation_type:"manual_review",status:"pass",validated_at:"2026-09-21T10:03:00Z"},
  {validation_type:"methodology_regression",status:"pass",validated_at:"2026-09-21T10:04:00Z"},
]);
assert.equal(blockedByLatestFailure.ready,false);
assert.deepEqual(blockedByLatestFailure.failed,["unit_tests"]);

assert.equal(canTransition("registered","candidate"),true);
assert.equal(canTransition("candidate","active"),false);
assert.equal(canTransition("validated","active"),true);
assert.equal(canTransition("active","superseded"),true);
assert.equal(canTransition("retired","active"),false);

assert.equal(deriveLifecycle([
  {id:"1",event_type:LIFECYCLE.REGISTERED,effective_at:"2026-09-20T00:00:00Z"},
  {id:"2",event_type:LIFECYCLE.CANDIDATE,effective_at:"2026-09-20T01:00:00Z"},
  {id:"3",event_type:LIFECYCLE.VALIDATED,effective_at:"2026-09-20T02:00:00Z"},
  {id:"4",event_type:LIFECYCLE.ACTIVE,effective_at:"2026-09-20T03:00:00Z"},
]),LIFECYCLE.ACTIVE);

const changedWeights=JSON.parse(JSON.stringify(decision));
changedWeights.version="decision-ranking-v2";
changedWeights.predecessor_version="decision-ranking-v1";
changedWeights.weights.decision_score={business_quality:50,investment_opportunity:50};
changedWeights.change_summary="Change top-level decision score weights.";
const diff=diffMethodologies(decision,changedWeights);
assert.equal(diff.changed,true);
assert.equal(diff.materiality,"major");
assert.equal(diff.requiresNewVersion,true);
assert.ok(diff.changes.some(c=>c.field==="weights"));

const documentationOnly=JSON.parse(JSON.stringify(decision));
documentationOnly.name="Decision Ranking V1 renamed";
documentationOnly.change_summary="Documentation-only naming clarification.";
const docDiff=diffMethodologies(decision,documentationOnly);
assert.equal(docDiff.changed,true);
assert.equal(docDiff.materiality,"patch");
assert.equal(docDiff.requiresNewVersion,false);

const selfDependency=JSON.parse(JSON.stringify(decision));
selfDependency.dependencies.push({methodology_key:"decision_ranking",version:"decision-ranking-v1",required:true});
assert.equal(validateManifest(selfDependency).valid,false);

console.log("Methodology governance tests passed.");
