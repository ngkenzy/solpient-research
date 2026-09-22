import assert from "node:assert/strict";
import {
  RESEARCH_FACTORY_VERSION,
  parseSecTickerExchange,
  resolveSecIdentity,
  buildResearchFactoryRunHash,
  buildEvidenceValuationDraft,
  deriveResearchFactoryState,
  buildFactoryStateHash,
} from "../lib/research-factory-v1.mjs";

assert.equal(RESEARCH_FACTORY_VERSION,"research-factory-v1");

const secRows=parseSecTickerExchange({
  fields:["cik","name","ticker","exchange"],
  data:[
    [796343,"ADOBE INC.","ADBE","Nasdaq"],
    [320193,"APPLE INC.","AAPL","Nasdaq"],
  ],
});
assert.equal(secRows[0].cik,"0000796343");
assert.equal(secRows[0].ticker,"ADBE");
assert.equal(secRows[0].exchange,"Nasdaq");

const match=resolveSecIdentity(
  {ticker:"ADBE",companyName:"Adobe Inc."},
  secRows
);
assert.equal(match.status,"matched");
assert.equal(match.match.cik,"0000796343");

const ambiguous=resolveSecIdentity(
  {ticker:"ZZZ",companyName:"Unknown Holdings"},
  [
    {ticker:"ZZZ",company_name:"Alpha Corp",cik:"0000000001",exchange:"NYSE"},
    {ticker:"ZZZ",company_name:"Beta Corp",cik:"0000000002",exchange:"Nasdaq"},
  ]
);
assert.equal(ambiguous.status,"ambiguous");

const pipelineRun={
  id:"00000000-0000-0000-0000-000000000001",
  input_hash:"a".repeat(64),
  pipeline_version:"research-candidate-pipeline-v2.4",
  evaluation_as_of:"2026-09-21T23:59:59Z",
};
const items=[
  {id:"2",ticker:"B",item_hash:"b".repeat(64)},
  {id:"1",ticker:"A",item_hash:"c".repeat(64)},
];
assert.equal(
  buildResearchFactoryRunHash({pipelineRun,items}),
  buildResearchFactoryRunHash({pipelineRun,items:[...items].reverse()}),
  "factory run hash should not depend on source row ordering"
);

const valuationDraft=buildEvidenceValuationDraft({
  screenResult:{
    id:"screen-1",
    ticker:"TEST",
    screen_profile:"software",
    input_summary:{price:100},
    result_hash:"d".repeat(64),
  },
  company:{id:"company-1"},
  baselineDraft:{
    id:"draft-1",
    draft_payload:{
      metric_observations:[
        {
          metric_key:"fcf_per_share",
          status:"available",
          value_numeric:6,
          period_end:"2026-06-30",
          source_title:"SEC",
          source_url:"https://sec.gov/example",
          calculation_method:"TTM FCF / shares",
        },
      ],
    },
  },
  valuationHistory:Array.from({length:20},(_,i)=>({price_to_fcf:15+i*.5})),
  contextPack:{
    id:"context-1",
    peer_comparison:[
      {data_status:"available",metrics:{price_to_fcf:18}},
      {data_status:"available",metrics:{price_to_fcf:22}},
      {data_status:"not_ingested",metrics:{}},
    ],
  },
  generatedAt:"2026-09-22T00:00:00Z",
});
assert.equal(valuationDraft.valuation_input.currentPrice,100);
assert.equal(valuationDraft.valuation_input.fcfPerShare,6);
assert.ok(valuationDraft.valuation_input.multiples.historical.base>0);
assert.ok(valuationDraft.valuation_input.multiples.peer.base>0);
assert.deepEqual(valuationDraft.valuation_input.assumptions,{});
assert.equal(valuationDraft.preflight.complete,false);
assert.ok(
  valuationDraft.missing_fields.some(x=>x.includes("discountRate")),
  "factory must not invent DCF discount-rate assumptions"
);
assert.match(valuationDraft.input_hash,/^[0-9a-f]{64}$/);

const onboarding=deriveResearchFactoryState({});
assert.equal(onboarding.stage,"onboarding");
assert.equal(onboarding.status,"queued");

const evidence=deriveResearchFactoryState({
  company:{id:"company-1"},
});
assert.equal(evidence.stage,"evidence_ingestion");

const baseline=deriveResearchFactoryState({
  company:{id:"company-1"},
  coverage:{overall_pct:60},
});
assert.equal(baseline.stage,"baseline_draft");

const researchDraft=deriveResearchFactoryState({
  company:{id:"company-1"},
  coverage:{overall_pct:60},
  baselineDraft:{id:"draft"},
});
assert.equal(researchDraft.stage,"research_draft");

const valuationReview=deriveResearchFactoryState({
  company:{id:"company-1"},
  coverage:{overall_pct:70},
  baselineDraft:{id:"draft"},
  composition:{id:"composition"},
  valuationDraft:{id:"valuation-draft"},
});
assert.equal(valuationReview.stage,"valuation_review");
assert.equal(valuationReview.status,"needs_review");

const researchReview=deriveResearchFactoryState({
  company:{id:"company-1"},
  coverage:{overall_pct:80},
  baselineDraft:{id:"draft"},
  composition:{id:"composition"},
  valuationDraft:{id:"valuation-draft"},
  reviewedValuationPack:{id:"reviewed-pack"},
});
assert.equal(researchReview.stage,"research_review");

const pipelineRefresh=deriveResearchFactoryState({
  company:{id:"company-1"},
  coverage:{overall_pct:90},
  baselineDraft:{id:"draft"},
  composition:{id:"composition"},
  valuationDraft:{id:"valuation-draft"},
  reviewedValuationPack:{id:"reviewed-pack"},
  publishedResearch:{id:"research"},
  sourcePipelineItem:{stage:"valuation_building"},
});
assert.equal(pipelineRefresh.stage,"pipeline_refresh");

const complete=deriveResearchFactoryState({
  company:{id:"company-1"},
  coverage:{overall_pct:90},
  baselineDraft:{id:"draft"},
  composition:{id:"composition"},
  valuationDraft:{id:"valuation-draft"},
  reviewedValuationPack:{id:"reviewed-pack"},
  publishedResearch:{id:"research"},
  sourcePipelineItem:{stage:"decision_ready"},
});
assert.equal(complete.stage,"complete");
assert.equal(complete.status,"complete");

assert.match(buildFactoryStateHash({stage:"test"}),/^[0-9a-f]{64}$/);

console.log("Research Factory V1 tests passed.");
