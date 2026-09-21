import assert from "node:assert/strict";
import {
  SCREEN_STATE,
  UNIVERSE_SCREENING_VERSION,
  screenCompany,
  rankUniverse,
  selectSolpient100Candidates,
  resolveScreenProfile,
} from "../lib/universe-screening-engine.mjs";

const qualitySoftware={
  ticker:"SOFT",
  company_name:"Quality Software",
  sector:"Information Technology",
  industry:"Software",
  market_cap:50_000_000_000,
  avg_dollar_volume_30d:250_000_000,
  price:200,
  roic:28,
  roe:32,
  fcf_margin:30,
  cash_conversion_pct:105,
  operating_margin:35,
  positive_fcf_years:5,
  positive_eps_years:5,
  positive_revenue_growth_years:5,
  operating_margin_volatility_pct:2,
  share_dilution_3y_pct:1,
  net_debt_to_ebitda:0,
  debt_to_equity:.2,
  interest_coverage:30,
  current_ratio:2,
  revenue_growth_3y_cagr:18,
  eps_growth_3y_cagr:22,
  fcf_growth_3y_cagr:20,
  price_to_fcf:45,
  forward_pe:42,
  ev_to_ebitda:30,
  peg_ratio:2.2,
};
const soft=screenCompany(qualitySoftware);
assert.equal(soft.methodologyVersion,UNIVERSE_SCREENING_VERSION);
assert.equal(soft.profile,"software");
assert.ok(soft.qualityCoreScore>=90);
assert.ok(soft.screenScore>=70);
assert.ok([SCREEN_STATE.RESEARCH_CANDIDATE,SCREEN_STATE.SOLPIENT_100_CANDIDATE].includes(soft.state));
assert.ok(soft.dimensions.valuation.score<60);

const cheapJunk=screenCompany({
  ...qualitySoftware,
  ticker:"JUNK",
  market_cap:700_000_000,
  avg_dollar_volume_30d:3_000_000,
  price:5,
  roic:-10,
  roe:-20,
  fcf_margin:-15,
  cash_conversion_pct:10,
  operating_margin:-10,
  positive_fcf_years:0,
  positive_eps_years:0,
  positive_revenue_growth_years:1,
  share_dilution_3y_pct:25,
  net_debt_to_ebitda:10,
  interest_coverage:.5,
  current_ratio:.4,
  revenue_growth_3y_cagr:-10,
  eps_growth_3y_cagr:-30,
  fcf_growth_3y_cagr:-30,
  price_to_fcf:4,
  forward_pe:5,
  ev_to_ebitda:4,
  peg_ratio:.5,
});
assert.equal(cheapJunk.state,SCREEN_STATE.EXCLUDED);
assert.ok(cheapJunk.dimensions.valuation.score>80);
assert.ok(cheapJunk.gates.some(g=>g.key==="leverage_extreme"&&!g.pass));

const bank=screenCompany({
  ticker:"BANK",
  company_name:"Good Bank",
  sector:"Financials",
  industry:"Banks",
  market_cap:30_000_000_000,
  avg_dollar_volume_30d:100_000_000,
  price:80,
  roe:17,
  positive_eps_years:5,
  efficiency_ratio:48,
  nonperforming_assets_pct:.7,
  positive_book_value_growth_years:5,
  credit_loss_volatility_pct:.8,
  share_dilution_3y_pct:0,
  cet1_ratio:14,
  tangible_common_equity_ratio:9,
  liquidity_coverage_ratio:135,
  payout_ratio:35,
  eps_growth_3y_cagr:12,
  book_value_growth_3y_cagr:8,
  revenue_growth_3y_cagr:7,
  forward_pe:11,
  price_to_tangible_book:1.8,
  peg_ratio:1.2,
  net_debt_to_ebitda:99, // irrelevant for bank profile
});
assert.equal(bank.profile,"financial");
assert.equal(bank.gates.some(g=>g.key==="leverage_extreme"),false);
assert.ok(bank.screenScore>=70);

const missing=screenCompany({
  ticker:"MISS",
  company_name:"Sparse Data",
  sector:"Industrials",
  market_cap:5_000_000_000,
  avg_dollar_volume_30d:20_000_000,
  price:50,
  roic:18,
  positive_fcf_years:5,
});
assert.ok(missing.evidenceCoveragePct<55);
assert.equal(missing.state,SCREEN_STATE.WATCH);
assert.ok(missing.dimensions.quality.missing.length>0);

const biotech=screenCompany({
  ticker:"BIOX",
  company_name:"Pre Revenue Biotech",
  sector:"Health Care",
  industry:"Biotechnology",
  market_cap:4_000_000_000,
  avg_dollar_volume_30d:30_000_000,
  price:20,
  revenue_ttm:50_000_000,
  roe:10,
  positive_eps_years:0,
});
assert.equal(biotech.profile,"biopharma");
assert.equal(biotech.state,SCREEN_STATE.EXCLUDED);
assert.ok(biotech.gates.some(g=>g.key==="commercial_scale"&&!g.pass));

const approved=screenCompany({
  ...qualitySoftware,
  ticker:"MEMB",
  approved_solpient_100:true,
});
assert.equal(approved.state,SCREEN_STATE.SOLPIENT_100);

const notAutoMember=screenCompany({
  ...qualitySoftware,
  ticker:"AUTO",
  price_to_fcf:15,
  forward_pe:15,
  ev_to_ebitda:10,
  peg_ratio:1,
});
assert.notEqual(notAutoMember.state,SCREEN_STATE.SOLPIENT_100);
assert.equal(notAutoMember.state,SCREEN_STATE.SOLPIENT_100_CANDIDATE);

assert.equal(resolveScreenProfile({sector:"Real Estate"}),"reit");
assert.equal(resolveScreenProfile({industry:"Medical Devices"}),"healthcare");
assert.equal(resolveScreenProfile({sector:"Energy"}),"cyclical");

const universe=[
  {...qualitySoftware,ticker:"AAA",price_to_fcf:20,forward_pe:20,ev_to_ebitda:15,peg_ratio:1.5},
  {...qualitySoftware,ticker:"BBB",price_to_fcf:25,forward_pe:25,ev_to_ebitda:18,peg_ratio:1.8},
  {...qualitySoftware,ticker:"CCC",price_to_fcf:30,forward_pe:30,ev_to_ebitda:20,peg_ratio:2},
  {...qualitySoftware,ticker:"DDD",market_cap:100_000_000},
];
const ranked=rankUniverse(universe);
assert.equal(ranked[0].ticker,"AAA");
assert.equal(ranked.at(-1).ticker,"DDD");
assert.equal(ranked.at(-1).state,SCREEN_STATE.EXCLUDED);

const selected=selectSolpient100Candidates(universe,{limit:2});
assert.deepEqual(selected.filter(r=>r.proposedForDeepResearch).map(r=>r.ticker),["AAA","BBB"]);
assert.equal(selected.find(r=>r.ticker==="AAA").finalMembershipRequiresReview,true);
assert.equal(selected.find(r=>r.ticker==="CCC").proposedForDeepResearch,false);

// Deterministic ticker tie-break.
const ties=rankUniverse([
  {...qualitySoftware,ticker:"ZZZ"},
  {...qualitySoftware,ticker:"AAA"},
]);
assert.equal(ties[0].ticker,"AAA");

console.log("Solpient 100 universe screening tests passed.");
