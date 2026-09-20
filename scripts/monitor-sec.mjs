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
const relevantForms = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A"]);
const managerForms = new Set(["13F-HR", "13F-HR/A"]);

function normalizeAccession(value) {
  return String(value ?? "").trim();
}

function filingUrl(cik, accession, primaryDocument) {
  const cikNoZeros = String(Number(cik));
  const accessionNoDashes = accession.replaceAll("-", "");
  return (
    "https://www.sec.gov/Archives/edgar/data/" +
    cikNoZeros +
    "/" +
    accessionNoDashes +
    "/" +
    primaryDocument
  );
}

function classify(form, items) {
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

  const itemText = Array.isArray(items) ? items.join(",") : String(items || "");
  const earningsRelated = /2\.02|9\.01/.test(itemText);

  if (normalized.startsWith("8-K") && earningsRelated) {
    return {
      category: "earnings_event",
      severity: "high",
      queue: "research_review",
      label: "New earnings-related 8-K",
      reason:
        "Results or guidance may materially change valuation, scores, or thesis conditions.",
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
      From: secContact,
      Host: "data.sec.gov",
      "Accept-Encoding": "gzip, deflate",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("SEC JSON request failed " + response.status + " for " + url);
  }

  return response.json();
}

async function secText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      From: secContact,
      Host: "www.sec.gov",
      "Accept-Encoding": "gzip, deflate",
      Accept: "application/atom+xml,text/xml,application/xml,text/html",
    },
  });

  if (!response.ok) {
    throw new Error("SEC text request failed " + response.status + " for " + url);
  }

  return response.text();
}

function textTag(block, tag) {
  const match = block.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)<\\/" + tag + ">", "i"));
  return match ? match[1].replace(/<[^>]+>/g, "").trim() : null;
}

function parseOwnershipAtom(xml) {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/gi) ?? [];

  return entries
    .map((entry) => {
      const accession =
        textTag(entry, "accession-number") ||
        (entry.match(/accession-number=([0-9-]+)/i)?.[1] ?? null);
      const filingDate = textTag(entry, "filing-date") || textTag(entry, "updated");
      const link =
        entry.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ??
        entry.match(/<filing-href>([^<]+)<\/filing-href>/i)?.[1] ??
        null;

      return {
        accession: normalizeAccession(accession),
        filingDate: filingDate ? filingDate.slice(0, 10) : null,
        sourceUrl: link,
      };
    })
    .filter((entry) => entry.accession);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

  const prior = state.companies[ticker] ?? null;

  if (!prior) {
    state.companies[ticker] = {
      cik: company.cik,
      checked_at: now,
      seen_accessions: filings.map((filing) => filing.accession),
      ownership_seen_accessions: [],
    };
    initializedAny = true;
    console.log("Initialized company filing baseline for " + ticker + ".");
  } else {
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
      ...prior,
      cik: company.cik,
      checked_at: now,
      seen_accessions: Array.from(
        new Set([...(prior.seen_accessions ?? []), ...filings.map((filing) => filing.accession)])
      ).slice(0, 200),
    };

    console.log("Checked company filings for " + ticker + ": " + unseen.length + " new.");
  }

  await sleep(140);

  // SEC ownership browse endpoint includes issuer-related Forms 3/4/5 even when an insider is the filer.
  const ownershipUrl =
    "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" +
    company.cik +
    "&type=4&owner=include&count=40&output=atom";

  try {
    const ownershipXml = await secText(ownershipUrl);
    const ownershipFilings = parseOwnershipAtom(ownershipXml).slice(0, 40);
    const current = state.companies[ticker] ?? {};
    const ownershipPrior = current.ownership_seen_accessions ?? [];

    if (ownershipPrior.length === 0) {
      state.companies[ticker] = {
        ...current,
        ownership_seen_accessions: ownershipFilings.map((filing) => filing.accession),
      };
      console.log("Initialized Form 4 baseline for " + ticker + ".");
    } else {
      const seenOwnership = new Set(ownershipPrior);
      const unseenOwnership = ownershipFilings
        .filter((filing) => !seenOwnership.has(filing.accession))
        .sort((a, b) => String(a.filingDate).localeCompare(String(b.filingDate)));

      for (const filing of unseenOwnership) {
        newEvents.push({
          id: ticker + "-form4-" + filing.accession,
          ticker,
          company_name: company.company_name,
          form: "4",
          accession_number: filing.accession,
          filing_date: filing.filingDate,
          report_date: null,
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
        ...state.companies[ticker],
        ownership_seen_accessions: Array.from(
          new Set([...ownershipPrior, ...ownershipFilings.map((filing) => filing.accession)])
        ).slice(0, 200),
      };

      console.log("Checked Form 4 filings for " + ticker + ": " + unseenOwnership.length + " new.");
    }
  } catch (error) {
    console.warn("Form 4 monitor warning for " + ticker + ": " + error.message);
  }

  await sleep(140);
}

for (const manager of managers) {
  const key = manager.cik;
  const url = "https://data.sec.gov/submissions/CIK" + manager.cik + ".json";

  try {
    const submission = await secJson(url);
    const recent = submission.filings?.recent ?? {};
    const filings = (recent.accessionNumber ?? [])
      .map((accession, index) => ({
        accession: normalizeAccession(accession),
        form: recent.form?.[index],
        filingDate: recent.filingDate?.[index],
        reportDate: recent.reportDate?.[index],
        primaryDocument: recent.primaryDocument?.[index],
      }))
      .filter((filing) => managerForms.has(String(filing.form || "").toUpperCase()))
      .slice(0, 12);

    const prior = state.managers[key];

    if (!prior) {
      state.managers[key] = {
        name: manager.name,
        checked_at: now,
        seen_accessions: filings.map((filing) => filing.accession),
      };
      initializedAny = true;
      console.log("Initialized 13F baseline for " + manager.name + ".");
      await sleep(140);
      continue;
    }

    const seen = new Set(prior.seen_accessions ?? []);
    const unseen = filings
      .filter((filing) => filing.accession && !seen.has(filing.accession))
      .sort((a, b) => String(a.filingDate).localeCompare(String(b.filingDate)));

    for (const filing of unseen) {
      for (const ticker of manager.tracked_tickers ?? []) {
        const company = companies.find((item) => item.ticker.toUpperCase() === ticker.toUpperCase());
        newEvents.push({
          id: ticker + "-13f-" + manager.cik + "-" + filing.accession,
          ticker,
          company_name: company?.company_name ?? ticker,
          form: filing.form,
          accession_number: filing.accession,
          filing_date: filing.filingDate || null,
          report_date: filing.reportDate || null,
          items: null,
          source_url: filing.primaryDocument
            ? filingUrl(manager.cik, filing.accession, filing.primaryDocument)
            : null,
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
      checked_at: now,
      seen_accessions: Array.from(
        new Set([...(prior.seen_accessions ?? []), ...filings.map((filing) => filing.accession)])
      ).slice(0, 80),
    };

    console.log("Checked 13F filings for " + manager.name + ": " + unseen.length + " new.");
  } catch (error) {
    console.warn("13F monitor warning for " + manager.name + ": " + error.message);
  }

  await sleep(140);
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
