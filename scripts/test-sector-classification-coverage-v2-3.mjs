import assert from "node:assert/strict";
import {
  UNIVERSE_SECTOR_MODEL_VERSION,
  classifyIssuerSector,
} from "../lib/universe-sector-model-v2-3.mjs";
import {
  UNIVERSE_SCREENING_VERSION,
  UNIVERSE_SELECTION_VERSION,
  screenCompany,
} from "../lib/universe-screening-engine.mjs";
import { RESEARCH_CANDIDATE_PIPELINE_VERSION, buildResearchCandidatePipeline } from "../lib/research-candidate-pipeline.mjs";

assert.equal(UNIVERSE_SECTOR_MODEL_VERSION,"solpient-universe-sector-model-v2.3");
assert.equal(UNIVERSE_SCREENING_VERSION,"solpient-universe-screen-v2.3");
assert.equal(UNIVERSE_SELECTION_VERSION,"solpient-100-selection-v2.3");
assert.equal(RESEARCH_CANDIDATE_PIPELINE_VERSION,"research-candidate-pipeline-v2.3");

const obviousOperating=[
  ["UFI","UNIFI INC","2200","Textile Mill Products","Consumer Discretionary","consumer_discretionary"],
  ["UHAL","U-Haul Holding Co /NV/","7510","Services-Auto Rental & Leasing (No Drivers)","Industrials","industrial"],
  ["UNF","UNIFIRST CORP","7200","Services-Personal Services","Industrials","industrial"],
  ["VFF","Village Farms International, Inc.","0100","Agricultural Production-Crops","Consumer Staples","consumer_staples"],
  ["VLTO","Veralto Corp","3825","Instruments For Meas & Testing of Electricity & Elec Signals","Industrials","industrial"],
  ["VNT","Vontier Corp","3824","Totalizing Fluid Meters & Counting Devices","Industrials","industrial"],
  ["VRA","Vera Bradley, Inc.","3100","Leather & Leather Products","Consumer Discretionary","consumer_discretionary"],
  ["VTSI","VirTra, Inc","3990","Miscellaneous Manufacturing Industries","Industrials","industrial"],
  ["VVV","VALVOLINE INC","2990","Miscellaneous Products of Petroleum & Coal","Consumer Discretionary","consumer_discretionary"],
  ["WAT","WATERS CORP /DE/","3826","Laboratory Analytical Instruments","Health Care","healthcare"],
  ["WBTN","WEBTOON Entertainment Inc.","2741","Miscellaneous Publishing","Communication Services","communication"],
  ["WHF","WhiteHorse Finance, Inc.",null,"","Financials","financial_other"],
  ["WLY","JOHN WILEY & SONS, INC.","2731","Books: Publishing or Publishing & Printing","Communication Services","communication"],
  ["WMS","ADVANCED DRAINAGE SYSTEMS, INC.","3086","Plastics Foam Products","Industrials","industrial"],
  ["WMT","Walmart Inc.","5331","Retail-Variety Stores","Consumer Staples","consumer_staples"],
  ["YETI","YETI Holdings, Inc.","3949","Sporting & Athletic Goods, NEC","Consumer Discretionary","consumer_discretionary"],
  ["YHGJ","YUNHONG GREEN CTI LTD.","3060","Fabricated Rubber Products, NEC","Materials","cyclical"],
  ["ZEO","Zeo Energy Corp.","1700","Construction - Special Trade Contractors","Industrials","industrial"],
];

for(const [ticker,companyName,sic,sicDescription,sector,profile] of obviousOperating){
  const r=classifyIssuerSector({
    ticker,companyName,sic,sicDescription,
    existingSector:"Unknown",existingScreenProfile:"general",
  });
  assert.equal(r.sector,sector,ticker+" sector");
  assert.equal(r.screen_profile,profile,ticker+" profile");
  assert.equal(r.classification_review_required,false,ticker+" must not require review");
  assert.notEqual(r.classification_method,"review_required",ticker+" must not remain review-only");
}

const reviewCases=[
  ["VAI","Senmiao Technology Ltd","7510","Services-Auto Rental & Leasing (No Drivers)"],
  ["WW","WW INTERNATIONAL, INC.","7200","Services-Personal Services"],
  ["XWEL","XWELL, Inc.","7200","Services-Personal Services"],
];
for(const [ticker,companyName,sic,sicDescription] of reviewCases){
  const r=classifyIssuerSector({
    ticker,companyName,sic,sicDescription,
    existingSector:"Unknown",existingScreenProfile:"general",
  });
  assert.equal(r.sector,"Unknown",ticker);
  assert.equal(r.classification_method,"review_required",ticker);
  assert.equal(r.classification_review_required,true,ticker);
  assert.ok(r.classification_review_reason,ticker);
}

const genericAgriculture=classifyIssuerSector({
  ticker:"AGRI",sic:"0200",sicDescription:"Agricultural Production-Livestock",
});
assert.equal(genericAgriculture.sector,"Consumer Staples");
assert.equal(genericAgriculture.classification_method,"sic_family_rule");

const genericConstruction=classifyIssuerSector({
  ticker:"BUILD",sic:"1711",sicDescription:"Plumbing, Heating and Air-Conditioning",
});
assert.equal(genericConstruction.sector,"Industrials");

const genericPublishing=classifyIssuerSector({
  ticker:"PUB",sic:"2731",sicDescription:"Books: Publishing",
});
assert.equal(genericPublishing.sector,"Communication Services");

const genericPersonalServices=classifyIssuerSector({
  ticker:"PERSONAL",sic:"7200",sicDescription:"Services-Personal Services",
});
assert.equal(genericPersonalServices.classification_method,"review_required");
assert.equal(genericPersonalServices.classification_review_required,true);

const genericMiscManufacturing=classifyIssuerSector({
  ticker:"MISC",sic:"3990",sicDescription:"Miscellaneous Manufacturing Industries",
});
assert.equal(genericMiscManufacturing.classification_method,"review_required");

const insufficient=classifyIssuerSector({
  ticker:"NOINFO",companyName:"No Data Corp",sic:null,sicDescription:"",
  existingSector:"Unknown",existingScreenProfile:"general",
});
assert.equal(insufficient.classification_method,"review_required");
assert.match(insufficient.classification_review_reason,/Insufficient classification data/);

const strongUnknownFixture={
  market_cap:5_000_000_000,
  avg_dollar_volume_30d:10_000_000,
  price:50,
  roic:20,roe:20,fcf_margin:20,cash_conversion_pct:100,operating_margin:20,
  positive_fcf_years:5,positive_eps_years:5,positive_revenue_growth_years:5,
  operating_margin_volatility_pct:3,share_dilution_3y_pct:0,
  net_debt_to_ebitda:0,debt_to_equity:.2,interest_coverage:12,current_ratio:2,
  revenue_growth_3y_cagr:12,eps_growth_3y_cagr:15,fcf_growth_3y_cagr:15,
  price_to_fcf:15,trailing_pe:18,ev_to_ebitda:12,
};
const reviewScreen=screenCompany({
  ...strongUnknownFixture,
  ticker:"PERSONAL",
  company_name:"Ambiguous Personal Services",
  sic:"7200",
  sic_description:"Services-Personal Services",
  sector:"Unknown",
  screen_profile:"general",
});
assert.equal(reviewScreen.sector,"Unknown");
assert.equal(reviewScreen.sectorClassification.reviewRequired,true);
assert.ok(reviewScreen.evidenceCoveragePct<=69);
assert.notEqual(reviewScreen.state,"solpient_100_candidate");

const reviewPipeline=buildResearchCandidatePipeline({
  screenResult:{...reviewScreen,proposedForDeepResearch:true},
  companyExists:true,
  valuationInput:{currentPrice:50},
  researchInput:{scores:{},coverage:{}},
});
const classificationAction=reviewPipeline.nextActions.find(a=>a.type==="classification_review");
assert.ok(classificationAction);
assert.match(classificationAction.reason,/Personal Services|issuer-level review/);
assert.equal(reviewPipeline.screening.sectorClassification.reviewRequired,true);

console.log("Sector Classification Coverage V2.3 tests passed.");
