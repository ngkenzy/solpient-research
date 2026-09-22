import assert from "node:assert/strict";
import { classifySicSector, UNIVERSE_SECTOR_MODEL_VERSION } from "../lib/universe-sector-model-v2.mjs";
import {
  UNIVERSE_SCREENING_VERSION,
  UNIVERSE_SELECTION_VERSION,
  resolveScreenProfile,
  screenCompany,
} from "../lib/universe-screening-engine-v2.mjs";
import {
  RESEARCH_CANDIDATE_PIPELINE_VERSION,
  valuationProfileForScreen,
  valuationPreflight,
} from "../lib/research-candidate-pipeline-v2.mjs";

const cases=[
  [7372,"SERVICES-PREPACKAGED SOFTWARE","Information Technology","software"],
  [4813,"TELEPHONE COMMUNICATIONS","Communication Services","communication"],
  [5411,"GROCERY STORES","Consumer Staples","consumer_staples"],
  [5812,"RETAIL-EATING PLACES","Consumer Discretionary","consumer_discretionary"],
  [2834,"PHARMACEUTICAL PREPARATIONS","Health Care","biopharma"],
  [3841,"SURGICAL & MEDICAL INSTRUMENTS","Health Care","healthcare"],
  [6021,"NATIONAL COMMERCIAL BANKS","Financials","bank"],
  [6331,"FIRE, MARINE & CASUALTY INSURANCE","Financials","insurance"],
  [6211,"SECURITY BROKERS, DEALERS & FLOTATION COMPANIES","Financials","asset_manager"],
  [6798,"REAL ESTATE INVESTMENT TRUSTS","Real Estate","reit"],
  [6512,"OPERATORS OF NONRESIDENTIAL BUILDINGS","Real Estate","real_estate"],
  [4911,"ELECTRIC SERVICES","Utilities","utility"],
  [1311,"CRUDE PETROLEUM & NATURAL GAS","Energy","cyclical"],
  [2810,"INDUSTRIAL INORGANIC CHEMICALS","Materials","cyclical"],
  [3721,"AIRCRAFT","Industrials","industrial"],
  [8742,"MANAGEMENT CONSULTING SERVICES","Industrials","industrial"],
  [8099,"HEALTH & ALLIED SERVICES, NEC","Health Care","healthcare"],
];
for(const [sic,description,sector,profile] of cases){
  const result=classifySicSector(sic,description);
  assert.equal(result.sector,sector,description);
  assert.equal(result.screen_profile,profile,description);
  assert.equal(result.taxonomy_version,UNIVERSE_SECTOR_MODEL_VERSION);
  assert.notEqual(result.sector,"Services");
}

assert.equal(UNIVERSE_SCREENING_VERSION,"solpient-universe-screen-v2");
assert.equal(UNIVERSE_SELECTION_VERSION,"solpient-100-selection-v2");
assert.equal(RESEARCH_CANDIDATE_PIPELINE_VERSION,"research-candidate-pipeline-v2");

const base={
  market_cap:10_000_000_000,
  avg_dollar_volume_30d:25_000_000,
  price:50,
  going_concern_flag:false,
  bankruptcy_flag:false,
};

const bank={
  ...base,ticker:"BANK",company_name:"Fixture Bank",sector:"Financials",industry:"Banks",
  screen_profile:"bank",roe:15,roa:1.2,positive_eps_years:5,
  positive_revenue_growth_years:4,positive_book_value_growth_years:4,
  share_dilution_3y_pct:0,equity_to_assets_pct:9,
  eps_growth_3y_cagr:10,book_value_growth_3y_cagr:8,revenue_growth_3y_cagr:5,
  trailing_pe:12,price_to_book:1.7,
};
const bankResult=screenCompany(bank);
assert.equal(resolveScreenProfile(bank),"bank");
assert.notEqual(bankResult.state,"excluded");
assert.ok(bankResult.evidenceCoveragePct>=90);
assert.equal(bankResult.dimensions.quality.missing.includes("efficiency"),false);
assert.equal(valuationProfileForScreen(bankResult),"financial_bank");

const insurer={
  ...base,ticker:"INS",company_name:"Fixture Insurer",sector:"Financials",industry:"Insurance",
  screen_profile:"insurance",roe:16,roa:1.5,positive_eps_years:5,
  positive_revenue_growth_years:4,positive_book_value_growth_years:4,
  share_dilution_3y_pct:0,equity_to_assets_pct:18,
  eps_growth_3y_cagr:9,book_value_growth_3y_cagr:7,revenue_growth_3y_cagr:5,
  trailing_pe:13,price_to_book:1.8,
};
const insuranceResult=screenCompany(insurer);
assert.notEqual(insuranceResult.state,"excluded");
assert.ok(insuranceResult.evidenceCoveragePct>=90);
assert.equal(valuationProfileForScreen(insuranceResult),null);
const insurancePreflight=valuationPreflight(insuranceResult,{});
assert.equal(insurancePreflight.complete,false);
assert.match(insurancePreflight.blockedReason,/does not permit generic corporate FCF/);

const reit={
  ...base,ticker:"REIT",company_name:"Fixture REIT",sector:"Real Estate",industry:"Equity REITs",
  screen_profile:"reit",ffo_proxy_margin_pct:30,operating_margin:35,positive_eps_years:5,roe:10,
  positive_ffo_proxy_years:5,positive_revenue_growth_years:4,operating_margin_volatility_pct:5,
  share_dilution_3y_pct:1,net_debt_to_ebitda:4,interest_coverage:4,equity_to_assets_pct:35,
  ffo_proxy_growth_3y_cagr:7,revenue_growth_3y_cagr:5,eps_growth_3y_cagr:5,
  price_to_ffo_proxy:15,price_to_book:1.6,fcf_yield_pct:5,
};
const reitResult=screenCompany(reit);
assert.notEqual(reitResult.state,"excluded");
assert.ok(reitResult.evidenceCoveragePct>=90);
assert.equal(valuationProfileForScreen(reitResult),null);

console.log("Universe Sector Model V2 tests passed.");
