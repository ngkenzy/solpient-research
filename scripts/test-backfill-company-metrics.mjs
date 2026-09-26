// scripts/test-backfill-company-metrics.mjs
//
// node:assert/strict tests for scripts/backfill-company-metrics.mjs.
// No network: fixtures only. Run with plain `node`:
//   node scripts/test-backfill-company-metrics.mjs

import { strict as assert } from "node:assert";
import {
  METHODOLOGY_VERSION,
  MARKET_PROVIDER,
  num,
  cik10,
  parseSecTickerMap,
  computeDividendYieldTtm,
  parseYahooChartResult,
  isLightTier,
  extractAnalystTarget,
  buildMarketSnapshotRow,
  withMethodologyVersion,
} from "./backfill-company-metrics.mjs";
import { normalizeCompanyFacts, SEC_PROVIDER } from "../lib/sec-companyfacts.mjs";
import {
  normalizeYahooFundamentals,
  YAHOO_FUNDAMENTALS_PROVIDER,
} from "../lib/yahoo-fundamentals.mjs";
import { industryModuleForTicker } from "../lib/industry-modules.mjs";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log("ok -", name);
}

const NOW = Date.parse("2026-09-26T12:00:00Z");
const ts = (date) => Math.floor(Date.parse(date + "T00:00:00Z") / 1000);

// ---------------------------------------------------------------------------
// Fixture 1: Yahoo chart v8 payload (ACME, equity, 4 quarterly divs in TTM +
// one stale div that must be excluded).
// ---------------------------------------------------------------------------
const t0 = ts("2026-09-24");
const t1 = ts("2026-09-25");
const d1 = String(ts("2026-09-10"));
const d2 = String(ts("2026-06-10"));
const d3 = String(ts("2026-03-10"));
const d4 = String(ts("2025-12-10"));
const dOld = String(ts("2024-01-10"));
const chartResult = {
  meta: {
    currency: "USD",
    exchangeName: "NasdaqGS",
    instrumentType: "EQUITY",
    regularMarketPrice: 100,
    previousClose: 98,
  },
  timestamp: [t0, t1],
  indicators: { quote: [{ close: [98, 100], volume: [1000000, 1200000] }] },
  events: {
    dividends: {
      [d1]: { amount: 0.25, date: Number(d1) },
      [d2]: { amount: 0.25, date: Number(d2) },
      [d3]: { amount: 0.25, date: Number(d3) },
      [d4]: { amount: 0.25, date: Number(d4) },
      [dOld]: { amount: 0.25, date: Number(dOld) },
    },
  },
};

check("parseYahooChartResult: price/prev-close/volume/trading date", () => {
  const p = parseYahooChartResult(chartResult, { nowMs: NOW });
  assert.equal(p.price, 100);
  assert.equal(p.previousClose, 98);
  assert.equal(p.volume, 1200000);
  assert.equal(p.tradingDate, "2026-09-25");
  assert.equal(p.instrumentType, "EQUITY");
  assert.equal(p.currency, "USD");
});

check("computeDividendYieldTtm: 4 quarterly divs / price, stale div excluded", () => {
  const y = computeDividendYieldTtm(chartResult.events.dividends, 100, NOW);
  assert.ok(Math.abs(y - 0.01) < 1e-12, "expected 0.01, got " + y);
  assert.equal(computeDividendYieldTtm({}, 100, NOW), null);
  assert.equal(computeDividendYieldTtm(chartResult.events.dividends, 0, NOW), null);
});

check("parseYahooChartResult: falls back to meta.previousClose", () => {
  const single = {
    meta: { instrumentType: "EQUITY", previousClose: 97 },
    timestamp: [t1],
    indicators: { quote: [{ close: [100], volume: [5] }] },
    events: {},
  };
  const p = parseYahooChartResult(single, { nowMs: NOW });
  assert.equal(p.previousClose, 97);
});

check("parseYahooChartResult: throws on empty closes", () => {
  assert.throws(() =>
    parseYahooChartResult({ timestamp: [], indicators: { quote: [{}] } })
  );
});

// ---------------------------------------------------------------------------
// Light tier
// ---------------------------------------------------------------------------
check("isLightTier: no CIK -> light; ETF instrument -> light; equity -> full", () => {
  assert.equal(isLightTier({ cik: null, instrumentType: "EQUITY" }), true);
  assert.equal(isLightTier({ cik: "", instrumentType: "EQUITY" }), true);
  assert.equal(isLightTier({ cik: "0000123456", instrumentType: "ETF" }), true);
  assert.equal(isLightTier({ cik: "0000123456", instrumentType: "mutualfund" }), true);
  assert.equal(isLightTier({ cik: "0000123456", instrumentType: "EQUITY" }), false);
  assert.equal(isLightTier({ cik: "123456", instrumentType: null }), false);
});

check("cik10: pads and validates", () => {
  assert.equal(cik10("123456"), "0000123456");
  assert.equal(cik10("0000123456"), "0000123456");
  assert.equal(cik10(null), null);
  assert.equal(cik10("abc"), null);
});

check("parseSecTickerMap: fields/data format", () => {
  const map = parseSecTickerMap({
    fields: ["cik", "name", "ticker", "exchange"],
    data: [
      [320193, "Apple Inc", "AAPL", "Nasdaq"],
      [789019, "MICROSOFT CORP", "msft", "Nasdaq"],
    ],
  });
  assert.equal(map.get("AAPL"), "0000320193");
  assert.equal(map.get("MSFT"), "0000789019");
  assert.equal(parseSecTickerMap({}).size, 0);
});

// ---------------------------------------------------------------------------
// Market snapshot row build
// ---------------------------------------------------------------------------
check("buildMarketSnapshotRow: shape, upsert keys, raw_payload contract", () => {
  const p = parseYahooChartResult(chartResult, { nowMs: NOW });
  const row = buildMarketSnapshotRow({
    companyId: "11111111-1111-1111-1111-111111111111",
    symbol: "acme",
    parsed: p,
    sharesOutstanding: 500000000,
    analystTarget: { target: 150.5, high: 180, low: 120 },
    observedAt: "2026-09-26T12:00:00Z",
  });
  assert.equal(row.provider, MARKET_PROVIDER);
  assert.equal(row.symbol, "ACME");
  assert.equal(row.trading_date, "2026-09-25");
  assert.equal(row.price, 100);
  assert.equal(row.previous_close, 98);
  assert.equal(row.volume, 1200000);
  assert.equal(row.market_cap, 50000000000);
  assert.ok(row.source_url.includes("ACME"));
  // Worker C read contract: raw_payload carries dividend yield, analyst
  // target and methodology version.
  assert.equal(row.raw_payload.methodology_version, METHODOLOGY_VERSION);
  assert.ok(Math.abs(row.raw_payload.dividend_yield_ttm - 0.01) < 1e-12);
  assert.deepEqual(row.raw_payload.analyst_target, {
    target: 150.5,
    high: 180,
    low: 120,
  });
  assert.equal(row.raw_payload.instrument_type, "EQUITY");
});

check("buildMarketSnapshotRow: null shares -> null market cap", () => {
  const p = parseYahooChartResult(chartResult, { nowMs: NOW });
  const row = buildMarketSnapshotRow({
    companyId: "x",
    symbol: "ACME",
    parsed: p,
    sharesOutstanding: null,
    analystTarget: null,
    observedAt: "2026-09-26T12:00:00Z",
  });
  assert.equal(row.market_cap, null);
  assert.equal(row.raw_payload.analyst_target, null);
});

check("withMethodologyVersion: stamps every row, keeps existing payload", () => {
  const rows = withMethodologyVersion([
    { period_end: "2026-06-30", raw_payload: { provider: "sec_companyfacts" } },
  ]);
  assert.equal(rows[0].raw_payload.methodology_version, METHODOLOGY_VERSION);
  assert.equal(rows[0].raw_payload.provider, "sec_companyfacts");
  assert.equal(rows[0].period_end, "2026-06-30");
});

// ---------------------------------------------------------------------------
// Analyst target extraction
// ---------------------------------------------------------------------------
check("extractAnalystTarget: finds nested target, null when absent", () => {
  const t = extractAnalystTarget({
    data: { summaryData: { oneYrTarget: "150.5", other: "x" } },
  });
  assert.deepEqual(t, { target: 150.5, high: null, low: null });
  const hl = extractAnalystTarget({ a: [{ targetHigh: 180 }, { targetLow: 120 }] });
  assert.deepEqual(hl, { target: null, high: 180, low: 120 });
  assert.equal(extractAnalystTarget({ data: { symbol: "ACME" } }), null);
  assert.equal(extractAnalystTarget(null), null);
});

// ---------------------------------------------------------------------------
// Fixture 2: SEC companyfacts excerpt -> normalizeCompanyFacts (reused lib).
// ---------------------------------------------------------------------------
function secFact(start, end, val, fy, fp, filed, accn) {
  return { start, end, val, fy, fp, form: "10-Q", filed, accn };
}
const companyFacts = {
  cik: "0000123456",
  entityName: "Acme Corp",
  facts: {
    "us-gaap": {
      RevenueFromContractWithCustomerExcludingAssessedTax: {
        units: {
          USD: [
            secFact("2026-01-01", "2026-03-31", 900, 2026, "Q2", "2026-05-05", "a1"),
            secFact("2026-04-01", "2026-06-30", 1000, 2026, "Q3", "2026-08-04", "a2"),
          ],
        },
      },
      NetIncomeLoss: {
        units: {
          USD: [
            secFact("2026-01-01", "2026-03-31", 180, 2026, "Q2", "2026-05-05", "a1"),
            secFact("2026-04-01", "2026-06-30", 200, 2026, "Q3", "2026-08-04", "a2"),
          ],
        },
      },
      NetCashProvidedByUsedInOperatingActivities: {
        units: {
          USD: [
            secFact("2026-01-01", "2026-03-31", 270, 2026, "Q2", "2026-05-05", "a1"),
            secFact("2026-04-01", "2026-06-30", 300, 2026, "Q3", "2026-08-04", "a2"),
          ],
        },
      },
      PaymentsToAcquirePropertyPlantAndEquipment: {
        units: {
          USD: [
            secFact("2026-01-01", "2026-03-31", -45, 2026, "Q2", "2026-05-05", "a1"),
            secFact("2026-04-01", "2026-06-30", -50, 2026, "Q3", "2026-08-04", "a2"),
          ],
        },
      },
      EarningsPerShareDiluted: {
        units: {
          "USD/shares": [
            secFact("2026-01-01", "2026-03-31", 1.2, 2026, "Q2", "2026-05-05", "a1"),
            secFact("2026-04-01", "2026-06-30", 1.5, 2026, "Q3", "2026-08-04", "a2"),
          ],
        },
      },
    },
  },
};

check("normalizeCompanyFacts: rows keyed (company_id, period_end, form, provider)", () => {
  const rows = normalizeCompanyFacts(companyFacts, {
    companyId: "11111111-1111-1111-1111-111111111111",
    ticker: "ACME",
    cik: "0000123456",
    observedAt: "2026-09-26T12:00:00Z",
    maxQuarters: 8,
  });
  assert.equal(rows.length, 2);
  const latest = rows[0];
  assert.equal(latest.period_end, "2026-06-30");
  assert.equal(latest.form, "10-Q");
  assert.equal(latest.fiscal_year, 2026);
  assert.equal(latest.fiscal_period, "Q3");
  assert.equal(latest.provider, SEC_PROVIDER);
  assert.equal(latest.company_id, "11111111-1111-1111-1111-111111111111");
  assert.equal(latest.revenue, 1000);
  assert.equal(latest.net_income, 200);
  assert.equal(latest.operating_cash_flow, 300);
  assert.equal(latest.capital_expenditure, -50);
  assert.equal(latest.free_cash_flow, 250); // 300 - |-50|
  assert.equal(latest.eps_diluted, 1.5);
  assert.ok(latest.source_url.includes("CIK0000123456"));
  // methodology stamp lands in raw_payload without clobbering provider meta
  const stamped = withMethodologyVersion(rows);
  assert.equal(stamped[0].raw_payload.methodology_version, METHODOLOGY_VERSION);
  assert.equal(stamped[0].raw_payload.provider, SEC_PROVIDER);
});

// ---------------------------------------------------------------------------
// Fixture 3: Yahoo fundamentals timeseries -> normalizeYahooFundamentals
// (reused lib, fallback path only).
// ---------------------------------------------------------------------------
const quarterlyBody = {
  timeseries: {
    result: [
      {
        quarterlyTotalRevenue: [
          { asOfDate: "2026-06-30", reportedValue: { raw: 1000 } },
        ],
        quarterlyNetIncome: [
          { asOfDate: "2026-06-30", reportedValue: { raw: 200 } },
        ],
        quarterlyDilutedEPS: [
          { asOfDate: "2026-06-30", reportedValue: { raw: 1.5 } },
        ],
        quarterlyDilutedAverageShares: [
          { asOfDate: "2026-06-30", reportedValue: { raw: 500000000 } },
        ],
      },
    ],
  },
};
const annualBody = {
  timeseries: {
    result: [
      {
        annualTotalRevenue: [
          { asOfDate: "2025-12-31", reportedValue: { raw: 3800 } },
        ],
        annualNetIncome: [
          { asOfDate: "2025-12-31", reportedValue: { raw: 900 } },
        ],
      },
    ],
  },
};

check("normalizeYahooFundamentals: quarterly + annual rows, provider tag", () => {
  const normalized = normalizeYahooFundamentals({
    company: { id: "c1", ticker: "ACME" },
    quarterlyBody,
    annualBody,
    observedAt: "2026-09-26T12:00:00Z",
    industryModule: null,
  });
  assert.equal(normalized.rows.length, 2);
  const q = normalized.rows[0];
  assert.equal(q.period_end, "2026-06-30");
  assert.equal(q.form, "10-Q");
  assert.equal(q.fiscal_year, 2026);
  assert.equal(q.revenue, 1000);
  assert.equal(q.net_income, 200);
  assert.equal(q.eps_diluted, 1.5);
  assert.equal(q.shares_outstanding, 500000000);
  assert.equal(q.provider, YAHOO_FUNDAMENTALS_PROVIDER);
  assert.equal(q.company_id, "c1");
  const a = normalized.rows[1];
  assert.equal(a.form, "10-K");
  assert.equal(a.fiscal_period, "FY");
  assert.equal(a.revenue, 3800);
});

check("industryModuleForTicker: returns module or null (no throw)", () => {
  const m = industryModuleForTicker("AAPL");
  assert.ok(m === null || typeof m === "string");
  const m2 = industryModuleForTicker("ZZZZ-NOT-A-TICKER");
  assert.equal(m2, null);
});

console.log("\nALL " + passed + " TESTS PASSED");
