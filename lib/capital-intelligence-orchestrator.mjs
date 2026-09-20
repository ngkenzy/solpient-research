export const CAPITAL_ORCHESTRATOR_VERSION = "capital-orchestrator-v1.1";

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
const VALID_COVERAGE_STATUS = new Set(["pending","activity_found","verified_none","partial","unavailable"]);

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


export function normalizeCoverageCheck(input, {
  provider,
  verifiedAt = new Date().toISOString(),
  companyByTicker = new Map(),
} = {}) {
  const errors = [];
  const ticker = cleanText(input?.ticker, 16)?.toUpperCase() ?? null;
  const activityType = cleanText(input?.activity_type ?? input?.activityType, 32)?.toLowerCase() ?? null;
  const status = cleanText(input?.status, 32)?.toLowerCase() ?? null;
  const effectiveProvider = cleanText(input?.provider ?? provider, 120);
  const company = ticker ? companyByTicker.get(ticker) : null;

  if (!ticker) errors.push("ticker is required");
  if (!company) errors.push("ticker is not in the tracked company universe");
  if (!activityType || !VALID_TYPES.has(activityType)) errors.push("activity_type must be insider, institutional, or political");
  if (!status || !VALID_COVERAGE_STATUS.has(status)) errors.push("status must be pending, activity_found, verified_none, partial, or unavailable");
  if (!effectiveProvider) errors.push("provider is required");
  if (status === "verified_none" && !input?.source_url && !input?.sourceUrl) errors.push("verified_none requires a source_url");
  if (["activity_found","verified_none"].includes(status) && !(input?.verified_at ?? input?.verifiedAt ?? verifiedAt)) errors.push("verified coverage requires verified_at");

  const row = {
    company_id: company?.id ?? null,
    activity_type: activityType,
    status,
    provider: effectiveProvider,
    window_start: isoDate(input?.window_start ?? input?.windowStart),
    window_end: isoDate(input?.window_end ?? input?.windowEnd),
    verified_at: isoTimestamp(input?.verified_at ?? input?.verifiedAt ?? verifiedAt),
    record_count: Math.max(0, Math.trunc(n(input?.record_count ?? input?.recordCount) ?? 0)),
    source_url: cleanText(input?.source_url ?? input?.sourceUrl, 2000),
    source_key: cleanText(input?.source_key ?? input?.sourceKey, 500),
    notes: cleanText(input?.notes, 2000),
    metadata: {
      ...(input?.metadata && typeof input.metadata === "object" ? input.metadata : {}),
      orchestrator_version: CAPITAL_ORCHESTRATOR_VERSION,
      input_ticker: ticker,
    },
    updated_at: new Date().toISOString(),
  };

  return { valid: errors.length === 0, errors, ticker, row };
}

export function summarizeCapitalCoverageMatrix(checks = [], rows = [], companies = []) {
  const companyTickerById = new Map(companies.map((company) => [company.id, String(company.ticker).toUpperCase()]));
  const activityCounts = new Map();
  for (const row of rows) {
    if (!VALID_TYPES.has(row.activity_type)) continue;
    const key = [row.company_id, row.activity_type].join("|");
    activityCounts.set(key, (activityCounts.get(key) ?? 0) + 1);
  }

  const checkMap = new Map();
  for (const check of checks) {
    if (!VALID_TYPES.has(check.activity_type)) continue;
    checkMap.set([check.company_id, check.activity_type].join("|"), check);
  }

  return companies.map((company) => {
    const ticker = String(company.ticker).toUpperCase();
    const categories = {};
    let reviewed = 0;
    let complete = 0;
    let withActivity = 0;

    for (const activityType of ["insider","institutional","political"]) {
      const key = [company.id, activityType].join("|");
      const check = checkMap.get(key);
      const activityCount = activityCounts.get(key) ?? 0;
      const status = check?.status ?? (activityCount > 0 ? "activity_found" : "pending");
      if (status !== "pending") reviewed += 1;
      if (["activity_found","verified_none"].includes(status)) complete += 1;
      if (activityCount > 0 || status === "activity_found") withActivity += 1;
      categories[activityType] = {
        status,
        activity_count: activityCount,
        provider: check?.provider ?? null,
        verified_at: check?.verified_at ?? null,
        window_start: check?.window_start ?? null,
        window_end: check?.window_end ?? null,
        source_url: check?.source_url ?? null,
        notes: check?.notes ?? null,
      };
    }

    return {
      ticker,
      company_id: company.id,
      categories,
      categories_reviewed: reviewed,
      categories_complete: complete,
      categories_with_activity: withActivity,
      fully_reviewed: reviewed === 3,
      fully_verified: complete === 3,
    };
  });
}
