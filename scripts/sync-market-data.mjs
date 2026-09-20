import fs from "node:fs/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const companies = JSON.parse(await fs.readFile("data/monitor/companies.json", "utf8"));
const symbols = [...new Set([...companies.map((x) => String(x.ticker).toUpperCase()), "SPY"])];
const userAgent = process.env.MARKET_DATA_USER_AGENT || "SOLPIENT Research/1.0";

async function startRun() {
  const { data, error } = await supabase
    .from("automation_runs")
    .insert({ pipeline: "market_snapshots", status: "running" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function finishRun(id, status, records, message, details = {}) {
  const { error } = await supabase
    .from("automation_runs")
    .update({
      status,
      records_written: records,
      message,
      details,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) console.warn("Unable to finalize automation run:", error.message);
}

async function yahooQuote(symbol) {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) +
    "?interval=1d&range=5d&includePrePost=false&events=div%2Csplits";
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error("Yahoo chart HTTP " + response.status);

  const body = await response.json();
  const result = body?.chart?.result?.[0];
  if (!result) throw new Error(body?.chart?.error?.description || "No chart result");

  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const closes = quote.close ?? [];
  const volumes = quote.volume ?? [];

  let index = -1;
  for (let i = closes.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(Number(closes[i])) && timestamps[i]) {
      index = i;
      break;
    }
  }
  if (index < 0) throw new Error("No valid daily close");

  const tradingDate = new Date(Number(timestamps[index]) * 1000)
    .toISOString()
    .slice(0, 10);
  const price = Number(closes[index]);
  const priorClose =
    index > 0 && Number.isFinite(Number(closes[index - 1]))
      ? Number(closes[index - 1])
      : Number.isFinite(Number(result.meta?.previousClose))
        ? Number(result.meta.previousClose)
        : null;
  const volume = Number.isFinite(Number(volumes[index])) ? Number(volumes[index]) : null;

  return {
    url,
    tradingDate,
    observedAt: new Date().toISOString(),
    price,
    previousClose: priorClose,
    volume,
    raw: {
      currency: result.meta?.currency ?? null,
      exchangeName: result.meta?.exchangeName ?? null,
      instrumentType: result.meta?.instrumentType ?? null,
      regularMarketTime: result.meta?.regularMarketTime ?? null,
    },
  };
}

async function ensureCompany(config) {
  const ticker = String(config.ticker).toUpperCase();
  const { data, error } = await supabase
    .from("companies")
    .upsert(
      {
        ticker,
        company_name: config.company_name ?? ticker,
        cik: config.cik ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ticker" }
    )
    .select("id,ticker")
    .single();
  if (error) throw error;
  return data;
}

const companyMap = new Map();
for (const config of companies) {
  const company = await ensureCompany(config);
  companyMap.set(company.ticker, company.id);
}

const runId = await startRun();
let written = 0;
const failures = [];

try {
  for (const symbol of symbols) {
    try {
      const quote = await yahooQuote(symbol);
      let marketCap = null;

      const companyId = companyMap.get(symbol) ?? null;
      if (companyId) {
        const { data: fundamental } = await supabase
          .from("fundamental_snapshots")
          .select("shares_outstanding")
          .eq("company_id", companyId)
          .not("shares_outstanding", "is", null)
          .order("period_end", { ascending: false })
          .limit(1)
          .maybeSingle();
        const shares = Number(fundamental?.shares_outstanding);
        if (Number.isFinite(shares) && shares > 0) marketCap = shares * quote.price;
      }

      const { error } = await supabase.from("market_snapshots").upsert(
        {
          company_id: companyId,
          symbol,
          observed_at: quote.observedAt,
          trading_date: quote.tradingDate,
          price: quote.price,
          previous_close: quote.previousClose,
          volume: quote.volume,
          market_cap: marketCap,
          provider: "yahoo-chart",
          source_url: quote.url,
          raw_payload: quote.raw,
        },
        { onConflict: "symbol,trading_date,provider" }
      );
      if (error) throw error;
      written += 1;
      console.log("Stored market snapshot", symbol, quote.tradingDate, quote.price);
    } catch (error) {
      failures.push({ symbol, error: error.message });
      console.warn("Market snapshot failed for", symbol, error.message);
    }
  }

  await finishRun(
    runId,
    failures.length === 0 ? "success" : written > 0 ? "partial" : "failed",
    written,
    `Stored ${written} market snapshots; ${failures.length} failures.`,
    { failures }
  );
} catch (error) {
  await finishRun(runId, "failed", written, error.message, { failures });
  throw error;
}
