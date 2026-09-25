import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const companiesPath = path.join(root, "data/monitor/companies.json");
const managersPath = path.join(root, "data/monitor/managers.json");
const statePath = path.join(root, "data/monitor/sec-state.json");
const eventsPath = path.join(root, "data/monitor/sec-events.json");

const secContact =
  process.env.SEC_CONTACT ||
  "ngkenzy@users.noreply.github.com";

const userAgent =
  process.env.SEC_USER_AGENT ||
  "SOLPIENT Research " + secContact;

const companies = JSON.parse(await fs.readFile(companiesPath, "utf8"));
const managers = JSON.parse(await fs.readFile(managersPath, "utf8"));
let state = JSON.parse(await fs.readFile(statePath, "utf8"));
let eventFile = JSON.parse(await fs.readFile(eventsPath, "utf8"));

state.companies = state.companies ?? {};
state.managers = state.managers ?? {};

const now = new Date().toISOString();
let successfulRequests = 0;

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function secJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      From: secContact,
      "Accept-Encoding": "gzip, deflate",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("SEC request failed " + response.status + " for " + url);
  }

  successfulRequests += 1;
  await sleep(140);
  return response.json();
}

function submissionsUrl(cik) {
  return "https://data.sec.gov/submissions/CIK" +
    String(cik).replace(/\D/g, "").padStart(10, "0") +
    ".json";
}

function formMatches(actualForm, requestedForm) {
  const actual=String(actualForm??"").toUpperCase();
  const requested=String(requestedForm??"").toUpperCase();
  return actual===requested || actual===requested+"/A";
}

function filingSourceUrl(cik, accession, primaryDocument) {
  if(!accession || !primaryDocument) return null;
  const cikNumber=String(Number(String(cik).replace(/\D/g,"")));
  const accessionFolder=String(accession).replace(/-/g,"");
  return "https://www.sec.gov/Archives/edgar/data/" +
    cikNumber + "/" + accessionFolder + "/" + primaryDocument;
}

function recentFilingsFromSubmissions(body,cik,requestedForm) {
  const recent=body?.filings?.recent??{};
  const accessions=recent.accessionNumber??[];
  const forms=recent.form??[];
  const filingDates=recent.filingDate??[];
  const reportDates=recent.reportDate??[];
  const primaryDocuments=recent.primaryDocument??[];
  const out=[];

  for(let i=0;i<accessions.length;i++){
    const form=forms[i]??null;
    if(!formMatches(form,requestedForm)) continue;
    const accession=String(accessions[i]??"").trim();
    if(!accession) continue;
    out.push({
      accession,
      filingDate:filingDates[i]??null,
      reportDate:reportDates[i]??null,
      sourceUrl:filingSourceUrl(cik,accession,primaryDocuments[i]??null),
      form,
    });
  }
  return out.slice(0,120);
}

async function fetchSubmissions(cik) {
  return secJson(submissionsUrl(cik));
}

function classify(form) {
  const normalized = String(form || "").toUpperCase();

  if (normalized.startsWith("10-K")) {
    return {
      category: "annual_filing",
      severity: "high",
      queue: "research_review",
      label: "New annual filing",
      reason:
        "Full-year financials and thesis assumptions may require a new SOLPIENT research version.",
    };
  }

  if (normalized.startsWith("10-Q")) {
    return {
      category: "quarterly_filing",
      severity: "high",
      queue: "research_review",
      label: "New quarterly filing",
      reason:
        "Quarterly fundamentals and thesis evidence should be compared with the current research version.",
    };
  }

  if (normalized.startsWith("8-K")) {
    return {
      category: "company_event",
      severity: "medium",
      queue: "research_review",
      label: "New 8-K filing",
      reason:
        "A new current report was detected. Review it for earnings, guidance, management, or other thesis-relevant changes.",
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


const newEvents = [];
let initializedAny = false;

for (const company of companies) {
  const ticker = company.ticker.toUpperCase();
  const cik = company.cik;
  if (!cik) {
    console.warn("Skipping " + ticker + ": canonical CIK is missing.");
    continue;
  }
  const prior = state.companies[ticker] ?? null;

  let submissions=null;
  try {
    submissions=await fetchSubmissions(cik);
  } catch (error) {
    console.warn("SEC submissions monitor warning for " + ticker + ": " + error.message);
  }

  const corporateForms = [];
  if(submissions){
    for (const form of company.forms ?? ["10-K", "10-Q", "8-K"]) {
      corporateForms.push(...recentFilingsFromSubmissions(submissions,cik,form));
    }
  }

  const corporateUnique = corporateForms
    .filter((filing, index, array) =>
      array.findIndex((item) => item.accession === filing.accession) === index
    )
    .slice(0, 120);

  const ownershipFilings = submissions
    ? recentFilingsFromSubmissions(submissions,cik,"4")
    : [];

  if (!prior) {
    state.companies[ticker] = {
      cik,
      checked_at: now,
      seen_accessions: corporateUnique.map((filing) => filing.accession),
      ownership_seen_accessions: ownershipFilings.map((filing) => filing.accession),
    };
    initializedAny = true;
    console.log(
      "Initialized baseline for " +
        ticker +
        " with " +
        corporateUnique.length +
        " company filings and " +
        ownershipFilings.length +
        " Form 4 filings."
    );
    continue;
  }

  const seen = new Set(prior.seen_accessions ?? []);
  const unseen = corporateUnique
    .filter((filing) => !seen.has(filing.accession))
    .sort((a, b) => String(a.filingDate).localeCompare(String(b.filingDate)));

  for (const filing of unseen) {
    newEvents.push({
      id: ticker + "-" + filing.accession,
      ticker,
      company_name: company.company_name,
      form: filing.form,
      accession_number: filing.accession,
      filing_date: filing.filingDate,
      report_date: filing.reportDate ?? null,
      items: null,
      source_url: filing.sourceUrl,
      detected_at: now,
      status: "new",
      ...classify(filing.form),
    });
  }

  const ownershipSeen = new Set(prior.ownership_seen_accessions ?? []);
  const unseenOwnership = ownershipFilings
    .filter((filing) => !ownershipSeen.has(filing.accession))
    .sort((a, b) => String(a.filingDate).localeCompare(String(b.filingDate)));

  for (const filing of unseenOwnership) {
    newEvents.push({
      id: ticker + "-form4-" + filing.accession,
      ticker,
      company_name: company.company_name,
      form: "4",
      accession_number: filing.accession,
      filing_date: filing.filingDate,
      report_date: filing.reportDate ?? null,
      items: null,
      source_url: filing.sourceUrl,
      detected_at: now,
      status: "new",
      category: "insider_filing",
      severity: "medium",
      queue: "ownership_review",
      label: "New insider Form 4",
      reason:
        "A new insider ownership filing was detected. Review the transaction before updating the insider-activity panel.",
    });
  }

  state.companies[ticker] = {
    ...prior,
    cik,
    checked_at: now,
    seen_accessions: Array.from(
      new Set([...(prior.seen_accessions ?? []), ...corporateUnique.map((filing) => filing.accession)])
    ).slice(0, 240),
    ownership_seen_accessions: Array.from(
      new Set([
        ...(prior.ownership_seen_accessions ?? []),
        ...ownershipFilings.map((filing) => filing.accession),
      ])
    ).slice(0, 240),
  };

  console.log(
    "Checked " +
      ticker +
      ": " +
      unseen.length +
      " new company filings; " +
      unseenOwnership.length +
      " new Form 4 filings."
  );
}

for (const manager of managers) {
  const key = manager.cik;
  let filings = [];

  try {
    const submissions=await fetchSubmissions(manager.cik);
    filings=recentFilingsFromSubmissions(submissions,manager.cik,"13F-HR");
  } catch (error) {
    console.warn("13F submissions monitor warning for " + manager.name + ": " + error.message);
  }

  const prior = state.managers[key];

  if (!prior) {
    state.managers[key] = {
      name: manager.name,
      checked_at: now,
      seen_accessions: filings.map((filing) => filing.accession),
    };
    initializedAny = true;
    console.log("Initialized 13F baseline for " + manager.name + ".");
    continue;
  }

  const seen = new Set(prior.seen_accessions ?? []);
  const unseen = filings
    .filter((filing) => !seen.has(filing.accession))
    .sort((a, b) => String(a.filingDate).localeCompare(String(b.filingDate)));

  for (const filing of unseen) {
    for (const ticker of manager.tracked_tickers ?? []) {
      const company = companies.find(
        (item) => item.ticker.toUpperCase() === ticker.toUpperCase()
      );

      newEvents.push({
        id: ticker + "-13f-" + manager.cik + "-" + filing.accession,
        ticker,
        company_name: company?.company_name ?? ticker,
        form: filing.form || "13F-HR",
        accession_number: filing.accession,
        filing_date: filing.filingDate,
        report_date: null,
        items: null,
        source_url: filing.sourceUrl,
        detected_at: now,
        status: "new",
        category: "institutional_filing",
        severity: "medium",
        queue: "ownership_review",
        label: "New notable-manager 13F",
        reason:
          manager.investor +
          " / " +
          manager.name +
          " filed a new 13F. Refresh this company's disclosed ownership before interpreting the position.",
        manager_name: manager.name,
        investor_name: manager.investor,
      });
    }
  }

  state.managers[key] = {
    name: manager.name,
    checked_at: unseen.length > 0 ? now : prior.checked_at,
    seen_accessions: Array.from(
      new Set([...(prior.seen_accessions ?? []), ...filings.map((filing) => filing.accession)])
    ).slice(0, 100),
  };

  console.log("Checked 13F filings for " + manager.name + ": " + unseen.length + " new.");
}

if (successfulRequests === 0) {
  throw new Error(
    "No SEC submissions API requests succeeded. Production SEC monitoring cannot be trusted."
  );
}

const existingEvents = Array.isArray(eventFile.events) ? eventFile.events : [];
const merged = [...newEvents, ...existingEvents]
  .filter((event, index, array) => array.findIndex((item) => item.id === event.id) === index)
  .sort((a, b) => String(b.detected_at).localeCompare(String(a.detected_at)))
  .slice(0, 250);

state.initialized_at = state.initialized_at ?? (initializedAny ? now : null);

eventFile = {
  generated_at:
    newEvents.length > 0 || initializedAny
      ? now
      : eventFile.generated_at ?? state.initialized_at ?? null,
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
