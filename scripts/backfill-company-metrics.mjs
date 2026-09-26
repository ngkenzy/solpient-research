// scripts/backfill-company-metrics.mjs
//
// Per-company market + fundamental metrics backfill for the research page.
//
// REUSES the repo's existing metrics engine (no parallel engine):
//   - lib/sec-companyfacts.mjs  (normalizeCompanyFacts: SEC EDGAR companyfacts
//                                 -> fundamental_snapshots rows)
//   - lib/yahoo-fundamentals.mjs (normalizeYahooFundamentals: Yahoo timeseries
//                                 -> fundamental_snapshots rows, FALLBACK ONLY
//                                 when SEC has no data for a CIK-mapped issuer)
//   - lib/industry-modules.mjs  (industryModuleForTicker for the Yahoo fallback)
//
// Writes ONLY to public.market_snapshots and public.fundamental_snapshots.
// public.financial_metrics is keyed by research_run_id (per research run, not per
// company) and is intentionally NOT used here.
//
// Usage:
//   node scripts/backfill-company-metrics.mjs [--ticker=AAPL[,MSFT]] [--refresh]
//                                              [--dry-run] [--max-quarters=20]
//                                              [--cache-dir=.cache/backfill-company-metrics]
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)
//      SEC_CONTACT / SEC_USER_AGENT (SEC requires a contact User-Agent)
//      YAHOO_DATA_USER_AGENT (optional), NASDAQ_USER_AGENT (optional)

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import process from "node:process";
import {
  normalizeYahooFundamentals,
  YAHOO_FUNDAMENTALS_PROVIDER,
  YAHOO_FINANCIAL_KEYS,
} from "../lib/yahoo-fundamentals.mjs";
import { normalizeCompanyFacts, SEC_PROVIDER } from "../lib/sec-companyfacts.mjs";
import { industryModuleForTicker } from "../lib/industry-modules.mjs";

// ---------------------------------------------------------------------------
// Public constants & pure normalize/compute helpers (exported for tests).
// ---------------------------------------------------------------------------

export const METHODOLOGY_VERSION = "metrics-v1";
// Matches the existing scripts/sync-market-data.mjs convention.
export const MARKET_PROVIDER = "yahoo-chart";
export const SEC_FUNDAMENTALS_PROVIDER = SEC_PROVIDER; // "sec_companyfacts"
export const YAHOO_FUNDAMENTALS_PROVIDER_ALIAS = YAHOO_FUNDAMENTALS_PROVIDER; // "yahoo_fundamentals"

// Yahoo chart v8 meta.instrumentType values that are NOT operating companies.
export const NON_EQUITY_INSTRUMENT_TYPES = new Set([
  "ETF",
  "MUTUALFUND",
  "INDEX",
  "CURRENCY",
  "FUTURE",
  "OPTION",
  "CRYPTOCURRENCY",
]);

export function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export function cik10(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? digits.padStart(10, "0") : null;
}

// Parse https://www.sec.gov/files/company_tickers_exchange.json
// ({fields:[cik,name,ticker,exchange], data:[[cik,name,ticker,exchange],...]}).
export function parseSecTickerMap(body) {
  const map = new Map();
  if (Array.isArray(body?.data) && Array.isArray(body?.fields)) {
    const idx = Object.fromEntries(
      body.fields.map((f, i) => [String(f).toLowerCase(), i])
    );
    for (const row of body.data) {
      const ticker = String(row[idx.ticker] ?? "").toUpperCase().trim();
      const cik = cik10(row[idx.cik]);
      if (ticker && cik) map.set(ticker, cik);
    }
  }
  return map;
}

// TTM dividend yield from Yahoo chart v8 events.{dividends|divs}.
// divs: { "<unix-seconds>": { amount, date } }. Only the trailing 365 days count.
export function computeDividendYieldTtm(divs, price, nowMs = Date.now()) {
  const p = num(price);
  if (p === null || p <= 0) return null;
  const cutoff = nowMs - 365 * 86400000;
  let total = 0;
  let count = 0;
  for (const [ts, entry] of Object.entries(divs ?? {})) {
    const tms = Number(ts) * 1000;
    if (!Number.isFinite(tms) || tms < cutoff || tms > nowMs) continue;
    const amt = num(entry?.amount);
    if (amt === null || amt <= 0) continue;
    total += amt;
    count += 1;
  }
  if (!count) return null;
  return total / p;
}

// Normalize one Yahoo chart v8 result into market-snapshot inputs.
export function parseYahooChartResult(result, { nowMs = Date.now() } = {}) {
  if (!result) throw new Error("No chart result");
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const closes = quote.close ?? [];
  const volumes = quote.volume ?? [];

  // Last two valid daily sessions (latest first).
  const sessions = [];
  for (let i = closes.length - 1; i >= 0 && sessions.length < 2; i -= 1) {
    const price = num(closes[i]);
    if (price === null || price <= 0 || !timestamps[i]) continue;
    sessions.push({ price, volume: num(volumes[i]), ts: Number(timestamps[i]) });
  }
  if (!sessions.length) throw new Error("No valid daily close in chart result");

  const latest = sessions[0];
  const previous = sessions[1] ?? null;
  const meta = result.meta ?? {};
  const previousClose = previous
    ? previous.price
    : (num(meta.previousClose) ?? num(meta.chartPreviousClose) ?? null);
  const divs = result.events?.dividends ?? result.events?.divs ?? {};

  return {
    tradingDate: new Date(latest.ts * 1000).toISOString().slice(0, 10),
    price: latest.price,
    previousClose,
    volume: latest.volume,
    currency: meta.currency ?? null,
    exchangeName: meta.exchangeName ?? null,
    instrumentType: String(meta.instrumentType ?? "").toUpperCase() || null,
    regularMarketPrice: num(meta.regularMarketPrice),
    dividendYieldTtm:
      computeDividendYieldTtm(divs, latest.price, nowMs) ??
      num(meta.trailingAnnualDividendYield),
  };
}

// Light tier = price row ONLY, never fundamentals.
// Rule: no SEC CIK (funds/ETFs/cash-like tickers don't appear in SEC company
// filings) OR a non-equity Yahoo instrument type. public.companies has no
// holding_kind column, so this is the operative definition.
export function isLightTier({ cik, instrumentType }) {
  if (!cik10(cik)) return true;
  if (
    instrumentType &&
    NON_EQUITY_INSTRUMENT_TYPES.has(String(instrumentType).toUpperCase())
  )
    return true;
  return false;
}

// Best-effort analyst target extraction from a Nasdaq API quote payload.
// Returns {target, high, low} or null when nothing target-like is present.
const TARGET_KEYS = new Set([
  "oneyrtarget",
  "analysttarget",
  "targetmean",
  "targetmeanprice",
  "targetprice",
  "pricetarget",
  "targetprice12m",
  "targethigh",
  "targetlow",
]);
export function extractAnalystTarget(body) {
  let mean = null;
  let high = null;
  let low = null;
  const visit = (node, depth) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      for (const x of node) visit(x, depth + 1);
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        const key = String(k).toLowerCase();
        if (TARGET_KEYS.has(key)) {
          const val = num(v);
          if (val === null) continue;
          if (key.includes("high")) high = high ?? val;
          else if (key.includes("low")) low = low ?? val;
          else mean = mean ?? val;
        } else {
          visit(v, depth + 1);
        }
      }
    }
  };
  visit(body, 0);
  if (mean === null && high === null && low === null) return null;
  return { target: mean, high, low };
}

// Build the market_snapshots row (upsert key: symbol,trading_date,provider).
export function buildMarketSnapshotRow({
  companyId,
  symbol,
  parsed,
  sharesOutstanding,
  analystTarget,
  observedAt,
}) {
  const shares = num(sharesOutstanding);
  const price = num(parsed.price);
  const marketCap =
    price !== null && shares !== null && shares > 0 ? price * shares : null;
  return {
    company_id: companyId,
    symbol: String(symbol).toUpperCase(),
    observed_at: observedAt,
    trading_date: parsed.tradingDate,
    price,
    previous_close: parsed.previousClose,
    volume: parsed.volume,
    market_cap: marketCap,
    provider: MARKET_PROVIDER,
    source_url:
      "https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(String(symbol).toUpperCase()),
    raw_payload: {
      provider: MARKET_PROVIDER,
      methodology_version: METHODOLOGY_VERSION,
      currency: parsed.currency,
      exchange_name: parsed.exchangeName,
      instrument_type: parsed.instrumentType,
      dividend_yield_ttm: parsed.dividendYieldTtm ?? null,
      analyst_target: analystTarget ?? null,
      regular_market_price: parsed.regularMarketPrice ?? null,
    },
  };
}

// Stamp methodology_version into every row's raw_payload (fundamentals libs
// don't know about metrics-v1; the DB has no dedicated column).
export function withMethodologyVersion(rows, version = METHODOLOGY_VERSION) {
  return (rows ?? []).map((r) => ({
    ...r,
    raw_payload: { ...(r.raw_payload ?? {}), methodology_version: version },
  }));
}

// ---------------------------------------------------------------------------
// Fetchers (impure). Respect SEC's <=5 req/sec guidance: single-threaded loop
// with polite sleeps between SEC calls.
// ---------------------------------------------------------------------------

const arg = (name, fallback = null) => {
  const prefix = "--" + name + "=";
  const hit = process.argv.find((x) => x.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const YAHOO_UA = process.env.YAHOO_DATA_USER_AGENT ?? "SOLPIENT Research/1.0";
const SEC_CONTACT = process.env.SEC_CONTACT ?? "ngkenzy@users.noreply.github.com";
const SEC_UA =
  process.env.SEC_USER_AGENT ?? "Solpient Research " + SEC_CONTACT;
const NASDAQ_UA =
  process.env.NASDAQ_USER_AGENT ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function fetchYahooChart(symbol) {
  const query =
    "?interval=1d&range=1y&includePrePost=false&events=div%2Csplits";
  const hosts = [
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com",
  ];
  let lastErr = null;
  for (const host of hosts) {
    try {
      const res = await fetch(
        host + "/v8/finance/chart/" + encodeURIComponent(symbol) + query,
        {
          headers: { "User-Agent": YAHOO_UA, Accept: "application/json" },
          signal: AbortSignal.timeout(20000),
        }
      );
      if (!res.ok) throw new Error("Yahoo chart HTTP " + res.status);
      const body = await res.json();
      const result = body?.chart?.result?.[0];
      if (!result)
        throw new Error(body?.chart?.error?.description || "No chart result");
      return result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// Best-effort only: returns null when Nasdaq has nothing usable.
async function fetchAnalystTarget(symbol) {
  const headers = { "User-Agent": NASDAQ_UA, Accept: "application/json" };
  const urls = [
    "https://api.nasdaq.com/api/quote/" +
      encodeURIComponent(symbol) +
      "/info?assetclass=stocks",
    "https://api.nasdaq.com/api/analyst/" +
      encodeURIComponent(symbol) +
      "/summary?assetclass=stocks",
  ];
  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers,
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const target = extractAnalystTarget(await res.json());
      if (target) return target;
    } catch {
      /* opportunistic: never fatal */
    }
  }
  return null;
}

async function fetchSecCompanyFacts(cik) {
  const url = "https://data.sec.gov/api/xbrl/companyfacts/CIK" + cik10(cik) + ".json";
  const res = await fetch(url, {
    headers: { "User-Agent": SEC_UA, From: SEC_CONTACT, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error("SEC companyfacts HTTP " + res.status);
  return res.json();
}

async function loadSecTickerMap(cacheDir) {
  await fs.mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, "company_tickers_exchange.json");
  const url = "https://www.sec.gov/files/company_tickers_exchange.json";
  let body = null;
  if (fsSync.existsSync(file)) {
    try {
      body = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      body = null;
    }
  }
  if (!body) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": SEC_UA,
        From: SEC_CONTACT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error("SEC ticker map HTTP " + res.status);
    body = await res.json();
    await fs.writeFile(file, JSON.stringify(body));
  }
  return parseSecTickerMap(body);
}

// Yahoo fundamentals timeseries fallback (same pattern as
// scripts/sync-yahoo-fundamentals-fallback.mjs, cookie/crumb dance included).
let yahooAuth = null;
async function yahooCookieCrumb() {
  try {
    const boot = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": YAHOO_UA },
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });
    const sets =
      typeof boot.headers.getSetCookie === "function"
        ? boot.headers.getSetCookie()
        : [boot.headers.get("set-cookie")].filter(Boolean);
    const cookie = sets.map((v) => String(v).split(";")[0]).join("; ");
    if (!cookie) return null;
    const res = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": YAHOO_UA, Cookie: cookie },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const crumb = (await res.text()).trim();
    return crumb ? { cookie, crumb } : null;
  } catch {
    return null;
  }
}

async function fetchYahooSeries(symbol, prefix) {
  const types = YAHOO_FINANCIAL_KEYS.map((k) => prefix + k).join(",");
  const period1 = Math.floor(new Date("2014-01-01T00:00:00Z").getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  async function attempt(host, withAuth = false) {
    const endpoint = new URL(
      host +
        "/ws/fundamentals-timeseries/v1/finance/timeseries/" +
        encodeURIComponent(symbol)
    );
    endpoint.searchParams.set("symbol", symbol);
    endpoint.searchParams.set("type", types);
    endpoint.searchParams.set("period1", String(period1));
    endpoint.searchParams.set("period2", String(period2));
    const headers = { "User-Agent": YAHOO_UA, Accept: "application/json" };
    if (withAuth && yahooAuth) {
      endpoint.searchParams.set("crumb", yahooAuth.crumb);
      headers.Cookie = yahooAuth.cookie;
    }
    const res = await fetch(endpoint, {
      headers,
      signal: AbortSignal.timeout(30000),
    });
    const txt = await res.text();
    let body = null;
    try {
      body = JSON.parse(txt);
    } catch {
      body = null;
    }
    const error = body?.timeseries?.error ?? body?.finance?.error;
    if (res.ok && !error && Array.isArray(body?.timeseries?.result)) return body;
    const e = new Error(
      "Yahoo fundamentals HTTP " +
        res.status +
        ": " +
        String(error?.description ?? txt).slice(0, 180)
    );
    e.status = res.status;
    throw e;
  }
  try {
    return await attempt("https://query1.finance.yahoo.com");
  } catch (first) {
    try {
      return await attempt("https://query2.finance.yahoo.com");
    } catch (second) {
      if ([401, 403].includes(Number(second.status ?? first.status))) {
        yahooAuth = yahooAuth ?? (await yahooCookieCrumb());
        if (yahooAuth) return attempt("https://query2.finance.yahoo.com", true);
      }
      throw second;
    }
  }
}

async function latestSharesOutstanding(sb, companyId) {
  const providers = [SEC_PROVIDER, YAHOO_FUNDAMENTALS_PROVIDER, null];
  for (const provider of providers) {
    let q = sb
      .from("fundamental_snapshots")
      .select("shares_outstanding")
      .eq("company_id", companyId)
      .not("shares_outstanding", "is", null)
      .order("period_end", { ascending: false })
      .limit(1);
    if (provider) q = q.eq("provider", provider);
    const { data } = await q.maybeSingle();
    const s = num(data?.shares_outstanding);
    if (s !== null && s > 0) return s;
  }
  return null;
}

async function startRun(sb) {
  const { data, error } = await sb
    .from("automation_runs")
    .insert({ pipeline: "company_metrics_backfill", status: "running" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function finishRun(sb, runId, status, summary, message) {
  await sb
    .from("automation_runs")
    .update({
      status,
      records_written:
        (summary.market ?? 0) +
        (summary.fundamentals_sec ?? 0) +
        (summary.fundamentals_yahoo ?? 0),
      message:
        message ??
        `market=${summary.market} sec_fund=${summary.fundamentals_sec} yahoo_fund=${summary.fundamentals_yahoo} light=${summary.light} skipped=${summary.skipped} failed=${summary.failed.length}`,
      details: summary,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const tickers = new Set();
  for (const a of process.argv) {
    if (a.startsWith("--ticker=")) {
      for (const t of a.slice("--ticker=".length).split(","))
        if (t.trim()) tickers.add(t.trim().toUpperCase());
    }
  }
  const refresh = process.argv.includes("--refresh");
  const dryRun = process.argv.includes("--dry-run");
  const maxQuarters = Math.max(1, Number(arg("max-quarters", "20")) || 20);
  const cacheDir = path.resolve(arg("cache-dir", ".cache/backfill-company-metrics"));

  const url = process.env.SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret)
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: companies, error: compErr } = await sb
    .from("companies")
    .select("id,ticker,company_name,cik,exchange,sector,industry")
    .order("ticker");
  if (compErr) throw compErr;
  let list = companies ?? [];
  if (tickers.size)
    list = list.filter((c) => tickers.has(String(c.ticker).toUpperCase()));
  if (!list.length) {
    console.log("No companies to process.");
    return;
  }

  const tickerMap = await loadSecTickerMap(cacheDir);
  const runId = dryRun ? null : await startRun(sb);
  const summary = {
    processed: 0,
    market: 0,
    fundamentals_sec: 0,
    fundamentals_yahoo: 0,
    light: 0,
    skipped: 0,
    failed: [],
  };

  try {
    for (const company of list) {
      const ticker = String(company.ticker).toUpperCase();
      const observed = new Date().toISOString();
      const cik = cik10(company.cik) ?? tickerMap.get(ticker) ?? null;
      try {
        // Freshness: skip entirely unless --refresh.
        if (!refresh) {
          const [{ data: ms }, { data: fsnap }] = await Promise.all([
            sb
              .from("market_snapshots")
              .select("observed_at")
              .eq("symbol", ticker)
              .eq("provider", MARKET_PROVIDER)
              .order("observed_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            sb
              .from("fundamental_snapshots")
              .select("observed_at")
              .eq("company_id", company.id)
              .eq("provider", SEC_PROVIDER)
              .order("observed_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);
          const marketFresh =
            ms && Date.now() - Date.parse(ms.observed_at) < 12 * 3600e3;
          const fundFresh =
            fsnap && Date.now() - Date.parse(fsnap.observed_at) < 7 * 86400e3;
          if (marketFresh && fundFresh) {
            summary.skipped += 1;
            console.log("skip (fresh)", ticker);
            continue;
          }
        }

        // (a) Market: Yahoo chart v8, keyless.
        const chart = await fetchYahooChart(ticker);
        await sleep(150);
        const parsed = parseYahooChartResult(chart);
        const light = isLightTier({ cik, instrumentType: parsed.instrumentType });

        let analystTarget = null;
        if (!light) analystTarget = await fetchAnalystTarget(ticker);

        const shares = await latestSharesOutstanding(sb, company.id);
        const row = buildMarketSnapshotRow({
          companyId: company.id,
          symbol: ticker,
          parsed,
          sharesOutstanding: shares,
          analystTarget,
          observedAt: observed,
        });
        if (dryRun) {
          console.log(
            "[dry-run] market",
            ticker,
            parsed.tradingDate,
            parsed.price,
            "light=" + light
          );
        } else {
          const { error } = await sb
            .from("market_snapshots")
            .upsert(row, { onConflict: "symbol,trading_date,provider" });
          if (error) throw error;
        }
        summary.market += 1;

        // LIGHT TIER: price row only. Never invent fundamentals for
        // funds/ETFs/cash-like tickers.
        if (light) {
          summary.light += 1;
          console.log(
            "light-tier (price only)",
            ticker,
            parsed.instrumentType ?? "no-cik"
          );
          summary.processed += 1;
          continue;
        }

        // Backfill a discovered CIK into companies for future runs.
        if (!cik10(company.cik) && cik && !dryRun) {
          const { error } = await sb
            .from("companies")
            .update({ cik, updated_at: observed })
            .eq("id", company.id);
          if (error) console.warn("CIK backfill failed for", ticker, error.message);
        }

        // (b) Fundamentals: SEC companyfacts first, Yahoo fallback only.
        let rows = [];
        let providerUsed = null;
        try {
          const facts = await fetchSecCompanyFacts(cik);
          await sleep(250); // SEC politeness: <=5 req/sec
          rows = normalizeCompanyFacts(facts, {
            companyId: company.id,
            ticker,
            cik,
            observedAt: observed,
            maxQuarters,
          });
        } catch (e) {
          console.warn("SEC companyfacts failed for", ticker, e.message);
        }

        if (rows.length) {
          providerUsed = SEC_PROVIDER;
          summary.fundamentals_sec += rows.length;
        } else {
          const [quarterlyBody, annualBody] = await Promise.all([
            fetchYahooSeries(ticker, "quarterly"),
            fetchYahooSeries(ticker, "annual"),
          ]);
          const normalized = normalizeYahooFundamentals({
            company: { id: company.id, ticker },
            quarterlyBody,
            annualBody,
            observedAt: observed,
            industryModule: industryModuleForTicker(ticker),
          });
          if (normalized.quality.passed) {
            rows = normalized.rows;
            providerUsed = YAHOO_FUNDAMENTALS_PROVIDER;
            summary.fundamentals_yahoo += rows.length;
          } else {
            console.warn(
              "Yahoo fundamentals quality gate failed for",
              ticker,
              JSON.stringify(normalized.quality)
            );
          }
        }

        if (rows.length) {
          const stamped = withMethodologyVersion(rows);
          for (let i = 0; i < stamped.length; i += 50) {
            if (dryRun) {
              console.log(
                "[dry-run] fundamentals",
                ticker,
                providerUsed,
                stamped.length + " rows"
              );
              break;
            }
            const { error } = await sb
              .from("fundamental_snapshots")
              .upsert(stamped.slice(i, i + 50), {
                onConflict: "company_id,period_end,form,provider",
              });
            if (error) throw error;
          }
        }
        summary.processed += 1;
        console.log("ok", ticker, "fund_rows=" + rows.length, "provider=" + (providerUsed ?? "none"));
      } catch (e) {
        summary.failed.push({ ticker, error: e?.message ?? String(e) });
        console.warn("failed", ticker, e?.message ?? e);
      }
    }
    if (!dryRun)
      await finishRun(sb, runId, summary.failed.length ? "partial" : "success", summary);
  } catch (e) {
    if (!dryRun) await finishRun(sb, runId, "failed", summary, e?.message ?? String(e));
    throw e;
  }
  console.log(JSON.stringify(summary, null, 2));
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
