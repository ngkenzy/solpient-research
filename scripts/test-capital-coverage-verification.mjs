import assert from "node:assert/strict";
import {
  normalizeCoverageCheck,
  summarizeCapitalCoverageMatrix,
} from "../lib/capital-intelligence-orchestrator.mjs";

const companies=[
  {id:"msft-id",ticker:"MSFT",company_name:"Microsoft Corporation"},
  {id:"aos-id",ticker:"AOS",company_name:"A. O. Smith Corporation"},
];
const companyByTicker=new Map(companies.map((company)=>[company.ticker,company]));

const negative=normalizeCoverageCheck({
  ticker:"MSFT",
  activity_type:"political",
  status:"verified_none",
  window_start:"2026-01-01",
  window_end:"2026-09-20",
  source_url:"https://example.test/msft/political",
  source_key:"msft-political-2026-09-20",
  notes:"No qualifying activity found in the stated window.",
},{provider:"web_verified",verifiedAt:"2026-09-20T20:00:00Z",companyByTicker});
assert.equal(negative.valid,true);
assert.equal(negative.row.status,"verified_none");
assert.equal(negative.row.company_id,"msft-id");

const badNegative=normalizeCoverageCheck({
  ticker:"AOS",
  activity_type:"insider",
  status:"verified_none",
},{provider:"web_verified",verifiedAt:"2026-09-20T20:00:00Z",companyByTicker});
assert.equal(badNegative.valid,false);
assert.ok(badNegative.errors.includes("verified_none requires a source_url"));

const badTicker=normalizeCoverageCheck({
  ticker:"ZZZZ",
  activity_type:"insider",
  status:"partial",
},{provider:"web_verified",companyByTicker});
assert.equal(badTicker.valid,false);

const checks=[
  {company_id:"msft-id",activity_type:"insider",status:"activity_found",provider:"web_verified",verified_at:"2026-09-20T20:00:00Z"},
  {company_id:"msft-id",activity_type:"institutional",status:"verified_none",provider:"web_verified",verified_at:"2026-09-20T20:00:00Z"},
  {company_id:"msft-id",activity_type:"political",status:"verified_none",provider:"web_verified",verified_at:"2026-09-20T20:00:00Z"},
  {company_id:"aos-id",activity_type:"insider",status:"pending",provider:"orchestrator"},
  {company_id:"aos-id",activity_type:"institutional",status:"partial",provider:"web_verified"},
  {company_id:"aos-id",activity_type:"political",status:"unavailable",provider:"quiver"},
];
const activity=[
  {company_id:"msft-id",activity_type:"insider",provider:"web_verified",verified_at:"2026-09-20T20:00:00Z"},
];

const matrix=summarizeCapitalCoverageMatrix(checks,activity,companies);
const msft=matrix.find((row)=>row.ticker==="MSFT");
const aos=matrix.find((row)=>row.ticker==="AOS");
assert.equal(msft.fully_reviewed,true);
assert.equal(msft.fully_verified,true);
assert.equal(msft.categories_complete,3);
assert.equal(msft.categories.insider.activity_count,1);
assert.equal(aos.fully_reviewed,false);
assert.equal(aos.fully_verified,false);
assert.equal(aos.categories_reviewed,2);
assert.equal(aos.categories_complete,0);

console.log("Capital coverage verification tests passed.");
