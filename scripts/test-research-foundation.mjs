import assert from "node:assert/strict";
import {
  COVERAGE_LEVELS,
  FRESHNESS_STATUS,
  deriveCoverageLevel,
  deriveFreshnessStatus,
  canPersistCoverage,
} from "../lib/research-foundation.mjs";

const day=24*60*60*1000;
const asOf="2026-09-25T12:00:00Z";

assert.equal(
  deriveFreshnessStatus({supported:false,asOf}),
  FRESHNESS_STATUS.NOT_SUPPORTED
);
assert.equal(
  deriveFreshnessStatus({
    evidenceSincePublication:true,
    lastCheckedAt:"2026-09-25T10:00:00Z",
    maxCheckAgeMs:2*day,
    asOf,
  }),
  FRESHNESS_STATUS.NEW_EVIDENCE
);
assert.equal(
  deriveFreshnessStatus({
    invalidated:true,
    lastCheckedAt:"2026-09-25T10:00:00Z",
    maxCheckAgeMs:2*day,
    asOf,
  }),
  FRESHNESS_STATUS.REVIEW_DUE
);
assert.equal(
  deriveFreshnessStatus({
    lastCheckedAt:"2026-09-20T10:00:00Z",
    maxCheckAgeMs:2*day,
    asOf,
  }),
  FRESHNESS_STATUS.STALE
);
assert.equal(
  deriveFreshnessStatus({
    lastCheckedAt:"2026-09-25T10:00:00Z",
    maxCheckAgeMs:2*day,
    asOf,
  }),
  FRESHNESS_STATUS.CURRENT
);
assert.equal(
  deriveFreshnessStatus({
    lastReviewAt:"2026-04-01T00:00:00Z",
    maxReviewAgeMs:90*day,
    asOf,
  }),
  FRESHNESS_STATUS.REVIEW_DUE
);
assert.equal(
  deriveFreshnessStatus({
    maxReviewAgeMs:90*day,
    asOf,
  }),
  FRESHNESS_STATUS.UNKNOWN
);

const empty={};
assert.equal(
  deriveCoverageLevel(empty),
  COVERAGE_LEVELS.UNSUPPORTED,
  "no market data, fundamentals, or filings must derive UNSUPPORTED"
);
assert.equal(
  deriveCoverageLevel({hasMarketData:true}),
  COVERAGE_LEVELS.MONITORED,
  "any single evidence source makes the company at least MONITORED"
);
assert.equal(
  deriveCoverageLevel({hasFundamentals:true}),
  COVERAGE_LEVELS.MONITORED
);
assert.equal(
  deriveCoverageLevel({hasSecFilings:true}),
  COVERAGE_LEVELS.MONITORED
);

const monitored={hasMarketData:true};
assert.equal(deriveCoverageLevel(monitored),COVERAGE_LEVELS.MONITORED);

const researched={
  hasMarketData:true,
  hasPublishedResearch:true,
  hasBusinessAssessment:true,
  thesisVariableCount:4,
  hasValuation:true,
  riskCount:3,
  hasFrozenInputManifest:true,
  publishedResearchVersions:1,
};
assert.equal(deriveCoverageLevel(researched),COVERAGE_LEVELS.RESEARCHED);

const deep={
  ...researched,
  publishedResearchVersions:2,
  lockedPredictionCount:1,
  valuationHistoryCount:24,
  capitalAllocationYears:5,
  requiredFreshComponentsCurrent:6,
  requiredFreshComponentsTotal:6,
};
assert.equal(deriveCoverageLevel(deep),COVERAGE_LEVELS.DEEP_COVERAGE);

assert.equal(
  deriveCoverageLevel({...deep,requiredFreshComponentsCurrent:5}),
  COVERAGE_LEVELS.RESEARCHED,
  "stale required component must downgrade DEEP_COVERAGE"
);

assert.equal(canPersistCoverage(COVERAGE_LEVELS.DEEP_COVERAGE,researched),false);
assert.equal(canPersistCoverage(COVERAGE_LEVELS.RESEARCHED,researched),true);
assert.equal(canPersistCoverage(COVERAGE_LEVELS.UNSUPPORTED,empty),true);
assert.equal(canPersistCoverage(COVERAGE_LEVELS.MONITORED,empty),false);
assert.equal(canPersistCoverage(COVERAGE_LEVELS.UNSUPPORTED,researched),false);
assert.equal(canPersistCoverage("FULL",deep),false);

console.log("Group A research-foundation deterministic tests passed.");
