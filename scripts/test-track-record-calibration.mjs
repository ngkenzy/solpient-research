import assert from "node:assert/strict";
import {
  TRACK_RECORD_METHODOLOGY_VERSION,
  verificationState,
  numericForecastObservation,
  probabilityForecastObservation,
  calibrationBuckets,
  expectedCalibrationError,
  aggregateTrackRecord,
  buildTrackRecordScopes,
  sampleGrade,
  publicTrackRecordSummary,
} from "../lib/track-record-calibration.mjs";

assert.equal(sampleGrade(0),"insufficient");
assert.equal(sampleGrade(5),"emerging");
assert.equal(sampleGrade(20),"meaningful");
assert.equal(sampleGrade(50),"robust");

const base={
  locked_at:"2026-01-01T00:00:00Z",
  realized_outcome_id:"r1",
  source_note:"verified source",
};
assert.equal(verificationState(base),"verified");
assert.equal(verificationState({...base,locked_at:null}),"unverified_snapshot");
assert.equal(verificationState({...base,realized_outcome_id:null}),"unresolved");
assert.equal(verificationState({...base,source_note:null,source_url:null}),"weak_lineage");

const num=numericForecastObservation({
  predicted_value:100,
  actual_value:110,
  predicted_low:95,
  predicted_high:115,
});
assert.equal(num.signed_error,10);
assert.equal(num.absolute_error,10);
assert.ok(Math.abs(num.absolute_percentage_error-9.090909)<1e-5);
assert.equal(num.interval_hit,true);

const prob=probabilityForecastObservation({
  predicted_probability:80,
  actual_value:1,
});
assert.ok(Math.abs(prob.brier-.04)<1e-12);
assert.equal(prob.class_correct,true);
assert.ok(prob.log_loss>0);

const rows=[
  {predicted_probability:10,actual_value:0},
  {predicted_probability:20,actual_value:0},
  {predicted_probability:70,actual_value:1},
  {predicted_probability:90,actual_value:1},
];
const buckets=calibrationBuckets(rows);
assert.equal(buckets.reduce((s,b)=>s+b.sample_size,0),4);
assert.ok(expectedCalibrationError(buckets)>=0);

const verifiedRows=[
  {
    ...base,
    prediction_outcome_id:"o1",
    company_id:"c1",model_version:"m1",horizon_months:12,outcome_type:"fundamental",metric_key:"revenue",
    predicted_value:100,actual_value:110,predicted_low:90,predicted_high:115,
    snapshot_confidence:70,
  },
  {
    ...base,
    realized_outcome_id:"r2",
    prediction_outcome_id:"o2",
    company_id:"c1",model_version:"m1",horizon_months:12,outcome_type:"relative_return",metric_key:"relative_return_pct",
    predicted_value:5,actual_value:8,benchmark_excess_return:8,
    snapshot_confidence:80,direction_correct:true,
  },
  {
    ...base,
    realized_outcome_id:"r3",
    prediction_outcome_id:"o3",
    company_id:"c2",model_version:"m2",horizon_months:6,outcome_type:"relative_return",metric_key:"prob_outperform_benchmark",
    predicted_probability:75,actual_value:1,
    snapshot_confidence:75,direction_correct:true,
  },
  {
    ...base,
    realized_outcome_id:"r4",
    prediction_outcome_id:"o4",
    company_id:"c2",model_version:"m2",horizon_months:6,outcome_type:"relative_return",metric_key:"prob_outperform_benchmark",
    predicted_probability:80,actual_value:0,
    snapshot_confidence:80,direction_correct:false,
  },
];

const summary=aggregateTrackRecord(verifiedRows);
assert.equal(summary.methodology_version,TRACK_RECORD_METHODOLOGY_VERSION);
assert.equal(summary.verified_sample_size,4);
assert.equal(summary.sample_grade,"insufficient");
assert.equal(summary.numeric.sample_size,2);
assert.equal(summary.direction.sample_size,3);
assert.ok(Math.abs(summary.direction.accuracy-66.67)<0.01);
assert.equal(summary.probability.sample_size,2);
assert.ok(summary.probability.brier_score>0);
assert.equal(summary.benchmark_relative.sample_size,1);
assert.equal(summary.benchmark_relative.benchmark_win_rate,100);

const scopes=buildTrackRecordScopes(verifiedRows);
assert.ok(scopes.find(s=>s.scope_type==="global"&&s.scope_key==="all"));
assert.ok(scopes.find(s=>s.scope_type==="company"&&s.scope_key==="c1"));
assert.ok(scopes.find(s=>s.scope_type==="model"&&s.scope_key==="m2"));
assert.ok(scopes.find(s=>s.scope_type==="horizon"&&s.scope_key==="12"));
assert.ok(scopes.find(s=>s.scope_type==="metric"&&s.scope_key==="revenue"));

const pub=publicTrackRecordSummary(summary);
assert.equal(pub.sample_size,4);
assert.match(pub.caveat,/Insufficient verified history/i);

// Corrections/weak lineage rows are not allowed to inflate verified samples.
const mixed=aggregateTrackRecord([
  ...verifiedRows,
  {
    locked_at:"2026-01-01T00:00:00Z",
    realized_outcome_id:"r5",
    predicted_value:100,actual_value:100,
    source_note:null,source_url:null,
  },
  {
    locked_at:null,
    realized_outcome_id:"r6",
    predicted_value:100,actual_value:100,
    source_note:"source",
  },
]);
assert.equal(mixed.verified_sample_size,4);
assert.equal(mixed.weak_lineage_count,1);
assert.equal(mixed.unverified_snapshot_count,1);

// Percentage error uses ACTUAL in denominator, independent of legacy stored score conventions.
const denom=numericForecastObservation({predicted_value:80,actual_value:100});
assert.equal(denom.absolute_percentage_error,20);

console.log("Verified track record calibration tests passed.");
