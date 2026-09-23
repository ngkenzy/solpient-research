import assert from "node:assert/strict";
import {
  deriveSolpientLists,
  SOLPIENT_LIST_METHODOLOGY_VERSION,
} from "../lib/solpient-list-engine.mjs";

function candidate(index) {
  return {
    ticker: "T" + String(index).padStart(3, "0"),
    company_id: "c-" + index,
    company_name: "Company " + index,
    shortlist_rank: index,
    universe_rank: index,
    screen_score: 100 - index / 10,
    quality_core_score: 90 - index / 20,
    evidence_coverage_pct: 80,
    stage: index <= 10 ? "decision_ready" : index <= 30 ? "research_ready" : "research_building",
    readiness_state: index <= 10 ? "decision_ready" : index <= 30 ? "research_ready" : "building",
  };
}

function ranking(index, readiness) {
  return {
    company_id: "c-" + index,
    ticker: "T" + String(index).padStart(3, "0"),
    rank: index,
    decision_score: 95 - index / 2,
    business_quality_score: 90,
    investment_opportunity_score: 85,
    evidence_confidence_score: 88,
    readiness_state: readiness,
    readiness_tier: readiness === "decision_ready" ? 3 : readiness === "research_ready" ? 2 : 1,
    price: 100 + index,
    base_fair_value: 130 + index,
    snapshot_hash: "a".repeat(64),
  };
}

{
  const candidates = Array.from({ length: 100 }, (_, i) => candidate(i + 1));
  const rankings = [
    ...Array.from({ length: 10 }, (_, i) => ranking(i + 1, "decision_ready")),
    ...Array.from({ length: 20 }, (_, i) => ranking(i + 11, "research_ready")),
    ...Array.from({ length: 10 }, (_, i) => ranking(i + 31, "building")),
    ranking(999, "decision_ready"),
  ];
  const result = deriveSolpientLists({ candidates, rankings });
  assert.equal(result.methodology_version, SOLPIENT_LIST_METHODOLOGY_VERSION);
  assert.equal(result.solpient_100.length, 100);
  assert.equal(result.solpient_20.length, 20);
  assert.equal(result.solpient_5.length, 5);
  assert.equal(result.complete.solpient_100, true);
  assert.equal(result.complete.solpient_20, true);
  assert.equal(result.complete.solpient_5, true);
  assert.deepEqual(result.solpient_5.map((row) => row.ticker), ["T001","T002","T003","T004","T005"]);
  assert.equal(result.solpient_20.some((row) => row.ticker === "T999"), false);
}

{
  const candidates = Array.from({ length: 100 }, (_, i) => candidate(i + 1));
  const rankings = [
    ...Array.from({ length: 3 }, (_, i) => ranking(i + 1, "decision_ready")),
    ...Array.from({ length: 12 }, (_, i) => ranking(i + 4, "research_ready")),
  ];
  const result = deriveSolpientLists({ candidates, rankings });
  assert.equal(result.solpient_20.length, 15);
  assert.equal(result.solpient_5.length, 3);
  assert.equal(result.complete.solpient_20, false);
  assert.equal(result.complete.solpient_5, false);
}

{
  const candidates = Array.from({ length: 99 }, (_, i) => candidate(i + 1));
  const result = deriveSolpientLists({ candidates, rankings: [] });
  assert.equal(result.complete.solpient_100, false);
}

{
  const candidates = [candidate(1), candidate(1)];
  assert.throws(() => deriveSolpientLists({ candidates, rankings: [] }), /Duplicate Solpient candidate ticker/);
}

console.log("Solpient list engine tests passed.");
