import assert from "node:assert/strict";
import {
  METHODOLOGY_ACTIVATION_VERSION,
  UNIVERSE_METHOD_STACK,
  SCREEN_MATERIALIZATION_STACK,
  buildMethodologyValidationBundle,
  methodologyStackStatus,
  requiredValidationEvidence,
} from "../lib/methodology-activation-v1.mjs";

assert.equal(METHODOLOGY_ACTIVATION_VERSION,"methodology-validation-activation-v1");
assert.equal(UNIVERSE_METHOD_STACK.length,4);
assert.equal(SCREEN_MATERIALIZATION_STACK.length,3);

const strong=(ticker)=>({
  ticker,
  company_name:"Quality Software "+ticker,
  cik:String(1000000000+Number(ticker.replace(/\D/g,"")||1)),
  sector:"Information Technology",
  industry:"Software",
  screen_profile:"software",
  market_cap:20_000_000_000,
  avg_dollar_volume_30d:50_000_000,
  price:100,
  roic:25,roe:30,fcf_margin:25,cash_conversion_pct:105,operating_margin:30,
  positive_fcf_years:5,positive_eps_years:5,positive_revenue_growth_years:5,
  operating_margin_volatility_pct:2,share_dilution_3y_pct:0,
  net_debt_to_ebitda:0,debt_to_equity:.1,interest_coverage:20,current_ratio:2,
  revenue_growth_3y_cagr:15,eps_growth_3y_cagr:18,fcf_growth_3y_cagr:17,
  price_to_fcf:18,trailing_pe:22,ev_to_ebitda:14,forward_pe:20,
  bankruptcy_flag:false,going_concern_flag:false,
});

const rows=Array.from({length:12},(_,i)=>strong("S"+(i+1)));
const preview=buildMethodologyValidationBundle(rows,{
  limit:10,
  minInputCount:10,
  acknowledgeReviewItems:false,
});
assert.equal(preview.acceptance.full_universe_size,true);
assert.ok(preview.qa_review_items>=1);
assert.equal(preview.ready,false);
assert.ok(preview.blocking_reasons.some(x=>/acknowledgement/.test(x)));

const accepted=buildMethodologyValidationBundle(rows,{
  limit:10,
  minInputCount:10,
  acknowledgeReviewItems:true,
});
assert.equal(accepted.ready,true);
assert.match(accepted.validation_hash,/^[0-9a-f]{64}$/);
assert.equal(accepted.classification.obvious_unknown_count,0);
assert.equal(accepted.classification.unresolved_count,0);
assert.equal(accepted.shortlist_count,10);

const tooSmall=buildMethodologyValidationBundle(rows,{
  limit:10,
  minInputCount:1000,
  acknowledgeReviewItems:true,
});
assert.equal(tooSmall.ready,false);
assert.equal(tooSmall.acceptance.full_universe_size,false);

const unknownRows=[
  ...rows,
  {
    ...strong("UNK1"),
    sector:"Unknown",
    industry:"Unknown",
    screen_profile:"general",
    sic:"9999",
    sic_description:"Unmapped Activity",
  },
];
const unknownBundle=buildMethodologyValidationBundle(unknownRows,{
  limit:10,
  minInputCount:10,
  acknowledgeReviewItems:true,
});
assert.equal(unknownBundle.classification.unresolved_count,0);
assert.ok(unknownBundle.classification.review_required_count>=1);

const definitions=UNIVERSE_METHOD_STACK.map((x,i)=>({
  id:"d"+i,
  methodology_key:x.methodology_key,
  version:x.version,
  manifest:{...x},
}));
const events=definitions.map((d,i)=>({
  id:"e"+i,
  methodology_definition_id:d.id,
  event_type:i===2?"validated":"active",
  effective_at:"2026-09-22T0"+i+":00:00Z",
}));
const status=methodologyStackStatus(definitions,events);
assert.equal(status.ready,false);
assert.equal(status.inactive.length,1);
assert.match(status.inactive[0].identity,/universe_screening/);

const activeStatus=methodologyStackStatus(
  definitions,
  definitions.map((d,i)=>({
    id:"a"+i,
    methodology_definition_id:d.id,
    event_type:"active",
    effective_at:"2026-09-22T0"+i+":00:00Z",
  }))
);
assert.equal(activeStatus.ready,true);

const evidence=requiredValidationEvidence(accepted);
assert.ok(evidence["universe_screening|solpient-universe-screen-v2.3"]
  .some(x=>x.validation_type==="db_invariant"));
assert.ok(evidence["research_candidate_pipeline|research-candidate-pipeline-v2.3"]
  .some(x=>x.validation_type==="manual_review"));

assert.throws(
  ()=>requiredValidationEvidence(preview),
  /not activation-ready/
);

console.log("Methodology Validation & Activation V1 tests passed.");
