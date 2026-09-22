import assert from "node:assert/strict";
import { buildUniverseQAReport, UNIVERSE_QA_VERSION } from "../lib/universe-qa-engine.mjs";

const strong=(overrides={})=>({
  ticker:"GOOD",
  company_name:"Good Software",
  cik:"0000000001",
  sector:"Information Technology",
  industry:"Software",
  screen_profile:"software",
  sector_taxonomy_version:"solpient-sector-taxonomy-v2",
  market_cap:10_000_000_000,
  avg_dollar_volume_30d:25_000_000,
  price:100,
  roic:25,roe:30,fcf_margin:25,cash_conversion_pct:105,operating_margin:30,
  positive_fcf_years:5,positive_eps_years:5,positive_revenue_growth_years:5,
  operating_margin_volatility_pct:2,share_dilution_3y_pct:0,
  net_debt_to_ebitda:0,debt_to_equity:.1,interest_coverage:20,current_ratio:2,
  revenue_growth_3y_cagr:15,eps_growth_3y_cagr:18,fcf_growth_3y_cagr:17,
  price_to_fcf:18,trailing_pe:22,ev_to_ebitda:14,forward_pe:20,
  bankruptcy_flag:false,going_concern_flag:false,
  ...overrides,
});

const clean=buildUniverseQAReport([
  strong(),
  strong({
    ticker:"GOOD2",cik:"0000000002",company_name:"Good Software 2",
    price_to_fcf:22,trailing_pe:24,ev_to_ebitda:16,forward_pe:23,
  }),
],{
  thresholds:{
    max_shortlist_profile_pct:100,
    max_unknown_classification_pct:100,
    min_shortlist_effective_coverage_pct:60,
    min_shortlist_median_effective_coverage_pct:60,
  }
});
assert.equal(clean.qa_version,UNIVERSE_QA_VERSION);
assert.equal(clean.funnel.input_count,2);
assert.equal(clean.funnel.unique_ticker_count,2);
assert.equal(clean.duplicates.duplicateTickers.length,0);
assert.equal(clean.duplicates.duplicateIssuers.length,0);
assert.ok(clean.top_shortlist.length>0);
assert.equal(clean.status,"pass");

const bank=strong({
  ticker:"BANK",cik:"0000000003",company_name:"Strong Bank",
  sector:"Financials",industry:"Banks",screen_profile:"bank",
  roic:null,fcf_margin:null,cash_conversion_pct:null,operating_margin:null,
  roa:1.5,equity_to_assets_pct:12,
  positive_book_value_growth_years:5,book_value_growth_3y_cagr:10,
  price_to_fcf:null,ev_to_ebitda:null,
  trailing_pe:10,price_to_book:1.3,
  // Deliberately omit CET1/NIM/efficiency/asset-quality/credit-loss evidence.
});

const unknown=strong({
  ticker:"UNK",cik:"0000000004",company_name:"Unknown Co",
  sector:"Unknown",industry:"",screen_profile:"general",sector_taxonomy_version:null,
});

const duplicateIssuer=strong({
  ticker:"ALT",cik:"0000000001",company_name:"Duplicate Issuer Share Class",
});

const audited=buildUniverseQAReport([strong(),bank,unknown,duplicateIssuer]);
assert.equal(audited.status,"review_required");
assert.ok(audited.blockers>=1);
assert.equal(audited.duplicates.duplicateIssuers.length,1);
assert.ok(audited.coverage.ceiling_applied_count>=2);

const bankResult=audited.top_shortlist.find(x=>x.ticker==="BANK");
assert.ok(bankResult);
assert.equal(bankResult.state,"research_candidate");
assert.ok(bankResult.evidence_ceiling_pct<70);
assert.ok(bankResult.missing_critical_sector_evidence.length>=4);

const unknownScreened=audited.top_shortlist.find(x=>x.ticker==="UNK");
assert.ok(unknownScreened);
assert.equal(unknownScreened.state,"research_candidate");
assert.ok(unknownScreened.effective_coverage_pct<=69);

assert.ok(audited.findings.some(x=>x.key==="duplicate_issuers"));
assert.ok(audited.outliers.sectorEvidenceBlocked.some(x=>x.ticker==="BANK"));
assert.ok(audited.missing_metrics.some(x=>String(x.metric).startsWith("sector.")));
assert.ok(audited.distribution.shortlistProfiles.length>0);

const dupTicker=buildUniverseQAReport([strong(),strong({company_name:"Duplicate ticker",cik:"0000000009"})]);
assert.equal(dupTicker.duplicates.duplicateTickers.length,1);
assert.equal(dupTicker.status,"review_required");

console.log("Universe QA V1 tests passed.");
