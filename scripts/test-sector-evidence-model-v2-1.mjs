import assert from "node:assert/strict";
import {
  SECTOR_EVIDENCE_MODEL_VERSION,
  assessSectorEvidence,
} from "../lib/sector-evidence-model-v2-1.mjs";
import {
  SCREEN_STATE,
  UNIVERSE_SCREENING_VERSION,
  UNIVERSE_SELECTION_VERSION,
  screenCompany,
} from "../lib/universe-screening-engine.mjs";
import {
  RESEARCH_CANDIDATE_PIPELINE_VERSION,
} from "../lib/research-candidate-pipeline.mjs";

assert.equal(SECTOR_EVIDENCE_MODEL_VERSION,"solpient-sector-evidence-model-v2.1");
assert.equal(UNIVERSE_SCREENING_VERSION,"solpient-universe-screen-v2.1");
assert.equal(UNIVERSE_SELECTION_VERSION,"solpient-100-selection-v2.1");
assert.equal(RESEARCH_CANDIDATE_PIPELINE_VERSION,"research-candidate-pipeline-v2.1");

const base={
  market_cap:15_000_000_000,
  avg_dollar_volume_30d:50_000_000,
  price:75,
  going_concern_flag:false,
  bankruptcy_flag:false,
};

const insurer={
  ...base,
  ticker:"INS",
  company_name:"Fixture Insurer",
  sector:"Financials",
  industry:"Insurance",
  screen_profile:"insurance",
  sector_taxonomy_version:"solpient-universe-sector-model-v2",
  roe:18,
  roa:2,
  positive_eps_years:5,
  positive_revenue_growth_years:5,
  positive_book_value_growth_years:5,
  share_dilution_3y_pct:0,
  equity_to_assets_pct:22,
  eps_growth_3y_cagr:15,
  book_value_growth_3y_cagr:12,
  revenue_growth_3y_cagr:12,
  trailing_pe:10,
  price_to_book:1.2,
};
const broadOnlyInsurer=screenCompany(insurer);
assert.ok(broadOnlyInsurer.rawEvidenceCoveragePct>=95);
assert.equal(broadOnlyInsurer.sectorEvidence.criticalEvidenceCoveragePct,0);
assert.equal(broadOnlyInsurer.sectorEvidence.evidenceCoverageCeilingPct,60);
assert.equal(broadOnlyInsurer.evidenceCoveragePct,60);
assert.equal(broadOnlyInsurer.state,SCREEN_STATE.RESEARCH_CANDIDATE);
assert.notEqual(broadOnlyInsurer.state,SCREEN_STATE.SOLPIENT_100_CANDIDATE);

const insurerWithCritical=screenCompany({
  ...insurer,
  combined_ratio:92,
  rbc_ratio:430,
});
assert.equal(insurerWithCritical.sectorEvidence.criticalEvidenceCoveragePct,40);
assert.equal(insurerWithCritical.sectorEvidence.evidenceCoverageCeilingPct,76);
assert.ok(insurerWithCritical.evidenceCoveragePct>=70);
assert.equal(insurerWithCritical.state,SCREEN_STATE.SOLPIENT_100_CANDIDATE);

const bank={
  ...base,
  ticker:"BANK",
  company_name:"Fixture Bank",
  sector:"Financials",
  industry:"Banks",
  screen_profile:"bank",
  sector_taxonomy_version:"solpient-universe-sector-model-v2",
  roe:18,
  roa:1.5,
  positive_eps_years:5,
  positive_revenue_growth_years:5,
  positive_book_value_growth_years:5,
  share_dilution_3y_pct:0,
  equity_to_assets_pct:12,
  eps_growth_3y_cagr:15,
  book_value_growth_3y_cagr:12,
  revenue_growth_3y_cagr:12,
  trailing_pe:10,
  price_to_book:1.2,
};
const bankResult=screenCompany(bank);
assert.equal(bankResult.evidenceCoveragePct,60);
assert.equal(bankResult.state,SCREEN_STATE.RESEARCH_CANDIDATE);

const assetManager={
  ...base,
  ticker:"AMGR",
  company_name:"Fixture Asset Manager",
  sector:"Financials",
  industry:"Capital Markets & Asset Management",
  screen_profile:"asset_manager",
  sector_taxonomy_version:"solpient-universe-sector-model-v2",
  roe:25,
  fcf_margin:25,
  cash_conversion_pct:110,
  operating_margin:35,
  positive_fcf_years:5,
  positive_eps_years:5,
  positive_revenue_growth_years:5,
  operating_margin_volatility_pct:2,
  share_dilution_3y_pct:0,
  equity_to_assets_pct:30,
  current_ratio:2,
  revenue_growth_3y_cagr:15,
  eps_growth_3y_cagr:20,
  fcf_growth_3y_cagr:20,
  price_to_fcf:12,
  trailing_pe:10,
  price_to_book:1.5,
};
const assetResult=screenCompany(assetManager);
assert.equal(assetResult.sectorEvidence.evidenceCoverageCeilingPct,65);
assert.equal(assetResult.state,SCREEN_STATE.RESEARCH_CANDIDATE);

const reit={
  ...base,
  ticker:"REIT",
  company_name:"Fixture REIT",
  sector:"Real Estate",
  industry:"Equity REITs",
  screen_profile:"reit",
  sector_taxonomy_version:"solpient-universe-sector-model-v2",
  ffo_proxy_margin_pct:35,
  operating_margin:45,
  positive_eps_years:5,
  roe:15,
  positive_ffo_proxy_years:5,
  positive_revenue_growth_years:5,
  operating_margin_volatility_pct:4,
  share_dilution_3y_pct:0,
  net_debt_to_ebitda:3,
  interest_coverage:5,
  equity_to_assets_pct:45,
  ffo_proxy_growth_3y_cagr:10,
  revenue_growth_3y_cagr:10,
  eps_growth_3y_cagr:12,
  price_to_ffo_proxy:12,
  price_to_book:1,
  fcf_yield_pct:7,
};
const reitResult=screenCompany(reit);
assert.equal(reitResult.evidenceCoveragePct,60);
assert.equal(reitResult.state,SCREEN_STATE.RESEARCH_CANDIDATE);

const reitWithCritical=screenCompany({
  ...reit,
  affo_per_share:5,
  occupancy_pct:97,
});
assert.equal(reitWithCritical.sectorEvidence.criticalEvidenceCoveragePct,40);
assert.equal(reitWithCritical.sectorEvidence.evidenceCoverageCeilingPct,76);
assert.equal(reitWithCritical.state,SCREEN_STATE.SOLPIENT_100_CANDIDATE);

const unknown={
  ...base,
  ticker:"UNK",
  company_name:"Unknown Fixture",
  sector:"Unknown",
  industry:"Unclassified",
  screen_profile:"general",
  roic:25,
  roe:25,
  fcf_margin:25,
  cash_conversion_pct:110,
  operating_margin:25,
  positive_fcf_years:5,
  positive_eps_years:5,
  positive_revenue_growth_years:5,
  operating_margin_volatility_pct:2,
  share_dilution_3y_pct:0,
  net_debt_to_ebitda:0,
  debt_to_equity:.2,
  interest_coverage:12,
  current_ratio:2,
  revenue_growth_3y_cagr:15,
  eps_growth_3y_cagr:20,
  fcf_growth_3y_cagr:20,
  price_to_fcf:12,
  trailing_pe:12,
  ev_to_ebitda:8,
};
const unknownResult=screenCompany(unknown);
assert.equal(unknownResult.sectorEvidence.classificationKnown,false);
assert.equal(unknownResult.sectorEvidence.candidatePromotionBlocked,true);
assert.ok(unknownResult.evidenceCoveragePct<=69);
assert.equal(unknownResult.state,SCREEN_STATE.RESEARCH_CANDIDATE);
assert.notEqual(unknownResult.state,SCREEN_STATE.SOLPIENT_100_CANDIDATE);

const software={
  ...base,
  ticker:"SOFT",
  company_name:"Fixture Software",
  sector:"Information Technology",
  industry:"Software & IT Services",
  screen_profile:"software",
  sector_taxonomy_version:"solpient-universe-sector-model-v2",
  roic:25,
  roe:25,
  fcf_margin:25,
  cash_conversion_pct:110,
  operating_margin:30,
  positive_fcf_years:5,
  positive_eps_years:5,
  positive_revenue_growth_years:5,
  operating_margin_volatility_pct:2,
  share_dilution_3y_pct:0,
  net_debt_to_ebitda:0,
  debt_to_equity:.2,
  interest_coverage:12,
  current_ratio:2,
  revenue_growth_3y_cagr:15,
  eps_growth_3y_cagr:20,
  fcf_growth_3y_cagr:20,
  price_to_fcf:12,
  trailing_pe:12,
  ev_to_ebitda:8,
};
const softwareResult=screenCompany(software);
assert.equal(softwareResult.sectorEvidence.sensitive,false);
assert.equal(softwareResult.rawEvidenceCoveragePct,softwareResult.evidenceCoveragePct);
assert.equal(softwareResult.sectorEvidence.evidenceCoverageCeilingPct,100);
assert.equal(softwareResult.state,SCREEN_STATE.SOLPIENT_100_CANDIDATE);

const direct=assessSectorEvidence(insurer,"insurance",100);
assert.equal(direct.presentCriticalEvidence.length,0);
assert.equal(direct.missingCriticalEvidence.length,5);

console.log("Sector Evidence Model V2.1 tests passed.");
