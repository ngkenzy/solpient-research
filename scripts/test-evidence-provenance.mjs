import assert from "node:assert/strict";
import {
  sourceQualityClass,
  selectCanonicalObservation,
  buildNormalizedFact,
  latestFactAsOf,
  assertManifestCutoff,
  manifestHash,
  derivedFormulaForMetric,
  alignImmutableFactChain,
} from "../lib/evidence-provenance.mjs";

assert.equal(sourceQualityClass({
  provider:"sec_companyfacts",sourceType:"10-K",url:"https://www.sec.gov/example",basis:"reported"
}),"primary_regulatory");
assert.equal(sourceQualityClass({provider:"fmp",sourceType:"structured",basis:"reported"}),"structured_provider");
assert.equal(sourceQualityClass({provider:"fmp",sourceType:"10-K",url:"https://financialmodelingprep.com/example",basis:"reported"}),"structured_provider");
assert.equal(sourceQualityClass({provider:"yahoo_fundamentals",sourceType:"10-Q",url:"https://query1.finance.yahoo.com/example",basis:"reported"}),"structured_provider");
assert.equal(sourceQualityClass({provider:"unknown",sourceType:"10-K",url:"https://example.com/filing",basis:"reported"}),"verified_secondary");
assert.equal(sourceQualityClass({provider:"company_ir",sourceType:"company filing",url:"https://example.com/investor-relations/filing",basis:"reported"}),"company_direct");

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

const sameProviderRevision={
  ...primary,
  id:"00000000-0000-0000-0000-000000000005",
  source_id:"00000000-0000-0000-0000-000000000015",
  raw_value_numeric:112,
  known_at:"2026-03-02T12:00:00.000Z",
};
const revised=selectCanonicalObservation([primary,sameProviderRevision]);
assert.equal(revised.selected.id,sameProviderRevision.id);
assert.equal(revised.conflict_state,"verified");
assert.equal(revised.conflicting.length,0);
assert.equal(revised.superseded.length,1);
assert.equal(revised.superseded[0].id,primary.id);
assert.equal(revised.confidence_metadata.independent_provider_count,1);

const reviewedResolution=selectCanonicalObservation([secondary,primary],{
  preferredObservationId:secondary.id,
  resolutionReason:"Human review accepted the licensed provider after reconciling the filing presentation.",
});
assert.equal(reviewedResolution.selected.id,secondary.id);
assert.equal(reviewedResolution.conflict_state,"verified");
assert.equal(reviewedResolution.confidence_metadata.conflict_resolved,true);
assert.match(reviewedResolution.selection_reason,/Explicit reviewed source-selection override/);

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
assert.equal(derived.fact.created_at,derived.fact.known_at);
assert.equal(derived.observationLinks.every((row)=>row.created_at===derived.fact.known_at),true);
assert.equal(derived.inputLinks.length,2);
assert.equal(derived.inputLinks.every((row)=>row.created_at===derived.fact.known_at),true);
assert.deepEqual(derived.fact.derivation_metadata.input_fact_ids,[
  "00000000-0000-0000-0000-000000000021",
  "00000000-0000-0000-0000-000000000022",
]);

const derivedRepeat=buildNormalizedFact({
  companyId:"00000000-0000-0000-0000-000000000099",
  metricKey:"fcf_margin",unit:"percent",economicPeriodEnd:"2025-12-31",
  economicPeriodType:"fiscal_year",observations:[derivedObs],
  derivationBasis:"Free cash flow / revenue.",
  formulaIdentifier:derivedFormulaForMetric("fcf_margin").formula_identifier,
  calculationEngineVersion:"test-v1",
  calculatedAt:"2026-02-19T12:05:00.000Z",
  inputFactIds:["00000000-0000-0000-0000-000000000021","00000000-0000-0000-0000-000000000022"],
});
assert.equal(derivedRepeat.fact.fact_key,derived.fact.fact_key);
assert.equal(derivedRepeat.fact.id,derived.fact.id);
assert.match(derived.fact.id,/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

assert.equal(assertManifestCutoff([
  {metric_key:"revenue",known_at:"2026-09-01T11:00:00.000Z"},
],"2026-09-01T12:00:00.000Z"),true);
assert.throws(()=>assertManifestCutoff([
  {metric_key:"revenue",known_at:"2026-09-01T13:00:00.000Z"},
],"2026-09-01T12:00:00.000Z"),/exceeds cutoff/i);

const chainRoot={
  id:"00000000-0000-0000-0000-000000000031",
  known_at:"2026-09-20T19:10:36.601Z",
  supersedes_fact_id:null,
};
const chainSuccessor={
  id:"00000000-0000-0000-0000-000000000032",
  known_at:"2026-09-21T20:47:18.611Z",
  supersedes_fact_id:chainRoot.id,
};
const chainFacts=[chainRoot,chainSuccessor];
const chainSuccessors=new Map([[chainRoot.id,chainSuccessor]]);

const sameTimestampAlignment=alignImmutableFactChain({
  previousFactId:chainRoot.id,
  eventTime:chainSuccessor.known_at,
  existingGroupFacts:chainFacts,
  successorByFactId:chainSuccessors,
});
assert.equal(sameTimestampAlignment.previousFactId,chainSuccessor.id);
assert.equal(sameTimestampAlignment.skipEvent,true);
assert.equal(
  sameTimestampAlignment.reason,
  "immutable_fact_already_exists_at_event_time"
);

const futureAppendAlignment=alignImmutableFactChain({
  previousFactId:chainRoot.id,
  eventTime:"2026-09-22T08:28:03.299Z",
  existingGroupFacts:chainFacts,
  successorByFactId:chainSuccessors,
});
assert.equal(futureAppendAlignment.previousFactId,chainSuccessor.id);
assert.equal(futureAppendAlignment.skipEvent,false);

const backfillAlignment=alignImmutableFactChain({
  previousFactId:chainRoot.id,
  eventTime:"2026-09-21T10:00:00.000Z",
  existingGroupFacts:chainFacts,
  successorByFactId:chainSuccessors,
});
assert.equal(backfillAlignment.previousFactId,chainRoot.id);
assert.equal(backfillAlignment.skipEvent,true);
assert.equal(
  backfillAlignment.reason,
  "future_successor_blocks_retroactive_branch"
);

const beforeRootAlignment=alignImmutableFactChain({
  previousFactId:null,
  eventTime:"2026-09-19T10:00:00.000Z",
  existingGroupFacts:chainFacts,
  successorByFactId:chainSuccessors,
});
assert.equal(beforeRootAlignment.previousFactId,null);
assert.equal(beforeRootAlignment.skipEvent,true);
assert.equal(
  beforeRootAlignment.reason,
  "future_root_blocks_retroactive_branch"
);

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
