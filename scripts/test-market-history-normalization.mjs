import assert from "node:assert/strict";
import { marketNumber, positiveMarketPrice } from "../lib/market-history.mjs";

assert.equal(marketNumber(null),null);
assert.equal(marketNumber(undefined),null);
assert.equal(marketNumber(""),null);
assert.equal(marketNumber("  "),null);
assert.equal(marketNumber("123.45"),123.45);
assert.equal(positiveMarketPrice(null),null);
assert.equal(positiveMarketPrice(0),null);
assert.equal(positiveMarketPrice("0"),null);
assert.equal(positiveMarketPrice(-1),null);
assert.equal(positiveMarketPrice("275.42"),275.42);

console.log("Market history normalization tests passed.");
