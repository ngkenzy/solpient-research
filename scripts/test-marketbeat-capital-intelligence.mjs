import assert from "node:assert/strict";
import {
  marketBeatPageLooksValid,
  normalizeMarketBeatInsiders,
  normalizeMarketBeatInstitutional,
} from "../lib/marketbeat-capital-intelligence.mjs";

const company={id:"msft-id",ticker:"MSFT",company_name:"Microsoft Corporation"};

const insiderHtml=`
<html><body><h1>Microsoft (MSFT) Insider Trading & Ownership</h1>
<h2>Microsoft (NASDAQ:MSFT) Insider Buying and Selling Activity</h2>
<div>Number Of Insiders Buying (Last 12 Months) 1</div>
<div>Number Of Insiders Selling (Last 12 Months) 7</div>
<table><tbody>
<tr><td>9/14/2026</td><td>Amy Hood EVP</td><td>Sell</td><td>41,674</td><td>$498.27</td><td>$20,764,903.98</td><td>Details</td></tr>
<tr><td>9/1/2026</td><td>Satya Nadella CEO</td><td>Sell</td><td>86,525</td><td>$501.46</td><td>$43,388,826.50</td><td>Details</td></tr>
<tr><td>8/3/2026</td><td>Ro Khanna House (D-CA)</td><td>Buy</td><td></td><td>$487.65</td><td>$15,001 - $50,000</td><td>Details</td></tr>
</tbody></table></body></html>`;
assert.equal(marketBeatPageLooksValid(insiderHtml,{ticker:"MSFT",kind:"insider"}),true);
const insiders=normalizeMarketBeatInsiders({
  company,html:insiderHtml,sourceUrl:"https://example.test/msft/insider-trades/",verifiedAt:"2026-09-20T20:00:00Z",
});
assert.equal(insiders.rows.length,2);
assert.equal(insiders.rows[0].actor_name,"Amy Hood");
assert.equal(insiders.rows[0].actor_detail,"EVP");
assert.equal(insiders.rows[0].shares,41674);
assert.equal(insiders.rows[0].price,498.27);
assert.equal(insiders.rows[0].value,20764903.98);
assert.equal(insiders.coverage.status,"activity_found");

const noInsiderHtml=`
<html><body><h1>TEST Insider Trading & Ownership</h1>
<h2>TEST Insider Buying and Selling Activity</h2>
<div>Number Of Insiders Buying (Last 12 Months) 0</div>
<div>Number Of Insiders Selling (Last 12 Months) 0</div>
<table><tbody></tbody></table></body></html>`;
const none=normalizeMarketBeatInsiders({
  company:{...company,ticker:"TEST"},html:noInsiderHtml,sourceUrl:"https://example.test/test/insider-trades/",verifiedAt:"2026-09-20T20:00:00Z",
});
assert.equal(none.rows.length,0);
assert.equal(none.coverage.status,"verified_none");

const oldInsiderHtml=`
<html><body><h1>TEST Insider Trading & Ownership</h1>
<h2>TEST Insider Buying and Selling Activity</h2>
<div>Number Of Insiders Buying (Last 12 Months) 0</div>
<div>Number Of Insiders Selling (Last 12 Months) 0</div>
<table><tbody>
<tr><td>2/13/2025</td><td>Older Director Director</td><td>Buy</td><td>1,000</td><td>$25.00</td><td>$25,000</td><td>Details</td></tr>
</tbody></table></body></html>`;
const historicalOnly=normalizeMarketBeatInsiders({
  company:{...company,ticker:"TEST"},html:oldInsiderHtml,sourceUrl:"https://example.test/test/insider-trades/",verifiedAt:"2026-09-20T20:00:00Z",
});
assert.equal(historicalOnly.rows.length,1);
assert.equal(historicalOnly.coverage.status,"verified_none");
assert.equal(historicalOnly.coverage.record_count,0);

const institutionHtml=`
<html><body><h1>Microsoft (MSFT) Institutional Ownership</h1>
<h2>Institutional Ownership Changes (13F Filings) for Microsoft (NASDAQ:MSFT)</h2>
<table><tbody>
<tr><td>9/18/2026</td><td>Security National Bank of SO Dak</td><td>18,949</td><td>$7.07M</td><td>3.3%</td><td>-10.2%</td><td>0.000%</td><td>Details</td></tr>
<tr><td>9/18/2026</td><td>Security National Bank of Sioux City Iowa IA</td><td>22,364</td><td>$8.34M</td><td>3.4%</td><td>+35.9%</td><td>0.000%</td><td>Details</td></tr>
<tr><td>9/18/2026</td><td>Security National Bank of Sioux City Iowa IA</td><td>22,364</td><td>$8.34M</td><td>3.4%</td><td>+35.9%</td><td>0.000%</td><td>Duplicate rendered row</td></tr>
</tbody></table></body></html>`;
assert.equal(marketBeatPageLooksValid(institutionHtml,{ticker:"MSFT",kind:"institutional"}),true);
const institutions=normalizeMarketBeatInstitutional({
  company,html:institutionHtml,sourceUrl:"https://example.test/msft/institutional-ownership/",verifiedAt:"2026-09-20T20:00:00Z",
});
assert.equal(institutions.rows.length,2);
assert.equal(institutions.rows[0].shares,18949);
assert.equal(institutions.rows[0].value,7070000);
assert.equal(institutions.rows[0].change_pct,-10.2);
assert.equal(institutions.rows[0].action,"Reduced");
assert.equal(institutions.rows[1].action,"Increased");
assert.equal(institutions.coverage.status,"activity_found");

console.log("MarketBeat capital intelligence tests passed.");
