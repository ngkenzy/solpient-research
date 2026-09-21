import assert from "node:assert/strict";
import { buildBaselineDraft, sanitizeSourceUrl } from "../lib/baseline-factory.mjs";

assert.equal(
  sanitizeSourceUrl("https://example.com/data?symbol=MSFT&apikey=secret-value"),
  "https://example.com/data?symbol=MSFT"
);

function quarter({ date, fiscalYear, period, revenue, netIncome, ocf, capex, fcf, shares, grossProfit, operatingIncome, rd, sbc, cash }) {
  return {
    period_end: date,
    fiscal_year: fiscalYear,
    fiscal_period: period,
    form: "10-Q",
    provider: "fmp",
    observed_at: date + "T20:00:00Z",
    filed_at: date,
    revenue,
    net_income: netIncome,
    operating_cash_flow: ocf,
    capital_expenditure: -Math.abs(capex),
    free_cash_flow: fcf,
    shares_outstanding: shares,
    source_url: "https://provider.test/income?symbol=MSFT&apikey=do-not-store",
    raw_payload: {
      income: {
        grossProfit,
        operatingIncome,
        researchAndDevelopmentExpenses: rd,
        interestExpense: 100,
      },
      cash_flow: {
        stockBasedCompensation: sbc,
        cashAtEndOfPeriod: cash,
      },
    },
  };
}

const fundamentals = [
  quarter({date:"2026-06-30",fiscalYear:2026,period:"Q4",revenue:1200,netIncome:300,ocf:500,capex:200,fcf:300,shares:100,grossProfit:800,operatingIncome:420,rd:120,sbc:30,cash:250}),
  quarter({date:"2026-03-31",fiscalYear:2026,period:"Q3",revenue:1100,netIncome:280,ocf:450,capex:180,fcf:270,shares:101,grossProfit:740,operatingIncome:390,rd:110,sbc:28,cash:240}),
  quarter({date:"2025-12-31",fiscalYear:2026,period:"Q2",revenue:1000,netIncome:260,ocf:420,capex:170,fcf:250,shares:102,grossProfit:680,operatingIncome:350,rd:105,sbc:27,cash:230}),
  quarter({date:"2025-09-30",fiscalYear:2026,period:"Q1",revenue:900,netIncome:240,ocf:390,capex:160,fcf:230,shares:103,grossProfit:610,operatingIncome:320,rd:100,sbc:25,cash:220}),
  quarter({date:"2025-06-30",fiscalYear:2025,period:"Q4",revenue:1000,netIncome:230,ocf:370,capex:150,fcf:220,shares:104,grossProfit:650,operatingIncome:300,rd:95,sbc:24,cash:210}),
];

const result = buildBaselineDraft({
  company: { ticker:"MSFT", company_name:"Microsoft Corporation" },
  market: {
    price: 500,
    market_cap: 50000,
    trading_date:"2026-09-18",
    observed_at:"2026-09-20T10:00:00Z",
    source_url:"https://market.test/MSFT?token=secret",
  },
  fundamentals,
  filings: [],
  generatedAt:"2026-09-20T12:00:00Z",
});

assert.equal(result.industryModule, "software_platform");
assert.equal(result.validation.valid, false);
assert.equal(result.payload.factory.auto_publish, false);
assert.ok(result.evidenceCompletenessPct > 50);

const metrics = new Map(result.payload.metric_observations.map((row) => [row.metric_key + ":" + row.module, row]));
assert.equal(metrics.get("free_cash_flow:universal").value_numeric, 1050);
assert.ok(Math.abs(metrics.get("revenue_growth_1y:universal").value_numeric - 20) < 1e-9);
assert.equal(metrics.get("rd_to_revenue:software_platform").status, "available");
assert.equal(metrics.get("cloud_or_subscription_growth:software_platform").status, "not_available");



const unlabeledFundamentals = [
  quarter({date:"2026-06-30",fiscalYear:2026,period:null,revenue:15034,netIncome:-248,ocf:3000,capex:500,fcf:2500,shares:5700,grossProfit:10940,operatingIncome:3500,rd:2500,sbc:250,cash:1000}),
  quarter({date:"2026-03-31",fiscalYear:2026,period:null,revenue:14450,netIncome:2687,ocf:3200,capex:500,fcf:2700,shares:5700,grossProfit:10400,operatingIncome:3400,rd:2500,sbc:250,cash:1000}),
  quarter({date:"2025-12-31",fiscalYear:2025,period:null,revenue:17557,netIncome:-1648,ocf:4500,capex:600,fcf:3900,shares:5700,grossProfit:12000,operatingIncome:3000,rd:2700,sbc:250,cash:1000}),
  quarter({date:"2025-09-30",fiscalYear:2025,period:null,revenue:16654,netIncome:3541,ocf:4300,capex:500,fcf:3800,shares:5700,grossProfit:11800,operatingIncome:3600,rd:2600,sbc:250,cash:1000}),
  quarter({date:"2025-06-30",fiscalYear:2025,period:null,revenue:14653,netIncome:2910,ocf:2200,capex:400,fcf:1800,shares:5700,grossProfit:10500,operatingIncome:3300,rd:2400,sbc:250,cash:1000}),
];

const unlabeled = buildBaselineDraft({
  company:{ticker:"PFE",company_name:"Pfizer Inc."},
  market:{price:27.66,market_cap:157600000000,trading_date:"2026-09-18",observed_at:"2026-09-18T20:00:00Z",source_url:"https://market.test/PFE"},
  fundamentals:unlabeledFundamentals,
  filings:[],
  generatedAt:"2026-09-20T12:00:00Z",
});
const unlabeledMetrics=new Map(unlabeled.payload.metric_observations.map((row)=>[row.metric_key+":"+row.module,row]));
assert.ok(Math.abs(unlabeledMetrics.get("revenue_growth_1y:universal").value_numeric-((15034/14653-1)*100))<1e-9);

const serialized = JSON.stringify(result.payload);
assert.equal(serialized.includes("do-not-store"), false);
assert.equal(serialized.includes("secret-value"), false);

console.log("Baseline Factory v1 tests passed.");
