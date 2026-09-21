import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeEodhdSecurity } from "../lib/universe-feed-eodhd.mjs";
import { screenCompany } from "../lib/universe-screening-engine.mjs";

const fixture=JSON.parse(fs.readFileSync(new URL("./fixtures/eodhd-universe-feed-sample.json",import.meta.url),"utf8"));
const row=normalizeEodhdSecurity({
  quote:fixture.quote,
  fundamental:fixture.fundamental,
  liquidity30d:fixture.liquidity,
});

assert.equal(row.ticker,"TEST");
assert.equal(row.market_cap,20000000000);
assert.equal(row.avg_dollar_volume_30d,50000000);
assert.equal(Math.round(row.roe),25);
assert.equal(Math.round(row.roic),20);
assert.ok(row.fcf_margin>15);
assert.equal(row.positive_fcf_years,5);
assert.equal(row.positive_eps_years,5);
assert.equal(row.positive_revenue_growth_years,4);
assert.ok(row.revenue_growth_3y_cagr>10);
assert.ok(row.price_to_fcf>10);
assert.equal(row.forward_pe,20);

const screened=screenCompany(row);
assert.notEqual(screened.state,"excluded");
assert.ok(screened.evidenceCoveragePct>=70);
assert.ok(screened.screenScore>60);

// Insufficient liquidity history must fail closed rather than fabricate a 30-day average.
const sparse=normalizeEodhdSecurity({
  quote:fixture.quote,
  fundamental:fixture.fundamental,
  liquidity30d:{averageDollarVolume:50000000,observationCount:8},
});
assert.equal(sparse.avg_dollar_volume_30d,null);
assert.equal(screenCompany(sparse).state,"excluded");

console.log("EODHD Universe Feed V1 tests passed.");
