import assert from "node:assert/strict";
import { canonicalizeIssuerMappings } from "../lib/universe-issuer-selection.mjs";

const input=[
  {cik:1,ticker:"ABR",exchange:"NYSE"},
  {cik:1,ticker:"ABR-PD",exchange:"NYSE"},
  {cik:1,ticker:"ABR-PE",exchange:"NYSE"},
  {cik:2,ticker:"ACGL",exchange:"Nasdaq"},
  {cik:2,ticker:"ACGLN",exchange:"Nasdaq"},
  {cik:2,ticker:"ACGLO",exchange:"Nasdaq"},
  {cik:3,ticker:"GOOG",exchange:"Nasdaq"},
  {cik:3,ticker:"GOOGL",exchange:"Nasdaq"},
  {cik:4,ticker:"AFJK",exchange:"Nasdaq"},
  {cik:4,ticker:"AFJKR",exchange:"Nasdaq"},
  {cik:4,ticker:"AFJKU",exchange:"Nasdaq"},
];
const out=canonicalizeIssuerMappings(input);
assert.equal(out.issuerCount,4);
assert.equal(out.removedSecurityMappings,7);
assert.deepEqual(out.selected.map(x=>x.ticker),["ABR","ACGL","AFJK","GOOG"]);
assert.deepEqual(out.aliases["1"],["ABR","ABR-PD","ABR-PE"]);
console.log("SEC universe issuer canonicalization tests passed.");
