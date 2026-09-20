export const YAHOO_CAPITAL_PROVIDER = "yahoo_capital";

function raw(value) {
  if (value && typeof value === "object" && "raw" in value) return value.raw;
  return value ?? null;
}
function num(value) {
  const x = Number(raw(value));
  return Number.isFinite(x) ? x : null;
}
function text(value) {
  const v = raw(value);
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}
function isoDate(value) {
  const v = raw(value);
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || /^\d+$/.test(String(v))) {
    const n = Number(v);
    const ms = n > 10_000_000_000 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  }
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}
function safeKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}
function normalizeFilerUrl(value, ticker) {
  const url = text(value);
  if (!url) return "https://finance.yahoo.com/quote/" + encodeURIComponent(ticker) + "/insider-transactions/";
  if (/^https?:\/\//i.test(url)) return url;
  return "https://finance.yahoo.com" + (url.startsWith("/") ? url : "/" + url);
}
function transactionAction(transactionText) {
  const s = String(transactionText ?? "").toLowerCase();
  if (/\b(purchase|purchased|buy|bought)\b/.test(s)) return "Buy";
  if (/\b(sale|sold|sell)\b/.test(s)) return "Sell";
  return null;
}

export function normalizeYahooCapital({ company, body, verifiedAt = new Date().toISOString() } = {}) {
  const result = body?.quoteSummary?.result?.[0] ?? body ?? {};
  const insiderTransactions = result?.insiderTransactions?.transactions ?? [];
  const ownershipList = result?.institutionOwnership?.ownershipList ?? [];
  const ticker = company?.ticker;
  const rows = [];
  const coverage = [];

  for (const tx of insiderTransactions) {
    const action = transactionAction(text(tx.transactionText));
    if (!action) continue;
    const shares = num(tx.shares);
    const value = num(tx.value);
    const transactionDate = isoDate(tx.startDate);
    const actor = text(tx.filerName) ?? "Reported insider";
    const sourceUrl = normalizeFilerUrl(tx.filerUrl, ticker);
    rows.push({
      company_id: company.id,
      activity_type: "insider",
      actor_name: actor,
      actor_detail: text(tx.filerRelation) ?? "Insider",
      action,
      shares,
      price: shares && value ? value / shares : null,
      value,
      change_pct: null,
      amount_range: null,
      transaction_date: transactionDate,
      disclosure_date: null,
      position_date: null,
      source_url: sourceUrl,
      provider: YAHOO_CAPITAL_PROVIDER,
      source_key: ["yahoo","insider",ticker,safeKey(actor),transactionDate ?? "unknown",shares ?? "na",value ?? "na"].join(":"),
      verified_at: verifiedAt,
      raw_payload: {
        transaction_text: text(tx.transactionText),
        money_text: text(tx.moneyText),
        ownership: text(tx.ownership),
      },
    });
  }

  const insiderPage = "https://finance.yahoo.com/quote/" + encodeURIComponent(ticker) + "/insider-transactions/";
  coverage.push({
    company_id: company.id,
    activity_type: "insider",
    status: rows.some((row) => row.activity_type === "insider") ? "activity_found" : "partial",
    provider: YAHOO_CAPITAL_PROVIDER,
    window_start: null,
    window_end: verifiedAt.slice(0, 10),
    verified_at: verifiedAt,
    record_count: rows.filter((row) => row.activity_type === "insider").length,
    source_url: insiderPage,
    source_key: ["yahoo","coverage",ticker,"insider",verifiedAt.slice(0,10)].join(":"),
    notes: rows.some((row) => row.activity_type === "insider")
      ? "Yahoo insider-transactions module returned qualifying buy/sell records."
      : "Yahoo returned no qualifying buy/sell rows; treated as partial rather than verified-none.",
    metadata: { module: "insiderTransactions" },
    updated_at: new Date().toISOString(),
  });

  for (const holder of ownershipList) {
    const organization = text(holder.organization);
    if (!organization) continue;
    const pctChangeRaw = num(holder.pctChange);
    const changePct = pctChangeRaw == null ? null : pctChangeRaw * 100;
    const action = changePct == null ? "Reported" : changePct > 0.5 ? "Increased" : changePct < -0.5 ? "Reduced" : "Reported";
    const positionDate = isoDate(holder.reportDate);
    rows.push({
      company_id: company.id,
      activity_type: "institutional",
      actor_name: organization,
      actor_detail: "Institutional holder",
      action,
      shares: num(holder.position),
      price: null,
      value: num(holder.value),
      change_pct: changePct,
      amount_range: null,
      transaction_date: null,
      disclosure_date: null,
      position_date: positionDate,
      source_url: "https://finance.yahoo.com/quote/" + encodeURIComponent(ticker) + "/holders/",
      provider: YAHOO_CAPITAL_PROVIDER,
      source_key: ["yahoo","institutional",ticker,safeKey(organization),positionDate ?? "unknown"].join(":"),
      verified_at: verifiedAt,
      raw_payload: {
        pct_held: num(holder.pctHeld),
        pct_change_raw: pctChangeRaw,
      },
    });
  }

  const institutionRows = rows.filter((row) => row.activity_type === "institutional");
  coverage.push({
    company_id: company.id,
    activity_type: "institutional",
    status: institutionRows.length ? "activity_found" : "partial",
    provider: YAHOO_CAPITAL_PROVIDER,
    window_start: null,
    window_end: verifiedAt.slice(0, 10),
    verified_at: verifiedAt,
    record_count: institutionRows.length,
    source_url: "https://finance.yahoo.com/quote/" + encodeURIComponent(ticker) + "/holders/",
    source_key: ["yahoo","coverage",ticker,"institutional",verifiedAt.slice(0,10)].join(":"),
    notes: institutionRows.length
      ? "Yahoo institution-ownership module returned disclosed holder positions."
      : "Yahoo returned no institutional ownership rows; treated as partial rather than verified-none.",
    metadata: { module: "institutionOwnership" },
    updated_at: new Date().toISOString(),
  });

  return {
    rows,
    coverage,
    summary: {
      ticker,
      insider_rows: rows.filter((row) => row.activity_type === "insider").length,
      institutional_rows: institutionRows.length,
    },
  };
}
