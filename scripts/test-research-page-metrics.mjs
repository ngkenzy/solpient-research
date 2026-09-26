// Tests for the metric compute helpers used by app/research/[ticker]/page.tsx.
// The pure functions under test are COPIES of the helpers defined at the top
// of app/research/[ticker]/page.tsx — kept dependency-free so they run with
// plain `node`. If you change the logic in page.tsx, mirror the change here.
// Run: node scripts/test-research-page-metrics.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

// ---------- helpers (mirrors app/research/[ticker]/page.tsx) ----------
function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function field(row, key) {
  if (row == null) return null;
  return asNumber(row[key]);
}

function rawPath(obj, keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[k];
  }
  return asNumber(cur);
}

/** Fundamental snapshot normalized into numbers + period identity. */
function normalizeFundSnap(row) {
  return {
    period_end: typeof row?.period_end === "string" ? row.period_end : "",
    form: typeof row?.form === "string" ? row.form : null,
    revenue: field(row, "revenue"),
    net_income: field(row, "net_income"),
    free_cash_flow: field(row, "free_cash_flow"),
    eps_diluted:
      field(row, "eps_diluted") ?? rawPath(row?.raw_payload, ["income", "eps_diluted"]),
    gross_profit:
      field(row, "gross_profit") ??
      rawPath(row?.raw_payload, ["income", "grossProfit"]),
    operating_income:
      field(row, "operating_income") ??
      rawPath(row?.raw_payload, ["income", "operatingIncome"]),
  };
}

/**
 * One row per distinct period_end (newest first), preferring 10-Q rows over
 * 10-K rows for the same period so quarterly sums never double-count an
 * annual row.
 */
function dedupePeriods(rows) {
  const byPeriod = new Map();
  for (const r of rows) {
    if (!r.period_end) continue;
    const existing = byPeriod.get(r.period_end);
    if (!existing) {
      byPeriod.set(r.period_end, r);
    } else if (existing.form !== "10-Q" && r.form === "10-Q") {
      byPeriod.set(r.period_end, r);
    }
  }
  return [...byPeriod.values()].sort((a, b) =>
    a.period_end < b.period_end ? 1 : a.period_end > b.period_end ? -1 : 0,
  );
}

/** Sum of `count` quarterly rows starting at index `start`; null if any missing. */
function sumQuarterlyWindow(series, get, start, count) {
  const window = series.slice(start, start + count);
  if (window.length < count) return null;
  if (window.some((s) => s.form !== "10-Q")) return null;
  let total = 0;
  for (const s of window) {
    const v = get(s);
    if (v == null) return null;
    total += v;
  }
  return total;
}

/** Latest 10-K row, if any (a single annual row already IS a TTM). */
function latestAnnual(series, get) {
  const row = series.find((s) => s.form === "10-K");
  return row ? get(row) : null;
}

/**
 * Trailing-twelve-month value: sum of the newest 4 quarterly rows, else the
 * newest annual row. Null when neither is fully available — never estimated.
 */
function ttmField(series, get) {
  const quarterly = sumQuarterlyWindow(series, get, 0, 4);
  if (quarterly != null) return quarterly;
  return latestAnnual(series, get);
}

/**
 * Year-over-year % change of the TTM value: newest-4 quarters vs the prior
 * 4 quarters, else newest annual vs prior annual. Null if either side is
 * unavailable or the base is zero.
 */
function yoyPct(series, get) {
  const current = sumQuarterlyWindow(series, get, 0, 4);
  const prior = sumQuarterlyWindow(series, get, 4, 4);
  if (current != null && prior != null && prior !== 0) {
    return ((current - prior) / Math.abs(prior)) * 100;
  }
  const annuals = series.filter((s) => s.form === "10-K");
  const a0 = annuals[0] ? get(annuals[0]) : null;
  const a1 = annuals[1] ? get(annuals[1]) : null;
  if (a0 != null && a1 != null && a1 !== 0) {
    return ((a0 - a1) / Math.abs(a1)) * 100;
  }
  return null;
}

/** Margin/ratio as a percent; null on missing inputs or zero denominator. */
function pctOf(numerator, denominator) {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

/** Price multiple of a per-share value; null on missing/non-positive inputs. */
function priceMultiple(price, perShare) {
  if (price == null || perShare == null || perShare === 0) return null;
  return price / perShare;
}

function dayChangePct(marketRows) {
  const latest = marketRows[0];
  if (!latest) return null;
  const price = asNumber(latest.price);
  const reference =
    asNumber(latest.previous_close) ?? asNumber(marketRows[1]?.price);
  if (price == null || reference == null || reference === 0) return null;
  return ((price - reference) / Math.abs(reference)) * 100;
}

/** 52-week high/low over rows whose trading_date is within 365 days of latest. */
function highLow52w(marketRows) {
  const latest = marketRows[0];
  if (!latest?.trading_date) return null;
  const cutoff = new Date(latest.trading_date + "T00:00:00Z").getTime() - 365 * 86400000;
  const prices = [];
  for (const row of marketRows) {
    if (!row?.trading_date) continue;
    if (new Date(row.trading_date + "T00:00:00Z").getTime() < cutoff) continue;
    const p = asNumber(row.price);
    if (p != null) prices.push(p);
  }
  if (prices.length === 0) return null;
  return { high: Math.max(...prices), low: Math.min(...prices) };
}

function analystTarget(row) {
  if (!row) return null;
  const raw = row.raw_payload ?? {};
  return (
    asNumber(raw.analyst_target) ??
    asNumber(raw.analyst_price_target) ??
    asNumber(raw.price_target) ??
    null
  );
}

function dividendYield(row) {
  if (!row) return null;
  const raw = row.raw_payload ?? {};
  return (
    asNumber(raw.dividend_yield_ttm) ?? asNumber(raw.dividend_yield) ?? null
  );
}

function targetGapPct(target, price) {
  if (target == null || price == null || price === 0) return null;
  return ((target - price) / Math.abs(price)) * 100;
}

// ---------- fixtures ----------
function q(period, revenue, netIncome, fcf, eps, gross, opInc) {
  return normalizeFundSnap({
    period_end: period,
    form: "10-Q",
    revenue,
    net_income: netIncome,
    free_cash_flow: fcf,
    eps_diluted: eps,
    raw_payload: { income: { grossProfit: gross, operatingIncome: opInc } },
  });
}

// 8 quarters: TTM revenue = 40, prior TTM revenue = 36 -> +11.11% YoY
const EIGHT_Q = [
  q("2026-06-30", 10, 2.0, 3.0, 0.5, 6.0, 3.0),
  q("2026-03-31", 10, 2.0, 3.0, 0.5, 6.0, 3.0),
  q("2025-12-31", 10, 2.0, 3.0, 0.5, 6.0, 3.0),
  q("2025-09-30", 10, 2.0, 3.0, 0.5, 6.0, 3.0),
  q("2025-06-30", 9, 1.8, 2.5, 0.45, 5.4, 2.7),
  q("2025-03-31", 9, 1.8, 2.5, 0.45, 5.4, 2.7),
  q("2024-12-31", 9, 1.8, 2.5, 0.45, 5.4, 2.7),
  q("2024-09-30", 9, 1.8, 2.5, 0.45, 5.4, 2.7),
];

// ---------- tests ----------
test("asNumber coerces numerics and rejects junk", () => {
  assert.equal(asNumber("12.5"), 12.5);
  assert.equal(asNumber(7), 7);
  assert.equal(asNumber(null), null);
  assert.equal(asNumber(""), null);
  assert.equal(asNumber("abc"), null);
  assert.equal(asNumber(NaN), null);
});

test("revenue TTM sums the newest 4 quarters", () => {
  assert.equal(ttmField(EIGHT_Q, (s) => s.revenue), 40);
});

test("revenue YoY compares TTM vs prior TTM", () => {
  const pct = yoyPct(EIGHT_Q, (s) => s.revenue);
  assert.ok(pct != null);
  assert.ok(Math.abs(pct - 11.1111111111) < 1e-9, `got ${pct}`);
});

test("margins divide TTM profit by TTM revenue", () => {
  const rev = ttmField(EIGHT_Q, (s) => s.revenue);
  const gross = ttmField(EIGHT_Q, (s) => s.gross_profit);
  const op = ttmField(EIGHT_Q, (s) => s.operating_income);
  assert.equal(rev, 40);
  assert.equal(gross, 24);
  assert.equal(pctOf(gross, rev), 60);
  assert.equal(pctOf(op, rev), 30);
});

test("EPS TTM and P/E multiple", () => {
  const epsTtm = ttmField(EIGHT_Q, (s) => s.eps_diluted);
  assert.equal(epsTtm, 2.0);
  assert.equal(priceMultiple(50, epsTtm), 25);
  assert.equal(priceMultiple(50, null), null);
  assert.equal(priceMultiple(50, 0), null);
});

test("FCF TTM sums free_cash_flow", () => {
  assert.equal(ttmField(EIGHT_Q, (s) => s.free_cash_flow), 12);
});

test("a missing quarter makes the TTM null, never estimated", () => {
  const broken = EIGHT_Q.map((s, i) =>
    i === 1 ? { ...s, revenue: null } : s,
  );
  assert.equal(ttmField(broken, (s) => s.revenue), null);
  assert.equal(yoyPct(broken, (s) => s.revenue), null);
});

test("fewer than 4 quarters falls back to the annual row", () => {
  const series = [
    q("2026-06-30", 10, 2, 3, 0.5, 6, 3),
    normalizeFundSnap({
      period_end: "2025-12-31",
      form: "10-K",
      revenue: 35,
      net_income: 7,
      free_cash_flow: 9,
      eps_diluted: 1.75,
      raw_payload: { income: { grossProfit: 21, operatingIncome: 10.5 } },
    }),
  ];
  assert.equal(ttmField(series, (s) => s.revenue), 35);
});

test("annual-only series supports annual YoY", () => {
  const series = [
    normalizeFundSnap({ period_end: "2025-12-31", form: "10-K", revenue: 40 }),
    normalizeFundSnap({ period_end: "2024-12-31", form: "10-K", revenue: 36 }),
  ];
  const pct = yoyPct(series, (s) => s.revenue);
  assert.ok(Math.abs(pct - 11.1111111111) < 1e-9, `got ${pct}`);
});

test("dedupePeriods prefers 10-Q over 10-K for the same period", () => {
  const rows = [
    normalizeFundSnap({ period_end: "2026-06-30", form: "10-K", revenue: 40 }),
    normalizeFundSnap({ period_end: "2026-06-30", form: "10-Q", revenue: 10 }),
    normalizeFundSnap({ period_end: "2026-03-31", form: "10-Q", revenue: 10 }),
  ];
  const series = dedupePeriods(rows);
  assert.equal(series.length, 2);
  assert.equal(series[0].form, "10-Q");
  assert.equal(series[0].period_end, "2026-06-30");
});

test("empty input yields null everywhere", () => {
  assert.equal(ttmField([], (s) => s.revenue), null);
  assert.equal(yoyPct([], (s) => s.revenue), null);
  assert.equal(pctOf(10, null), null);
  assert.equal(pctOf(10, 0), null);
  assert.equal(dayChangePct([]), null);
  assert.equal(highLow52w([]), null);
  assert.equal(analystTarget(null), null);
  assert.equal(dividendYield(null), null);
});

test("day change uses previous_close, else the prior row price", () => {
  assert.equal(
    dayChangePct([
      { price: 110, previous_close: 100, trading_date: "2026-09-25" },
      { price: 100, trading_date: "2026-09-24" },
    ]),
    10,
  );
  assert.equal(
    dayChangePct([
      { price: 110, previous_close: null, trading_date: "2026-09-25" },
      { price: 105, trading_date: "2026-09-24" },
    ]).toFixed(4),
    ((110 - 105) / 105 * 100).toFixed(4),
  );
  assert.equal(
    dayChangePct([{ price: 110, previous_close: null, trading_date: "2026-09-25" }]),
    null,
  );
});

test("52-week high/low ignores rows older than a year", () => {
  const rows = [
    { price: 50, trading_date: "2026-09-25" },
    { price: 60, trading_date: "2026-03-01" },
    { price: 999, trading_date: "2025-09-24" },
    { price: 40, trading_date: "2026-01-15" },
  ];
  const hl = highLow52w(rows);
  assert.equal(hl.high, 60);
  assert.equal(hl.low, 40);
});

test("analyst target and dividend yield read raw_payload with fallbacks", () => {
  assert.equal(
    analystTarget({ raw_payload: { analyst_target: 120 } }),
    120,
  );
  assert.equal(
    analystTarget({ raw_payload: { price_target: 130 } }),
    130,
  );
  assert.equal(
    dividendYield({ raw_payload: { dividend_yield_ttm: 1.5 } }),
    1.5,
  );
  assert.equal(dividendYield({ raw_payload: {} }), null);
});

test("target gap % is signed relative to price", () => {
  assert.equal(targetGapPct(120, 100), 20);
  assert.equal(targetGapPct(90, 100), -10);
  assert.equal(targetGapPct(120, 0), null);
});
