import assert from "node:assert/strict";
import {
  UNIVERSE_SECTOR_MODEL_VERSION,
  classifyIssuerSector,
} from "../lib/universe-sector-model-v2-2.mjs";
import {
  UNIVERSE_SCREENING_VERSION,
  UNIVERSE_SELECTION_VERSION,
  screenCompany,
} from "../lib/universe-screening-engine-v2-2.mjs";
import { RESEARCH_CANDIDATE_PIPELINE_VERSION } from "../lib/research-candidate-pipeline-v2-2.mjs";

assert.equal(UNIVERSE_SECTOR_MODEL_VERSION,"solpient-universe-sector-model-v2.2");
assert.equal(UNIVERSE_SCREENING_VERSION,"solpient-universe-screen-v2.2");
assert.equal(UNIVERSE_SELECTION_VERSION,"solpient-100-selection-v2.2");
assert.equal(RESEARCH_CANDIDATE_PIPELINE_VERSION,"research-candidate-pipeline-v2.2");

const awi=classifyIssuerSector({
  ticker:"AWI",
  companyName:"Armstrong World Industries, Inc.",
  sic:3089,
  sicDescription:"PLASTICS PRODUCTS, NEC",
  existingSector:"Unknown",
  existingIndustry:"PLASTICS PRODUCTS, NEC",
  existingScreenProfile:"general",
});
assert.equal(awi.sector,"Industrials");
assert.equal(awi.industry,"Building Products");
assert.equal(awi.screen_profile,"industrial");
assert.equal(awi.classification_method,"issuer_override");

const lope=classifyIssuerSector({
  ticker:"LOPE",
  companyName:"Grand Canyon Education, Inc.",
  sic:8200,
  sicDescription:"EDUCATIONAL SERVICES",
});
assert.equal(lope.sector,"Consumer Discretionary");
assert.equal(lope.screen_profile,"consumer_discretionary");
assert.equal(lope.classification_method,"issuer_override");

const educationBySic=classifyIssuerSector({
  ticker:"EDU1",
  companyName:"Fixture Education",
  sic:8299,
  sicDescription:"SCHOOLS & EDUCATIONAL SERVICES, NEC",
});
assert.equal(educationBySic.sector,"Consumer Discretionary");
assert.equal(educationBySic.classification_method,"sic_rule");
assert.equal(educationBySic.classification_rule,"sic:8200-8299");

const yelp=classifyIssuerSector({
  ticker:"YELP",
  companyName:"Yelp Inc.",
  sic:7200,
  sicDescription:"SERVICES-PERSONAL SERVICES",
});
assert.equal(yelp.sector,"Communication Services");
assert.equal(yelp.industry,"Interactive Media & Services");
assert.equal(yelp.screen_profile,"communication");
assert.equal(yelp.classification_method,"issuer_override");

const description=classifyIssuerSector({
  ticker:"EDU2",
  sic:9999,
  sicDescription:"Educational Services and Schools",
});
assert.equal(description.sector,"Consumer Discretionary");
assert.equal(description.classification_method,"description_rule");

const baseV2=classifyIssuerSector({
  ticker:"SOFT",
  sic:7372,
  sicDescription:"SERVICES-PREPACKAGED SOFTWARE",
});
assert.equal(baseV2.sector,"Information Technology");
assert.equal(baseV2.screen_profile,"software");
assert.equal(baseV2.classification_method,"base_v2");

const providerFallback=classifyIssuerSector({
  ticker:"PROV",
  existingSector:"Information Technology",
  existingIndustry:"Software",
  existingScreenProfile:"software",
});
assert.equal(providerFallback.sector,"Information Technology");
assert.equal(providerFallback.classification_method,"provider_existing");

const unresolved=classifyIssuerSector({
  ticker:"ZZZZ",
  sic:9999,
  sicDescription:"MISCELLANEOUS UNKNOWN ACTIVITY",
  existingSector:"Unknown",
  existingScreenProfile:"general",
});
assert.equal(unresolved.sector,"Unknown");
assert.equal(unresolved.classification_method,"unresolved");

const baseMetrics={
  market_cap:10_000_000_000,
  avg_dollar_volume_30d:20_000_000,
  price:100,
  roic:20,
  roe:25,
  fcf_margin:20,
  cash_conversion_pct:100,
  operating_margin:20,
  positive_fcf_years:5,
  positive_eps_years:5,
  positive_revenue_growth_years:5,
  operating_margin_volatility_pct:3,
  share_dilution_3y_pct:0,
  net_debt_to_ebitda:0,
  debt_to_equity:.2,
  interest_coverage:20,
  current_ratio:2,
  revenue_growth_3y_cagr:12,
  eps_growth_3y_cagr:15,
  fcf_growth_3y_cagr:15,
  price_to_fcf:15,
  trailing_pe:18,
  ev_to_ebitda:12,
};

const awiScreen=screenCompany({
  ...baseMetrics,
  ticker:"AWI",
  company_name:"Armstrong World Industries, Inc.",
  sector:"Unknown",
  industry:"PLASTICS PRODUCTS, NEC",
  screen_profile:"general",
  sic:"3089",
  sic_description:"PLASTICS PRODUCTS, NEC",
});
assert.equal(awiScreen.sector,"Industrials");
assert.equal(awiScreen.profile,"industrial");
assert.equal(awiScreen.sectorClassification.method,"issuer_override");
assert.equal(awiScreen.sectorEvidence.classificationKnown,true);

const unknownScreen=screenCompany({
  ...baseMetrics,
  ticker:"ZZZZ",
  company_name:"Unresolved Fixture",
  sector:"Unknown",
  industry:"MISCELLANEOUS UNKNOWN ACTIVITY",
  screen_profile:"general",
  sic:"9999",
  sic_description:"MISCELLANEOUS UNKNOWN ACTIVITY",
});
assert.equal(unknownScreen.sector,"Unknown");
assert.equal(unknownScreen.sectorClassification.method,"unresolved");
assert.equal(unknownScreen.sectorEvidence.candidatePromotionBlocked,true);
assert.ok(unknownScreen.evidenceCoveragePct<=69);

console.log("Sector Classification Repair V2.2 tests passed.");
