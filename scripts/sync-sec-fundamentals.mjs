import fs from "node:fs/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const contact = process.env.SEC_CONTACT || "ngkenzy@users.noreply.github.com";
const userAgent = process.env.SEC_USER_AGENT || "SOLPIENT Research " + contact;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const companies = JSON.parse(await fs.readFile("data/monitor/companies.json", "utf8"));

async function secJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent, From: contact, Accept: "application/json" },
  });
  if (!response.ok) throw new Error("SEC HTTP " + response.status + " for " + url);
  return response.json();
}

const tickerRows = await secJson("https://www.sec.gov/files/company_tickers.json");
const tickerCik = new Map(
  Object.values(tickerRows).map((row) => [
    String(row.ticker).toUpperCase(),
    String(row.cik_str).padStart(10, "0"),
  ])
);

function allUnits(facts, namespace, concepts, unit) {
  for (const concept of concepts) {
    const rows = facts?.facts?.[namespace]?.[concept]?.units?.[unit];
    if (Array.isArray(rows) && rows.length) return { concept, rows };
  }
  return { concept: null, rows: [] };
}

function latestPeriodic(rows) {
  return [...rows]
    .filter((x) => ["10-K", "10-Q", "10-K/A", "10-Q/A"].includes(x.form) && x.end && x.filed)
    .sort((a, b) => {
      const byFiled = String(b.filed).localeCompare(String(a.filed));
      return byFiled || String(b.end).localeCompare(String(a.end));
    })[0] ?? null;
}

function latestInstant(rows) {
  return [...rows]
    .filter((x) => ["10-K", "10-Q", "10-K/A", "10-Q/A"].includes(x.form) && x.end && x.filed)
    .sort((a, b) => String(b.end).localeCompare(String(a.end)) || String(b.filed).localeCompare(String(a.filed)))[0] ?? null;
}

function value(row) {
  const n = Number(row?.val);
  return Number.isFinite(n) ? n : null;
}

async function startRun() {
  const { data, error } = await supabase
    .from("automation_runs")
    .insert({ pipeline: "sec_fundamentals", status: "running" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function finishRun(id, status, records, message, details = {}) {
  await supabase
    .from("automation_runs")
    .update({
      status,
      records_written: records,
      message,
      details,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);
}

const runId = await startRun();
let written = 0;
const failures = [];

try {
  for (const config of companies) {
    const ticker = String(config.ticker).toUpperCase();
    const cik = String(config.cik || tickerCik.get(ticker) || "").padStart(10, "0");
    if (!cik || /^0+$/.test(cik)) {
      failures.push({ ticker, error: "Unable to resolve CIK" });
      continue;
    }

    try {
      const facts = await secJson("https://data.sec.gov/api/xbrl/companyfacts/CIK" + cik + ".json");

      const revenue = latestPeriodic(allUnits(facts, "us-gaap", [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet"
      ], "USD").rows);
      const netIncome = latestPeriodic(allUnits(facts, "us-gaap", ["NetIncomeLoss", "ProfitLoss"], "USD").rows);
      const ocf = latestPeriodic(allUnits(facts, "us-gaap", ["NetCashProvidedByUsedInOperatingActivities"], "USD").rows);
      const capex = latestPeriodic(allUnits(facts, "us-gaap", [
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsForAdditionsToPropertyPlantAndEquipment"
      ], "USD").rows);
      const shares = latestInstant(allUnits(facts, "dei", ["EntityCommonStockSharesOutstanding"], "shares").rows);
      const eps = latestPeriodic(allUnits(facts, "us-gaap", ["EarningsPerShareDiluted"], "USD/shares").rows);

      const anchor = revenue || netIncome || ocf || eps;
      if (!anchor) throw new Error("No recent periodic SEC facts found");

      const companyName = config.company_name || facts.entityName || ticker;
      const { data: company, error: companyError } = await supabase
        .from("companies")
        .upsert(
          {
            ticker,
            company_name: companyName,
            cik,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "ticker" }
        )
        .select("id")
        .single();
      if (companyError) throw companyError;

      const ocfValue = value(ocf);
      const capexValue = value(capex);
      const fcf = ocfValue != null && capexValue != null ? ocfValue - Math.abs(capexValue) : null;

      const sourceUrl = "https://data.sec.gov/api/xbrl/companyfacts/CIK" + cik + ".json";
      const row = {
        company_id: company.id,
        observed_at: new Date().toISOString(),
        period_end: anchor.end,
        fiscal_year: Number.isFinite(Number(anchor.fy)) ? Number(anchor.fy) : null,
        fiscal_period: anchor.fp ?? null,
        form: anchor.form ?? null,
        filed_at: anchor.filed ?? null,
        revenue: value(revenue),
        net_income: value(netIncome),
        operating_cash_flow: ocfValue,
        capital_expenditure: capexValue,
        free_cash_flow: fcf,
        shares_outstanding: value(shares),
        eps_diluted: value(eps),
        source_url: sourceUrl,
        raw_payload: {
          accession: anchor.accn ?? null,
          frame: anchor.frame ?? null,
          entityName: facts.entityName ?? companyName,
          cik,
        },
      };

      const { error } = await supabase
        .from("fundamental_snapshots")
        .upsert(row, { onConflict: "company_id,period_end,form" });
      if (error) throw error;

      written += 1;
      console.log("Stored SEC fundamental snapshot", ticker, row.period_end, row.form);
    } catch (error) {
      failures.push({ ticker, error: error.message });
      console.warn("SEC fundamental sync failed for", ticker, error.message);
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  await finishRun(
    runId,
    failures.length === 0 ? "success" : written > 0 ? "partial" : "failed",
    written,
    `Stored ${written} SEC fundamental snapshots; ${failures.length} failures.`,
    { failures }
  );
} catch (error) {
  await finishRun(runId, "failed", written, error.message, { failures });
  throw error;
}
