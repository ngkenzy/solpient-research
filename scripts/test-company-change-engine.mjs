import assert from "node:assert/strict";
import {buildCompanyChangeEvents,summarizeDecisionImpact} from "../lib/company-change-engine.mjs";
import {EVENT_CATEGORIES,TAXONOMY_VERSION} from "../lib/event-detectors.mjs";

const common={companyId:"c",currentSnapshotId:"s2",previousSnapshotId:"s1",researchRunId:"r2",occurredAt:"2026-09-21"};
const previous={
  market:{price:100},
  valuation:{discount_to_fair_value:20,base_value:125,mos_25_price:93.75,price_to_fcf:20,fcf_yield:5},
  returns:{base_5y_cagr:9},
  consensus:{eps_next_fy:5,revenue_next_fy:1000,eps_growth_next_fy:5},
  financial:{revenue_growth_1y:8,fcf_margin:20,debt_to_equity:1,total_debt:100},
  scores:{overall_score:75,thesis_integrity_score:80},
  coverage:{decision_readiness_pct:80},
  thesis:[{variable_name:"Pricing",status:"unchanged",observed_value:"stable"}],
  filing:{accession_number:"old",form_type:"10-Q",filed_at:"2026-05-01"},
  research:{version:1},
};
const current={
  market:{price:90},
  valuation:{discount_to_fair_value:28,base_value:130,mos_25_price:97.5,price_to_fcf:17,fcf_yield:6.2},
  returns:{base_5y_cagr:11},
  consensus:{eps_next_fy:5.3,revenue_next_fy:1000,eps_growth_next_fy:8},
  financial:{revenue_growth_1y:11,fcf_margin:23,debt_to_equity:.8,total_debt:85},
  scores:{overall_score:80,thesis_integrity_score:86},
  coverage:{decision_readiness_pct:90},
  thesis:[{variable_name:"Pricing",status:"strengthened",observed_value:"better"}],
  filing:{accession_number:"new",form_type:"10-Q",filed_at:"2026-08-01",filing_url:"https://example.com"},
  research:{version:2},
};
const events=buildCompanyChangeEvents({...common,current,previous});
assert.ok(events.some(e=>e.metric_key==="valuation.discount_to_fair_value"&&e.decision_impact==="improving"));
assert.ok(events.some(e=>e.metric_key==="consensus.eps_next_fy"&&e.decision_impact==="improving"));
assert.ok(events.some(e=>e.metric_key==="financial.debt_to_equity"&&e.decision_impact==="improving"));
assert.ok(events.some(e=>e.category==="research"&&e.materiality==="high"));
assert.ok(events.some(e=>e.category==="research"&&e.decision_impact==="monitor"));
assert.ok(events.some(e=>e.metric_key==="research_version"));
const summary=summarizeDecisionImpact(events);
assert.equal(summary.trend,"improving");
assert.ok(summary.total>=8);

const quiet=buildCompanyChangeEvents({...common,current:previous,previous});
assert.equal(quiet.length,0);
console.log("Company Change Engine tests passed:",events.length,"events.");

assert.ok(events.every(e=>EVENT_CATEGORIES.includes(e.category)),"taxonomy category");
assert.ok(events.every(e=>e.event_taxonomy===TAXONOMY_VERSION),"taxonomy version");
console.log("Taxonomy assertions passed.");
