import assert from "node:assert/strict";
import { dedupeFundamentalSnapshots } from "../lib/sec-companyfacts.mjs";

const base={
  company_id:"11111111-1111-1111-1111-111111111111",
  provider:"sec_companyfacts",
  period_end:"2026-06-30",
  form:"10-Q",
  observed_at:"2026-09-25T00:00:00.000Z",
  fiscal_year:2026,
  fiscal_period:"Q2",
  revenue:100,
  net_income:10,
  operating_cash_flow:20,
  capital_expenditure:-5,
  free_cash_flow:15,
  shares_outstanding:50,
  eps_diluted:0.2,
  raw_payload:{balance_sheet:{cashAndCashEquivalents:30,totalDebt:40}},
};

const older={...base,filed_at:"2026-07-20",revenue:100};
const newer={...base,filed_at:"2026-08-01",revenue:110};
const otherForm={...base,form:"10-K",filed_at:"2026-08-02",revenue:120};
const lessComplete={
  ...base,
  period_end:"2026-03-31",
  filed_at:"2026-05-01",
  revenue:90,
  net_income:null,
  operating_cash_flow:null,
  capital_expenditure:null,
  free_cash_flow:null,
  shares_outstanding:null,
  eps_diluted:null,
  raw_payload:{balance_sheet:{cashAndCashEquivalents:null,totalDebt:null}},
};
const moreComplete={...lessComplete,net_income:9,operating_cash_flow:18};

const result=dedupeFundamentalSnapshots([older,newer,otherForm,lessComplete,moreComplete]);

assert.equal(result.duplicateRowsRemoved,2);
assert.equal(result.rows.length,3);

const q2=result.rows.find(row=>row.period_end==="2026-06-30"&&row.form==="10-Q");
assert.equal(q2.revenue,110,"newer filing must win duplicate database key");

const q1=result.rows.find(row=>row.period_end==="2026-03-31"&&row.form==="10-Q");
assert.equal(q1.net_income,9,"more complete row must win when filing dates tie");

assert.ok(result.rows.some(row=>row.form==="10-K"),"different form must remain a separate database key");

console.log(JSON.stringify({
  status:"ok",
  rows:result.rows.length,
  duplicate_rows_removed:result.duplicateRowsRemoved
},null,2));
