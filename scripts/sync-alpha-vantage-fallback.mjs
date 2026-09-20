import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DAILY_REQUEST_BUDGET = 24;
const REQUESTS_PER_COMPANY = 3;
const MAX_COMPANIES = Math.floor(DAILY_REQUEST_BUDGET / REQUESTS_PER_COMPANY);
const FMP_FRESH_MS = 3 * 24 * 60 * 60 * 1000;

function n(value) {
  if (value === null || value === undefined || value === "" || value === "None") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function alphaFcf(ocf, capex) {
  if (ocf == null || capex == null) return null;
  return capex < 0 ? ocf + capex : ocf - capex;
}

async function startRun() {
  const { data, error } = await supabase
    .from("automation_runs")
    .insert({ pipeline: "alpha_vantage_fallback", status: "running" })
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
  if (error) console.warn("Unable to finalize Alpha Vantage run:", error.message);
}

function isQuotaMessage(body) {
  const text = [
    body?.Note,
    body?.Information,
    body?.["Error Message"],
  ].filter(Boolean).join(" ").toLowerCase();
  return text.includes("api call frequency") ||
    text.includes("rate limit") ||
    text.includes("requests per day") ||
    text.includes("standard api rate limit");
}

async function alpha(functionName, symbol) {
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", functionName);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "SOLPIENT Research/1.0",
    },
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error("Alpha Vantage HTTP " + response.status);
  }
  if (body?.["Error Message"]) {
    throw new Error("Alpha Vantage error: " + body["Error Message"]);
  }
  if (isQuotaMessage(body)) {
    const error = new Error("Alpha Vantage free-tier request limit reached.");
    error.code = "ALPHA_QUOTA";
    throw error;
  }

  return body;
}

async function candidates() {
  const [{ data: companies, error: companiesError }, { data: snapshots, error: snapshotsError }] =
    await Promise.all([
      supabase.from("companies").select("id,ticker").order("ticker"),
      supabase
        .from("fundamental_snapshots")
        .select("company_id,provider,observed_at,period_end")
        .in("provider", ["sec_companyfacts", "fmp", "alpha_vantage"])
        .order("observed_at", { ascending: false }),
    ]);

  if (companiesError) throw companiesError;
  if (snapshotsError) throw snapshotsError;

  const latestFmp = new Map();
  const latestAlpha = new Map();
  const counts = new Map();

  for (const row of snapshots ?? []) {
    const observed = new Date(row.observed_at).getTime();
    const key = row.company_id + "|" + row.provider;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (row.provider === "fmp" && (!latestFmp.has(row.company_id) || observed > latestFmp.get(row.company_id))) {
      latestFmp.set(row.company_id, observed);
    }
    if (row.provider === "alpha_vantage" && (!latestAlpha.has(row.company_id) || observed > latestAlpha.get(row.company_id))) {
      latestAlpha.set(row.company_id, observed);
    }
  }

  const now = Date.now();

  return (companies ?? [])
    .filter((company) => {
      const secCount = counts.get(company.id + "|sec_companyfacts") ?? 0;
      const fmpCount = counts.get(company.id + "|fmp") ?? 0;
      const fmpObserved = latestFmp.get(company.id);
      const primaryCoverageEnough = secCount >= 20;
      const fmpCoverageEnough = fmpCount >= 20 && fmpObserved && now - fmpObserved <= FMP_FRESH_MS;
      return !primaryCoverageEnough && !fmpCoverageEnough;
    })
    .sort((a, b) => {
      const aAlpha = latestAlpha.get(a.id) ?? 0;
      const bAlpha = latestAlpha.get(b.id) ?? 0;
      return aAlpha - bAlpha || a.ticker.localeCompare(b.ticker);
    })
    .slice(0, MAX_COMPANIES);
}

async function syncCompany(company) {
  const [incomeBody, cashBody, balanceBody] = await Promise.all([
    alpha("INCOME_STATEMENT", company.ticker),
    alpha("CASH_FLOW", company.ticker),
    alpha("BALANCE_SHEET", company.ticker),
  ]);

  const incomeRows = Array.isArray(incomeBody?.quarterlyReports)
    ? incomeBody.quarterlyReports
    : [];
  const cashRows = Array.isArray(cashBody?.quarterlyReports)
    ? cashBody.quarterlyReports
    : [];
  const balanceRows = Array.isArray(balanceBody?.quarterlyReports)
    ? balanceBody.quarterlyReports
    : [];

  if (!incomeRows.length && !cashRows.length) {
    return 0;
  }

  const cashByPeriod = new Map(
    cashRows.map((row) => [row.fiscalDateEnding, row])
  );
  const balanceByPeriod = new Map(
    balanceRows.map((row) => [row.fiscalDateEnding, row])
  );

  let written = 0;

  for (const income of incomeRows.slice(0, 24)) {
    const periodEnd = income.fiscalDateEnding;
    if (!periodEnd) continue;

    const cash = cashByPeriod.get(periodEnd) ?? {};
    const balance = balanceByPeriod.get(periodEnd) ?? {};
    const ocf = n(cash.operatingCashflow);
    const capex = n(cash.capitalExpenditures);

    const row = {
      company_id: company.id,
      provider: "alpha_vantage",
      observed_at: new Date().toISOString(),
      period_end: periodEnd,
      fiscal_year: Number(String(periodEnd).slice(0, 4)),
      fiscal_period: null,
      form: "10-Q",
      filed_at: null,
      revenue: n(income.totalRevenue),
      net_income: n(income.netIncome),
      operating_cash_flow: ocf,
      capital_expenditure: capex,
      free_cash_flow: alphaFcf(ocf, capex),
      shares_outstanding: null,
      eps_diluted: null,
      source_url:
        "https://www.alphavantage.co/query?function=INCOME_STATEMENT&symbol=" +
        encodeURIComponent(company.ticker),
      raw_payload: {
        provider: "alpha_vantage",
        income_statement: income,
        income: {
          grossProfit: n(income.grossProfit),
          operatingIncome: n(income.operatingIncome),
          interestExpense: n(income.interestExpense),
          researchAndDevelopmentExpenses: n(income.researchAndDevelopment),
        },
        cash_flow: {
          ...cash,
          stockBasedCompensation: n(cash.stockBasedCompensation),
          cashAtEndOfPeriod: n(cash.cashAndCashEquivalentsAtCarryingValue ?? balance.cashAndCashEquivalentsAtCarryingValue),
          commonDividendsPaid: n(cash.dividendPayoutCommonStock),
          commonStockRepurchased: n(cash.paymentsForRepurchaseOfCommonStock),
          acquisitionsNet: n(cash.paymentsToAcquireBusinessesNetOfCashAcquired),
        },
        balance_sheet: {
          ...balance,
          cashAndCashEquivalents: n(balance.cashAndCashEquivalentsAtCarryingValue ?? balance.cashAndShortTermInvestments),
          currentAssets: n(balance.totalCurrentAssets),
          currentLiabilities: n(balance.totalCurrentLiabilities),
          inventory: n(balance.inventory),
          stockholdersEquity: n(balance.totalShareholderEquity),
          retainedEarnings: n(balance.retainedEarnings),
          totalAssets: n(balance.totalAssets),
          totalLiabilities: n(balance.totalLiabilities),
          totalDebt: n(balance.shortLongTermDebtTotal ?? balance.longTermDebt),
        },
      },
    };

    const { error } = await supabase
      .from("fundamental_snapshots")
      .upsert(row, {
        onConflict: "company_id,period_end,form,provider",
      });

    if (error) throw error;
    written += 1;
  }

  return written;
}

const runId = await startRun();

if (!apiKey) {
  await finishRun(
    runId,
    "skipped",
    0,
    "ALPHA_VANTAGE_API_KEY is not configured; fallback adapter is installed but inactive.",
    { provider: "alpha_vantage", daily_request_budget: DAILY_REQUEST_BUDGET }
  );
  console.log("Alpha Vantage fallback inactive: missing ALPHA_VANTAGE_API_KEY.");
  process.exit(0);
}

let written = 0;
let attempted = 0;
let quotaReached = false;
const failures = [];
const selected = await candidates();

for (const company of selected) {
  try {
    attempted += 1;
    const count = await syncCompany(company);
    written += count;
    console.log("Alpha Vantage fallback", company.ticker, "rows=" + count);
  } catch (error) {
    if (error?.code === "ALPHA_QUOTA") {
      quotaReached = true;
      console.warn("Alpha Vantage quota reached; stopping fallback cycle.");
      break;
    }

    failures.push({
      ticker: company.ticker,
      error: error instanceof Error ? error.message : String(error),
    });
    console.warn("Alpha Vantage fallback failed", company.ticker, failures.at(-1).error);
  }

  await new Promise((resolve) => setTimeout(resolve, 1200));
}

const status =
  written > 0
    ? failures.length || quotaReached
      ? "partial"
      : "success"
    : failures.length
      ? "failed"
      : quotaReached
        ? "partial"
        : "success";

await finishRun(
  runId,
  status,
  written,
  "Alpha Vantage fallback stored " + written +
    " rows across " + attempted +
    " companies; " + failures.length +
    " failures" + (quotaReached ? "; quota reached." : "."),
  {
    provider: "alpha_vantage",
    daily_request_budget: DAILY_REQUEST_BUDGET,
    selected_tickers: selected.map((x) => x.ticker),
    quota_reached: quotaReached,
    failures,
  }
);

if (status === "failed") process.exitCode = 1;
