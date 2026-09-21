import assert from "node:assert/strict";
import {
  sourceQualityClass,
  selectCanonicalObservation,
  buildNormalizedFact,
  latestFactAsOf,
  assertManifestCutoff,
  manifestHash,
  derivedFormulaForMetric,
} from "../lib/evidence-provenance.mjs";

assert.equal(sourceQualityClass({
  provider:"sec_companyfacts",sourceType:"10-K",url:"https://www.sec.gov/example",basis:"reported"
}),"primary_regulatory");
assert.equal(sourceQualityClass({provider:"fmp",sourceType:"structured",basis:"reported"}),"structured_provider");
assert.equal(sourceQualityClass({provider:"solpient",sourceType:"calculation",basis:"derived"}),"derived_calculation");
assert.equal(sourceQualityClass({provider:"solpient_analyst",basis:"assumption"}),"analyst_assumption");

const primary={
  id:"00000000-0000-0000-0000-000000000001",
  source_id:"00000000-0000-0000-0000-000000000011",
  provider:"sec_companyfacts",source_quality_class:"primary_regulatory",
  raw_value_numeric:100,raw_value_text:null,unit:"USD",
  known_at:"2026-02-19T12:00:00.000Z",economic_period_end:"2025-12-31",
};
const secondary={
  id:"00000000-0000-0000-0000-000000000002",
  source_id:"00000000-0000-0000-0000-000000000012",
  provider:"fmp",source_quality_class:"structured_provider",
  raw_value_numeric:112,raw_value_text:null,unit:"USD",
  known_at:"2026-02-20T12:00:00.000Z",economic_period_end:"2025-12-31",
};
const resolution=selectCanonicalObservation([secondary,primary]);
assert.equal(resolution.selected.id,primary.id);
assert.equal(resolution.conflict_state,"conflicting");
assert.equal(resolution.conflicting.length,1);
assert.equal(resolution.confidence_metadata.material_conflict,true);

const supporting={...secondary,id:"00000000-0000-0000-0000-000000000003",raw_value_numeric:101};
const verified=selectCanonicalObservation([primary,supporting]);
assert.equal(verified.conflict_state,"verified");
assert.equal(verified.supporting.length,1);

const factA={
  id:"fact-a",metric_key:"revenue",economic_period_end:"2025-12-31",
  known_at:"2026-02-19T12:00:00.000Z",conflict_state:"verified",value_numeric:100
};
const factB={
  id:"fact-b",metric_key:"revenue",economic_period_end:"2025-12-31",
  known_at:"2026-03-02T12:00:00.000Z",conflict_state:"verified",value_numeric:112
};
assert.equal(latestFactAsOf([factA,factB],"2026-02-20T00:00:00.000Z").id,"fact-a");
assert.equal(latestFactAsOf([factA,factB],"2026-03-03T00:00:00.000Z").id,"fact-b");

const derivedObs={
  id:"00000000-0000-0000-0000-000000000004",
  source_id:"00000000-0000-0000-0000-000000000014",
  provider:"solpient",source_quality_class:"derived_calculation",
  raw_value_numeric:10,raw_value_text:null,unit:"percent",
  known_at:"2026-02-19T12:05:00.000Z",economic_period_end:"2025-12-31",
};
const derived=buildNormalizedFact({
  companyId:"00000000-0000-0000-0000-000000000099",
  metricKey:"fcf_margin",unit:"percent",economicPeriodEnd:"2025-12-31",
  economicPeriodType:"fiscal_year",observations:[derivedObs],
  derivationBasis:"Free cash flow / revenue.",
  formulaIdentifier:derivedFormulaForMetric("fcf_margin").formula_identifier,
  calculationEngineVersion:"test-v1",
  calculatedAt:"2026-02-19T12:05:00.000Z",
  inputFactIds:["00000000-0000-0000-0000-000000000021","00000000-0000-0000-0000-000000000022"],
});
assert.equal(derived.fact.formula_identifier,"free_cash_flow_div_revenue_pct_v1");
assert.equal(derived.inputLinks.length,2);
assert.deepEqual(derived.fact.derivation_metadata.input_fact_ids,[
  "00000000-0000-0000-0000-000000000021",
  "00000000-0000-0000-0000-000000000022",
]);

assert.equal(assertManifestCutoff([
  {metric_key:"revenue",known_at:"2026-09-01T11:00:00.000Z"},
],"2026-09-01T12:00:00.000Z"),true);
assert.throws(()=>assertManifestCutoff([
  {metric_key:"revenue",known_at:"2026-09-01T13:00:00.000Z"},
],"2026-09-01T12:00:00.000Z"),/exceeds cutoff/i);

const manifestA={
  manifest_version:"evidence-provenance-v1",
  company_id:"company",
  context_pack_id:"context",
  cutoff_at:"2026-09-01T12:00:00.000Z",
  provenance_status:"complete",
  items:[
    {input_role:"research_metric",module:"universal",metric_key:"fcf_margin",economic_period_end:"2025-12-31",normalized_fact_id:"b"},
    {input_role:"research_metric",module:"universal",metric_key:"revenue",economic_period_end:"2025-12-31",normalized_fact_id:"a"},
  ],
};
const manifestB={...manifestA,items:[...manifestA.items].reverse()};
assert.equal(manifestHash(manifestA),manifestHash(manifestB));

console.log("Evidence provenance tests passed.");
