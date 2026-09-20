import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const companiesPath = path.join(root, "data/monitor/companies.json");
const statePath = path.join(root, "data/monitor/sec-state.json");
const eventsPath = path.join(root, "data/monitor/sec-events.json");

const userAgent =
  process.env.SEC_USER_AGENT ||
  "SOLPIENT Research contact@solpient.local";

const companies = JSON.parse(await fs.readFile(companiesPath, "utf8"));
let state = JSON.parse(await fs.readFile(statePath, "utf8"));
let eventFile = JSON.parse(await fs.readFile(eventsPath, "utf8"));

const now = new Date().toISOString();
const relevantForms = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A"]);

function normalizeAccession(value) {
  return String(value ?? "").trim();
}

function filingUrl(cik, accession, primaryDocument) {
  const cikNoZeros = String(Number(cik));
  const accessionNoDashes = accession.replaceAll("-", "");
  return "https://www.sec.gov/Archives/edgar/data/" +
    cikNoZeros + "/" + accessionNoDashes + "/" + primaryDocument;
}

function classify(form, items) {
  const normalized = String(form || "").toUpperCase();

  if (normalized.startsWith("10-K")) {
    return {
      category: "annual_filing",
      severity: "high",
      queue: "research_review",
      label: "New annual filing",
      reason: "Full-year financials and thesis assumptions may require a new SOLPIENT research version.",
    };
  }

  if (normalized.startsWith("10-Q")) {
    return {
      category: "quarterly_filing",
      severity: "high",
      queue: "research_review",
      label: "New quarterly filing",
      reason: "Quarterly fundamentals and thesis evidence should be compared with the current research version.",
    };
  }

  const itemText = Array.isArray(items) ? items.join(",") : String(items || "");
  const earningsRelated = /2\.02|9\.01/.test(itemText);

  if (normalized.startsWith("8-K") && earningsRelated) {
    return {
      category: "earnings_event",
      severity: "high",
      queue: "research_review",
      label: "New earnings-related 8-K",
      reason: "Results or guidance may materially change valuation, scores, or thesis conditions.",
    };
  }

  return {
    category: "company_event",
    severity: "medium",
    queue: "monitor",
    label: "New company filing",
    reason: "Review for material changes to the investment thesis.",
  };
}

async function secJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      "Accept-Encoding": "gzip, deflate",
      Host: "data.sec.gov",
    },
  });

  if (!response.ok) {
    throw new Error("SEC request failed " + response.status + " for " + url);
  }

  return response.json();
}

const newEvents = [];
let initializedAny = false;

for (const company of companies) {
  const ticker = company.ticker.toUpperCase();
  const url = "https://data.sec.gov/submissions/CIK" + company.cik + ".json";
  const submission = await secJson(url);
  const recent = submission.filings?.recent ?? {};

  const accessions = recent.accessionNumber ?? [];
  const forms = recent.form ?? [];
  const filingDates = recent.filingDate ?? [];
  const reportDates = recent.reportDate ?? [];
  const primaryDocuments = recent.primaryDocument ?? [];
  const items = recent.items ?? [];

  const filings = accessions
    .map((accession, index) => ({
      accession: normalizeAccession(accession),
      form: forms[index],
      filingDate: filingDates[index],
      reportDate: reportDates[index],
      primaryDocument: primaryDocuments[index],
      items: items[index],
    }))
    .filter((filing) => relevantForms.has(String(filing.form || "").toUpperCase()))
    .filter((filing) => company.forms.some((prefix) => String(filing.form).startsWith(prefix)))
    .slice(0, 40);

  const prior = state.companies[ticker];

  // First observation establishes a baseline and deliberately does not generate stale alerts.
  if (!prior) {
    state.companies[ticker] = {
      cik: company.cik,
      checked_at: now,
      seen_accessions: filings.map((filing) => filing.accession),
    };
    initializedAny = true;
    console.log("Initialized SEC baseline for " + ticker + " with " + filings.length + " filings.");
    continue;
  }

  const seen = new Set(prior.seen_accessions ?? []);
  const unseen = filings
    .filter((filing) => filing.accession && !seen.has(filing.accession))
    .sort((a, b) => String(a.filingDate).localeCompare(String(b.filingDate)));

  for (const filing of unseen) {
    const classification = classify(filing.form, filing.items);
    newEvents.push({
      id: ticker + "-" + filing.accession,
      ticker,
      company_name: company.company_name,
      form: filing.form,
      accession_number: filing.accession,
      filing_date: filing.filingDate || null,
      report_date: filing.reportDate || null,
      items: filing.items || null,
      source_url: filing.primaryDocument
        ? filingUrl(company.cik, filing.accession, filing.primaryDocument)
        : null,
      detected_at: now,
      status: "new",
      ...classification,
    });
  }

  state.companies[ticker] = {
    cik: company.cik,
    checked_at: now,
    seen_accessions: Array.from(
      new Set([...(prior.seen_accessions ?? []), ...filings.map((filing) => filing.accession)])
    ).slice(0, 200),
  };

  console.log("Checked " + ticker + ": " + unseen.length + " new relevant filings.");
}

const existingEvents = Array.isArray(eventFile.events) ? eventFile.events : [];
const merged = [...newEvents, ...existingEvents]
  .filter((event, index, array) => array.findIndex((x) => x.id === event.id) === index)
  .sort((a, b) => String(b.detected_at).localeCompare(String(a.detected_at)))
  .slice(0, 250);

state.initialized_at = state.initialized_at ?? (initializedAny ? now : null);
eventFile = {
  generated_at: now,
  events: merged,
};

await fs.writeFile(statePath, JSON.stringify(state, null, 2) + "\n");
await fs.writeFile(eventsPath, JSON.stringify(eventFile, null, 2) + "\n");

console.log(
  "SEC monitor complete: " +
    newEvents.length +
    " new events; " +
    merged.length +
    " retained in feed."
);
