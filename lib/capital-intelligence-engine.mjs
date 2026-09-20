export const CAPITAL_INTELLIGENCE_VERSION = "capital-intelligence-v1";

function decodeXml(value="") {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function textTag(block, tag) {
  const match = String(block ?? "").match(new RegExp("<(?:[A-Za-z0-9_]+:)?" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?" + tag + ">", "i"));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "").trim()) : null;
}

function blocks(xml, tag) {
  return String(xml ?? "").match(new RegExp("<(?:[A-Za-z0-9_]+:)?" + tag + "(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:[A-Za-z0-9_]+:)?" + tag + ">", "gi")) ?? [];
}

function num(value) {
  const x = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(x) ? x : null;
}

function yes(value) {
  return ["1", "true", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

export function normalizeIssuerName(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(CLASS|CL|COM|COMMON|STOCK|SHARES?|ORDINARY|ORD|NEW)\b/g, " ")
    .replace(/\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LIMITED|LTD|PLC|HOLDINGS?|HLDGS?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function companyNames(company) {
  return new Set([
    company?.ticker,
    company?.company_name,
    ...(company?.aliases ?? []),
  ].map(normalizeIssuerName).filter(Boolean));
}

export function matchTrackedCompany(issuerName, companies=[]) {
  const issuer = normalizeIssuerName(issuerName);
  if (!issuer) return null;

  const exact = companies.find((company) => companyNames(company).has(issuer));
  if (exact) return exact;

  const candidates = companies.filter((company) => {
    for (const name of companyNames(company)) {
      if (!name || name.length < 4) continue;
      if (issuer === name || issuer.startsWith(name + " ") || name.startsWith(issuer + " ")) return true;
    }
    return false;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function relationship(ownerBlock) {
  const rel = textTag(ownerBlock, "reportingOwnerRelationship") ? ownerBlock.match(/<(?:[A-Za-z0-9_]+:)?reportingOwnerRelationship(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?reportingOwnerRelationship>/i)?.[0] ?? "" : ownerBlock;
  const officerTitle = textTag(rel, "officerTitle");
  const labels = [];
  if (yes(textTag(rel, "isDirector"))) labels.push("Director");
  if (yes(textTag(rel, "isOfficer"))) labels.push(officerTitle || "Officer");
  if (yes(textTag(rel, "isTenPercentOwner"))) labels.push("10% owner");
  if (yes(textTag(rel, "isOther"))) labels.push(textTag(rel, "otherText") || "Other");
  return [...new Set(labels)].join(" · ") || officerTitle || "Insider";
}

export function parseForm4(xml, { companyId=null, ticker=null, accession=null, filingDate=null, sourceUrl=null }={}) {
  const issuerTicker = textTag(xml, "issuerTradingSymbol") || ticker;
  const owners = blocks(xml, "reportingOwner");
  const ownerName = owners.map((owner) => textTag(owner, "rptOwnerName")).filter(Boolean).join(" / ") || "Reporting owner";
  const ownerDetail = owners.map(relationship).filter(Boolean).join(" / ") || "Insider";
  const rows = [];

  const transactions = blocks(xml, "nonDerivativeTransaction");
  let index = 0;
  for (const tx of transactions) {
    const codeBlock = tx.match(/<(?:[A-Za-z0-9_]+:)?transactionCoding(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?transactionCoding>/i)?.[0] ?? tx;
    const amountsBlock = tx.match(/<(?:[A-Za-z0-9_]+:)?transactionAmounts(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?transactionAmounts>/i)?.[0] ?? tx;
    const code = String(textTag(codeBlock, "transactionCode") ?? "").toUpperCase();
    if (!["P", "S"].includes(code)) continue;

    const shares = num(textTag(amountsBlock, "transactionShares"));
    const price = num(textTag(amountsBlock, "transactionPricePerShare"));
    const acquiredDisposed = String(textTag(amountsBlock, "transactionAcquiredDisposedCode") ?? "").toUpperCase();
    const action = code === "P" || acquiredDisposed === "A" ? "Buy" : "Sell";
    const transactionDate = textTag(tx, "transactionDate");
    const securityTitle = textTag(tx, "securityTitle");
    const value = shares != null && price != null ? shares * price : null;

    rows.push({
      company_id: companyId,
      activity_type: "insider",
      actor_name: ownerName,
      actor_detail: [ownerDetail, securityTitle].filter(Boolean).join(" · "),
      action,
      shares,
      price,
      value,
      change_pct: null,
      amount_range: null,
      transaction_date: transactionDate,
      disclosure_date: filingDate,
      position_date: null,
      source_url: sourceUrl,
      provider: "sec_form4",
      source_key: ["form4", accession ?? "unknown", index++].join(":"),
      raw_payload: {
        version: CAPITAL_INTELLIGENCE_VERSION,
        accession,
        issuer_ticker: issuerTicker,
        transaction_code: code,
        acquired_disposed_code: acquiredDisposed,
        security_title: securityTitle,
      },
    });
  }
  return rows;
}

export function parse13FInformationTable(xml) {
  const out = [];
  for (const item of blocks(xml, "infoTable")) {
    const putCall = textTag(item, "putCall");
    if (putCall) continue;
    const issuer = textTag(item, "nameOfIssuer");
    const sharesBlock = item.match(/<(?:[A-Za-z0-9_]+:)?shrsOrPrnAmt(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?shrsOrPrnAmt>/i)?.[0] ?? item;
    out.push({
      issuer,
      title_of_class: textTag(item, "titleOfClass"),
      cusip: textTag(item, "cusip"),
      value_usd: (() => {
        const value = num(textTag(item, "value"));
        return value == null ? null : value * 1000;
      })(),
      shares: num(textTag(sharesBlock, "sshPrnamt")),
      shares_type: textTag(sharesBlock, "sshPrnamtType"),
      discretion: textTag(item, "investmentDiscretion"),
    });
  }
  return out.filter((row) => row.issuer);
}

export function buildInstitutionalActivity({
  manager,
  companies,
  latestHoldings=[],
  previousHoldings=[],
  positionDate=null,
  disclosureDate=null,
  sourceUrl=null,
  accession=null,
}={}) {
  const previousByTicker = new Map();
  for (const holding of previousHoldings) {
    const company = matchTrackedCompany(holding.issuer, companies);
    if (company) previousByTicker.set(company.ticker.toUpperCase(), holding);
  }

  const latestByTicker = new Map();
  for (const holding of latestHoldings) {
    const company = matchTrackedCompany(holding.issuer, companies);
    if (company) latestByTicker.set(company.ticker.toUpperCase(), { company, holding });
  }

  const rows = [];
  for (const [ticker, { company, holding }] of latestByTicker) {
    const prior = previousByTicker.get(ticker);
    const latestShares = num(holding.shares);
    const priorShares = num(prior?.shares);
    const changePct = latestShares != null && priorShares != null && priorShares !== 0
      ? (latestShares / priorShares - 1) * 100
      : null;
    const action = prior == null
      ? "New"
      : changePct == null
        ? "Reported"
        : changePct > 0.5
          ? "Increased"
          : changePct < -0.5
            ? "Reduced"
            : "Reported";

    rows.push({
      company_id: company.id ?? null,
      activity_type: "institutional",
      actor_name: manager.investor ?? manager.name,
      actor_detail: manager.name,
      action,
      shares: latestShares,
      price: null,
      value: num(holding.value_usd),
      change_pct: changePct,
      amount_range: null,
      transaction_date: null,
      disclosure_date: disclosureDate,
      position_date: positionDate,
      source_url: sourceUrl,
      provider: "sec_13f",
      source_key: ["13f", manager.cik, positionDate ?? "unknown", ticker].join(":"),
      raw_payload: {
        version: CAPITAL_INTELLIGENCE_VERSION,
        accession,
        issuer: holding.issuer,
        cusip: holding.cusip,
        title_of_class: holding.title_of_class,
        prior_shares: priorShares,
      },
    });
  }

  for (const [ticker, prior] of previousByTicker) {
    if (latestByTicker.has(ticker)) continue;
    const company = companies.find((item) => item.ticker.toUpperCase() === ticker);
    if (!company) continue;
    rows.push({
      company_id: company.id ?? null,
      activity_type: "institutional",
      actor_name: manager.investor ?? manager.name,
      actor_detail: manager.name,
      action: "Exited",
      shares: 0,
      price: null,
      value: 0,
      change_pct: -100,
      amount_range: null,
      transaction_date: null,
      disclosure_date: disclosureDate,
      position_date: positionDate,
      source_url: sourceUrl,
      provider: "sec_13f",
      source_key: ["13f", manager.cik, positionDate ?? "unknown", ticker].join(":"),
      raw_payload: {
        version: CAPITAL_INTELLIGENCE_VERSION,
        accession,
        issuer: prior.issuer,
        cusip: prior.cusip,
        title_of_class: prior.title_of_class,
        prior_shares: num(prior.shares),
      },
    });
  }

  return rows;
}

export function latestInstitutionalRows(rows=[]) {
  const sorted = [...rows].sort((a,b) =>
    String(b.position_date ?? b.disclosure_date ?? b.created_at ?? "").localeCompare(
      String(a.position_date ?? a.disclosure_date ?? a.created_at ?? "")
    )
  );
  const seen = new Set();
  return sorted.filter((row) => {
    const key = [row.actor_name, row.actor_detail].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
