import assert from "node:assert/strict";
import { buildPublicationPackage, buildPublicationIntegrity } from "../lib/promote-research.mjs";

const promotedAt="2026-09-21T20:00:00.000Z";
const payload={
  ticker:"TEST",
  company_name:"Test Co",
  research:{
    standard_version:"solpient-v2",
    price_at_research:100,
    data_cutoff_at:"2026-09-20T23:59:59.000Z",
    benchmark_ticker:"SPY",
    summary:"Reviewed research.",
    source_period:"FY2026",
    supersedes_id:"00000000-0000-0000-0000-000000000001",
    correction_reason:"Corrected a source mapping.",
  },
  financial_metrics:{revenue:1000},
  scores:{overall_score:80},
  valuations:{base_value:120},
  business_assessment:{
    business_quality_rating:"strong",
    moat_rating:"narrow",
    evidence:[],
  },
  metric_observations:[
    {module:"universal",metric_key:"revenue_growth_1y",label:"Revenue growth",value_numeric:10,basis:"reported",status:"available"},
  ],
  risk_register:[
    {risk_key:"r1",category:"investment",title:"Risk",probability:"medium",severity:"high",thesis_breaker:"Break"},
  ],
  expected_return_scenarios:[
    {scenario:"base",horizon_years:5,expected_cagr:8,methodology:"test",assumptions:{}},
  ],
  thesis_variables:[
    {variable_name:"Growth",status:"monitor",breaker_condition:"Growth breaks"},
  ],
  sources:[
    {source_type:"10-K",title:"Annual report",url:"https://example.com/10-k"},
  ],
  investment_thesis:{what_must_be_true:"Economics remain durable."},
  financial_quality:{history_years:5},
  fundamental_scorecard:[],
  competitive_position:{peers:["AAA","BBB"]},
  valuation_analysis:{assumptions:{discount_rate:10}},
  historical_valuation:{},
  investment_lenses:{},
  decision_dashboard:{},
  final_conclusion:{},
  prediction:{should_not_publish:true},
};

const draft={
  id:"00000000-0000-0000-0000-000000000010",
  source_cutoff_at:"2026-09-20T23:59:59.000Z",
  evidence_summary:{primary_sources:2},
};
const review={id:"00000000-0000-0000-0000-000000000011"};
const composition={
  engine_version:"composer-v2",
  composition_payload:{review_patch:{research:{summary:"Reviewed research."}}},
};
const readiness={
  standard:{
    status:"complete",
    completenessPct:100,
    notes:[],
  },
};

const pkg=buildPublicationPackage(payload,promotedAt);
assert.equal(pkg.research.status,"published");
assert.equal(pkg.research.standard_version,"solpient-v2");
assert.equal(pkg.sources[0].retrieved_at,promotedAt);
assert.equal("prediction" in pkg,false);
assert.equal("id" in pkg.financial_metrics,false);
assert.equal("research_run_id" in pkg.financial_metrics,false);

const integrityA=buildPublicationIntegrity({draft,review,composition,packagePayload:pkg,readiness});
const integrityB=buildPublicationIntegrity({draft,review,composition,packagePayload:structuredClone(pkg),readiness});
assert.deepEqual(integrityA,integrityB);
assert.match(integrityA.published_output_hash,/^[0-9a-f]{64}$/);
assert.match(integrityA.evidence_hash,/^[0-9a-f]{64}$/);
assert.equal(integrityA.supersedes_id,payload.research.supersedes_id);
assert.equal(integrityA.correction_reason,payload.research.correction_reason);

const changed=structuredClone(pkg);
changed.valuation_analysis.assumptions.discount_rate=11;
const integrityChanged=buildPublicationIntegrity({draft,review,composition,packagePayload:changed,readiness});
assert.notEqual(integrityA.published_output_hash,integrityChanged.published_output_hash);
assert.notEqual(integrityA.valuation_inputs_hash,integrityChanged.valuation_inputs_hash);

console.log("Publication integrity tests passed.");
