export const CAPITAL_ORCHESTRATOR_VERSION = "capital-orchestrator-v1";

export const PROVIDER_PRIORITY = {
  web_verified: 100,
  sec_form4: 95,
  sec_13f: 95,
  sec_direct: 95,
  financial_datasets: 90,
  quiver: 85,
  fmp: 75,
  alpha_vantage: 65,
  manual: 40,
};

const VALID_TYPES = new Set(["insider","institutional","political"]);

function n(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value) {
  if (!value) return null;
  const text = String(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function isoTimestamp(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function cleanText(value, max = 500) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

export function normalizeCapitalRecord(input, {
  provider,
  verifiedAt = new Date().toISOString(),
  companyByTicker = new Map(),
} = {}) {
  const errors = [];
  const ticker = cleanText(input?.ticker, 16)?.toUpperCase() ?? null;
  const activityType = cleanText(input?.activity_type ?? input?.activityType, 32)?.toLowerCase() ?? null;
  const actorName = cleanText(input?.actor_name ?? input?.actorName, 240);
  const action = cleanText(input?.action, 80);
  const sourceKey = cleanText(input?.source_key ?? input?.sourceKey, 500);
  const sourceUrl = cleanText(input?.source_url ?? input?.sourceUrl, 2000);
  const effectiveProvider = cleanText(input?.provider ?? provider, 120);

  if (!ticker) errors.push("ticker is required");
  if (!activityType || !VALID_TYPES.has(activityType)) errors.push("activity_type must be insider, institutional, or political");
  if (!actorName) errors.push("actor_name is required");
  if (!action) errors.push("action is required");
  if (!effectiveProvider) errors.push("provider is required");
  if (!sourceKey) errors.push("source_key is required");
  if (!sourceUrl) errors.push("source_url is required");

  const company = ticker ? companyByTicker.get(ticker) : null;
  if (!company) errors.push("ticker is not in the tracked company universe");

  const row = {
    company_id: company?.id ?? null,
    activity_type: activityType,
    actor_name: actorName,
    actor_detail: cleanText(input?.actor_detail ?? input?.actorDetail, 500),
    action,
    shares: n(input?.shares),
    price: n(input?.price),
    value: n(input?.value),
    change_pct: n(input?.change_pct ?? input?.changePct),
    amount_range: cleanText(input?.amount_range ?? input?.amountRange, 120),
    transaction_date: isoDate(input?.transaction_date ?? input?.transactionDate),
    disclosure_date: isoDate(input?.disclosure_date ?? input?.disclosureDate),
    position_date: isoDate(input?.position_date ?? input?.positionDate),
    source_url: sourceUrl,
    provider: effectiveProvider,
    source_key: sourceKey,
    verified_at: isoTimestamp(input?.verified_at ?? input?.verifiedAt ?? verifiedAt),
    raw_payload: {
      ...(input?.raw_payload && typeof input.raw_payload === "object" ? input.raw_payload : {}),
      orchestrator_version: CAPITAL_ORCHESTRATOR_VERSION,
      input_ticker: ticker,
    },
  };

  return { valid: errors.length === 0, errors, ticker, row };
}

export function dedupeCapitalRecords(records = []) {
  const map = new Map();
  for (const record of records) {
    const key = [record.provider, record.source_key].join("|");
    const prior = map.get(key);
    if (!prior) {
      map.set(key, record);
      continue;
    }
    const priorPriority = PROVIDER_PRIORITY[prior.provider] ?? 0;
    const nextPriority = PROVIDER_PRIORITY[record.provider] ?? 0;
    const priorVerified = Date.parse(prior.verified_at ?? "") || 0;
    const nextVerified = Date.parse(record.verified_at ?? "") || 0;
    if (nextPriority > priorPriority || (nextPriority === priorPriority && nextVerified > priorVerified)) {
      map.set(key, record);
    }
  }
  return [...map.values()];
}

export function materialityForCapitalActivity(row) {
  const type = row?.activity_type;
  const action = String(row?.action ?? "").toLowerCase();
  const value = n(row?.value);
  const change = n(row?.change_pct);

  if (type === "insider") {
    if (action === "buy" && (value == null || value >= 100000)) return "high";
    if (action === "sell" && value != null && value >= 5000000) return "review";
    return "info";
  }
  if (type === "institutional") {
    if (["new","exited"].includes(action)) return "review";
    if (change != null && Math.abs(change) >= 25) return "review";
    return "info";
  }
  return "info";
}

export function providerHealthRow({
  provider,
  feedType = "all",
  status,
  lastAttemptAt = new Date().toISOString(),
  lastSuccessAt = null,
  lastVerifiedAt = null,
  rowsWritten = 0,
  companiesCovered = 0,
  lastError = null,
  metadata = {},
} = {}) {
  return {
    provider,
    feed_type: feedType,
    status,
    last_attempt_at: lastAttemptAt,
    last_success_at: lastSuccessAt,
    last_verified_at: lastVerifiedAt,
    rows_written: rowsWritten,
    companies_covered: companiesCovered,
    last_error: lastError,
    metadata: { orchestrator_version: CAPITAL_ORCHESTRATOR_VERSION, ...metadata },
    updated_at: new Date().toISOString(),
  };
}

export function summarizeCapitalCoverage(rows = [], companies = []) {
  const byTicker = new Map(companies.map((company) => [
    String(company.ticker).toUpperCase(),
    { ticker: String(company.ticker).toUpperCase(), insider: 0, institutional: 0, political: 0, last_verified_at: null }
  ]));

  const companyTickerById = new Map(companies.map((company) => [company.id, String(company.ticker).toUpperCase()]));
  for (const row of rows) {
    const ticker = row.ticker ? String(row.ticker).toUpperCase() : companyTickerById.get(row.company_id);
    const bucket = byTicker.get(ticker);
    if (!bucket || !VALID_TYPES.has(row.activity_type)) continue;
    bucket[row.activity_type] += 1;
    const verified = row.verified_at ?? row.created_at ?? null;
    if (verified && (!bucket.last_verified_at || verified > bucket.last_verified_at)) bucket.last_verified_at = verified;
  }

  return [...byTicker.values()].map((item) => ({
    ...item,
    categories_covered: ["insider","institutional","political"].filter((key) => item[key] > 0).length,
  }));
}

export function feedFreshness({ lastSuccessAt, now = new Date(), staleAfterHours = 36 } = {}) {
  if (!lastSuccessAt) return "inactive";
  const ms = Date.parse(lastSuccessAt);
  if (!Number.isFinite(ms)) return "inactive";
  return now.getTime() - ms > staleAfterHours * 3600000 ? "stale" : "healthy";
}
