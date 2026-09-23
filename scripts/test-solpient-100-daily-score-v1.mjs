import assert from "node:assert/strict";
import {
  buildDecisionRanking,
  currentPriceExpectedCagr,
  sortDecisionRankings,
} from "../lib/decision-ranking-engine.mjs";

function score({
  ticker,
  quality,
  moat,
  financial,
  price,
  base,
  bear,
  bull,
  mos25,
  mos35,
  cagr,
  evidence=85,
}){
  const decision=buildDecisionRanking({
    scores:{
      quality_score:quality,
      moat_score:moat,
      financial_strength_score:financial,
    },
    valuation:{
      base_value:base,
      bear_value:bear,
      bull_value:bull,
      mos_25_price:mos25,
      mos_35_price:mos35,
    },
    price,
    base5yCagr:cagr,
    coverage:{
      fundamentals_pct:evidence,
      balance_sheet_pct:evidence,
      history_pct:evidence,
      market_history_pct:100,
      valuation_history_pct:evidence,
      capital_allocation_pct:evidence,
      peer_pct:evidence,
      industry_pct:evidence,
      consensus_pct:50,
      research_structure_pct:evidence,
      primary_source_quarters:12,
      normalized_quarters:12,
    },
    researchedAt:"2026-09-22T12:00:00Z",
    now:new Date("2026-09-23T12:00:00Z"),
  });
  return {ticker,decision};
}

const a=score({
  ticker:"AAA",quality:85,moat:80,financial:90,
  price:80,base:120,bear:75,bull:150,mos25:90,mos35:78,cagr:14,evidence:92,
});
const b=score({
  ticker:"BBB",quality:70,moat:65,financial:75,
  price:100,base:110,bear:70,bull:135,mos25:82,mos35:72,cagr:8,evidence:80,
});

assert.ok(a.decision.decisionScore!=null);
assert.ok(b.decision.decisionScore!=null);
assert.ok(a.decision.decisionScore>b.decision.decisionScore);


const sameResearchHigherPrice=score({
  ticker:"AAA-HIGHER-PRICE",quality:85,moat:80,financial:90,
  price:115,base:120,bear:75,bull:150,mos25:90,mos35:78,cagr:14,evidence:92,
});
assert.ok(
  a.decision.investmentOpportunity.score >
  sameResearchHigherPrice.decision.investmentOpportunity.score
);
assert.ok(
  a.decision.decisionScore >
  sameResearchHigherPrice.decision.decisionScore
);


const scenario={
  horizon_years:5,
  terminal_value:160,
  return_decomposition:{dividends_assumed:10},
  expected_cagr:99,
};
const lowPriceCagr=currentPriceExpectedCagr(80,scenario);
const highPriceCagr=currentPriceExpectedCagr(120,scenario);
assert.ok(lowPriceCagr>highPriceCagr);
assert.notEqual(lowPriceCagr,99);

const ordered=[b,a].sort(sortDecisionRankings);
assert.equal(ordered[0].ticker,"AAA");

// Missing inputs are never silently replaced with a neutral 50.
const thin=buildDecisionRanking({
  scores:{quality_score:80},
  valuation:{},
  price:100,
  coverage:{fundamentals_pct:50},
  researchedAt:"2026-09-23T12:00:00Z",
});
assert.equal(thin.investmentOpportunity.score,null);
assert.equal(thin.decisionScore,null);
assert.ok(thin.readiness.blockers.length>0);

console.log("Solpient 100 Daily Score V1 tests passed.");
