import fs from "node:fs/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = process.env.FMP_API_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const companies = JSON.parse(await fs.readFile("data/monitor/companies.json", "utf8"));

async function startRun() {
  const { data, error } = await supabase
    .from("automation_runs")
    .insert({ pipeline: "fmp_fundamentals_filings", status: "running" })
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
  if (error) console.warn("Unable to finalize FMP run:", error.message);
}

function isoDateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function fmp(path, params = {}) {
  const url = new URL("https://financialmodelingprep.com/stable/" + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "SOLPIENT Research/1.0" },
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) {
    throw new Error("FMP HTTP " + response.status + ": " + String(text).slice(0, 250));
  }
  if (body && typeof body === "object" && !Array.isArray(body) && body["Error Message"]) {
    throw new Error("FMP error: " + body["Error Message"]);
  }
  return { url: url.toString(), body };
}

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function ensureCompany(config) {
  const ticker = String(config.ticker).toUpperCase();
  const { data, error } = await supabase
    .from("companies")
    .upsert({
      ticker,
      company_name: config.company_name ?? ticker,
      cik: config.cik ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "ticker" })
    .select("id,ticker")
    .single();
  if (error) throw error;
  return data;
}

async function syncFundamentals(company) {
  const [incomeRes, cashRes] = await Promise.all([
    fmp("income-statement", { symbol: company.ticker, period: "quarter", limit: 5 }),
    fmp("cash-flow-statement", { symbol: company.ticker, period: "quarter", limit: 5 }),
  ]);

  const incomeRows = Array.isArray(incomeRes.body) ? incomeRes.body : [];
  const cashRows = Array.isArray(cashRes.body) ? cashRes.body : [];
  if (!incomeRows.length && !cashRows.length) return 0;

  const cashByDate = new Map(cashRows.map((row) => [row.date, row]));
  let written = 0;

  for (const income of incomeRows.slice(0, 5)) {
    const cash = cashByDate.get(income.date) ?? {};
    const periodEnd = income.date ?? cash.date;
    if (!periodEnd) continue;

    const ocf = n(cash.netCashProvidedByOperatingActivities ?? cash.operatingCashFlow);
    const capex = n(cash.capitalExpenditure);
    const fcf = n(cash.freeCashFlow) ??
      (ocf != null && capex != null ? ocf - Math.abs(capex) : null);

    const row = {
      company_id: company.id,
      observed_at: new Date().toISOString(),
      period_end: periodEnd,
      fiscal_year: Number.isFinite(Number(income.calendarYear ?? income.fiscalYear))
        ? Number(income.calendarYear ?? income.fiscalYear)
        : null,
      fiscal_period: income.period ?? null,
      form: income.period === "FY" ? "10-K" : "10-Q",
      filed_at: income.filingDate ?? cash.filingDate ?? null,
      revenue: n(income.revenue),
      net_income: n(income.netIncome),
      operating_cash_flow: ocf,
      capital_expenditure: capex,
      free_cash_flow: fcf,
      shares_outstanding: n(income.weightedAverageShsOutDil ?? income.weightedAverageShsOut),
      eps_diluted: n(income.epsDiluted ?? income.eps),
      source_url: income.finalLink ?? income.link ?? incomeRes.url,
      raw_payload: {
        provider: "fmp",
        income,
        cash_flow: cash,
      },
    };

    const { error } = await supabase
      .from("fundamental_snapshots")
      .upsert(row, { onConflict: "company_id,period_end,form" });
    if (error) throw error;
    written += 1;
  }
  return written;
}

async function syncFilings(company) {
  const from = isoDateDaysAgo(180);
  const to = new Date().toISOString().slice(0, 10);
  const res = await fmp("sec-filings-search/symbol", {
    symbol: company.ticker,
    from,
    to,
    page: 0,
    limit: 5,
  });

  const rows = Array.isArray(res.body) ? res.body : [];
  let written = 0;

  for (const filing of rows) {
    const form = String(filing.formType ?? filing.type ?? filing.form ?? "").toUpperCase();
    if (!["10-K", "10-Q", "8-K", "10-K/A", "10-Q/A", "8-K/A"].includes(form)) continue;

    const filedAt = filing.filingDate ?? filing.date;
    if (!filedAt) continue;

    const row = {
      company_id: company.id,
      provider: "fmp",
      form_type: form,
      filed_at: String(filedAt).slice(0, 10),
      accepted_at: filing.acceptedDate ?? null,
      accession_number: filing.accessionNumber ?? filing.accession_number ?? null,
      filing_url: filing.finalLink ?? filing.link ?? filing.url ?? null,
      period_end: filing.reportDate ?? filing.periodOfReport ?? null,
      title: filing.companyName
        ? filing.companyName + " " + form
        : company.ticker + " " + form,
      raw_payload: filing,
    };

    const { error } = await supabase
      .from("filing_events")
      .upsert(row, {
        onConflict: "company_id,provider,form_type,filed_at,accession_number",
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
    "FMP_API_KEY is not configured; provider adapter is installed but inactive.",
    { provider: "financialmodelingprep" }
  );
  console.log("FMP provider installed but inactive: missing FMP_API_KEY.");
  process.exit(0);
}

let written = 0;
const failures = [];

for (const config of companies) {
  const company = await ensureCompany(config);
  let companyWritten = 0;

  try {
    const fundamentals = await syncFundamentals(company);
    written += fundamentals;
    companyWritten += fundamentals;
    console.log("FMP fundamentals", company.ticker, fundamentals);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ ticker: config.ticker, stage: "fundamentals", error: message });
    console.warn("FMP fundamentals failed", config.ticker, message);
  }

  try {
    const filings = await syncFilings(company);
    written += filings;
    companyWritten += filings;
    console.log("FMP filings", company.ticker, filings);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ ticker: config.ticker, stage: "filings", error: message });
    console.warn("FMP filings failed", config.ticker, message);
  }

  console.log("FMP sync complete", company.ticker, "records=" + companyWritten);
  await new Promise((resolve) => setTimeout(resolve, 150));
}

await finishRun(
  runId,
  failures.length === 0 ? "success" : written > 0 ? "partial" : "failed",
  written,
  "FMP provider stored " + written + " records; " + failures.length + " failures.",
  { provider: "financialmodelingprep", failures }
);

if (failures.length > 0 && written === 0) process.exitCode = 1;
