import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "@/lib/admin-supabase";
import {
  CAPITAL_ORCHESTRATOR_VERSION,
  dedupeCapitalRecords,
  materialityForCapitalActivity,
  normalizeCapitalRecord,
  normalizeCoverageCheck,
  providerHealthRow,
  shouldReplaceCoverage,
} from "@/lib/capital-intelligence-orchestrator.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function secretMatches(request: Request) {
  const configured = process.env.CAPITAL_INGEST_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!configured || !supplied) return false;
  const a = Buffer.from(configured);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!secretMatches(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminSupabase();
  if (!supabase) {
    return Response.json({ error: "Server database connection is not configured." }, { status: 503 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const provider = String(body?.provider ?? "").trim().slice(0, 120);
  const sourceRunId = body?.source_run_id ? String(body.source_run_id).slice(0, 240) : null;
  const verifiedAt = body?.verified_at ? new Date(body.verified_at).toISOString() : new Date().toISOString();
  const records = Array.isArray(body?.records) ? body.records.slice(0, 1000) : [];
  const coverage = Array.isArray(body?.coverage) ? body.coverage.slice(0, 1000) : [];

  if (!provider || (!records.length && !coverage.length)) {
    return Response.json(
      { error: "provider and at least one records or coverage item are required." },
      { status: 400 },
    );
  }

  const { data: companies, error: companiesError } = await supabase
    .from("companies")
    .select("id,ticker,company_name");
  if (companiesError) throw companiesError;

  const companyByTicker = new Map(
    (companies ?? []).map((company: any) => [String(company.ticker).toUpperCase(), company]),
  );

  const rejected: Array<{ kind: "record" | "coverage"; index: number; errors: string[]; ticker?: string | null }> = [];
  const normalized: any[] = [];
  const normalizedCoverage: any[] = [];

  records.forEach((record: any, index: number) => {
    const result = normalizeCapitalRecord(record, { provider, verifiedAt, companyByTicker });
    if (!result.valid) {
      rejected.push({ kind: "record", index, errors: result.errors, ticker: result.ticker });
    } else {
      normalized.push(result.row);
    }
  });

  coverage.forEach((item: any, index: number) => {
    const result = normalizeCoverageCheck(item, { provider, verifiedAt, companyByTicker });
    if (!result.valid) {
      rejected.push({ kind: "coverage", index, errors: result.errors, ticker: result.ticker });
    } else {
      normalizedCoverage.push(result.row);
    }
  });

  const accepted = dedupeCapitalRecords(normalized);
  let stored: any[] = [];

  if (accepted.length) {
    const { data, error } = await supabase
      .from("capital_activity")
      .upsert(accepted, { onConflict: "provider,source_key", ignoreDuplicates: false })
      .select("id,company_id,activity_type,actor_name,actor_detail,action,shares,price,value,change_pct,amount_range,transaction_date,disclosure_date,position_date,source_url,provider,source_key,verified_at");
    if (error) throw error;
    stored = data ?? [];
  }

  if (stored.length) {
    const events = stored.map((row: any) => ({
      company_id: row.company_id,
      source_kind: "capital_activity",
      source_id: row.id,
      event_type: row.activity_type,
      occurred_at: row.transaction_date ?? row.position_date ?? null,
      disclosed_at: row.disclosure_date ? row.disclosure_date + "T00:00:00Z" : row.verified_at,
      title: row.actor_name + " · " + row.action,
      summary:
        row.activity_type === "institutional"
          ? (row.actor_detail ?? row.actor_name) + " disclosed a position update."
          : row.activity_type === "insider"
            ? (row.actor_detail ?? "Insider") + " reported an ownership transaction."
            : (row.actor_detail ?? "Political filer") + " disclosed a transaction.",
      materiality: materialityForCapitalActivity(row),
      review_status: "open",
      source_url: row.source_url,
      metadata: {
        action: row.action,
        shares: row.shares,
        price: row.price,
        value: row.value,
        change_pct: row.change_pct,
        amount_range: row.amount_range,
        position_date: row.position_date,
        provider: row.provider,
        verified_at: row.verified_at,
        orchestrator_version: CAPITAL_ORCHESTRATOR_VERSION,
      },
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("intelligence_events")
      .upsert(events, { onConflict: "source_kind,source_id", ignoreDuplicates: false });
    if (error) throw error;
  }

  const activityCoverage = new Map<string, any>();
  for (const row of accepted) {
    const key = [row.company_id, row.activity_type].join("|");
    const prior = activityCoverage.get(key);
    activityCoverage.set(key, {
      company_id: row.company_id,
      activity_type: row.activity_type,
      status: "activity_found",
      provider,
      window_end: row.disclosure_date ?? row.transaction_date ?? row.position_date ?? verifiedAt.slice(0, 10),
      verified_at: row.verified_at ?? verifiedAt,
      record_count: (prior?.record_count ?? 0) + 1,
      source_url: row.source_url,
      source_key: row.source_key,
      notes: "Activity found in normalized ingest batch.",
      metadata: {
        orchestrator_version: CAPITAL_ORCHESTRATOR_VERSION,
        source_run_id: sourceRunId,
      },
      updated_at: new Date().toISOString(),
    });
  }

  const coverageByKey = new Map<string, any>();
  for (const row of activityCoverage.values()) {
    coverageByKey.set([row.company_id, row.activity_type].join("|"), row);
  }
  for (const row of normalizedCoverage) {
    const key = [row.company_id, row.activity_type].join("|");
    const activityRow = coverageByKey.get(key);
    if (activityRow && row.status === "verified_none") {
      rejected.push({
        kind: "coverage",
        index: coverage.findIndex((item: any) =>
          String(item.ticker ?? "").toUpperCase() ===
            String((companies ?? []).find((c: any) => c.id === row.company_id)?.ticker ?? "").toUpperCase() &&
          String(item.activity_type ?? item.activityType ?? "").toLowerCase() === row.activity_type
        ),
        errors: ["verified_none conflicts with activity records in the same batch"],
        ticker: (companies ?? []).find((c: any) => c.id === row.company_id)?.ticker ?? null,
      });
      continue;
    }
    coverageByKey.set(key, {
      ...row,
      record_count: activityRow?.record_count ?? row.record_count ?? 0,
      status: activityRow ? "activity_found" : row.status,
      source_url: activityRow?.source_url ?? row.source_url,
      source_key: activityRow?.source_key ?? row.source_key,
      updated_at: new Date().toISOString(),
    });
  }

  const acceptedCoverage = [...coverageByKey.values()];
  let coverageToWrite = acceptedCoverage;
  if (acceptedCoverage.length) {
    const companyIds = [...new Set(acceptedCoverage.map((row: any) => row.company_id))];
    const { data: existingCoverage, error: existingCoverageError } = await supabase
      .from("capital_coverage_checks")
      .select("*")
      .in("company_id", companyIds);
    if (existingCoverageError) throw existingCoverageError;
    const existingByKey = new Map(
      (existingCoverage ?? []).map((row: any) => [[row.company_id,row.activity_type].join("|"), row]),
    );
    coverageToWrite = acceptedCoverage.filter((row: any) =>
      shouldReplaceCoverage(existingByKey.get([row.company_id,row.activity_type].join("|")), row)
    );
    if (coverageToWrite.length) {
      const { error } = await supabase
        .from("capital_coverage_checks")
        .upsert(coverageToWrite, { onConflict: "company_id,activity_type", ignoreDuplicates: false });
      if (error) throw error;
    }
  }

  const acceptedAnything = accepted.length + acceptedCoverage.length;
  const categories = [
    ...new Set([
      ...accepted.map((row: any) => String(row.activity_type)),
      ...acceptedCoverage.map((row: any) => String(row.activity_type)),
    ]),
  ] as string[];
  const coveredCompanyIds = new Set([
    ...accepted.map((row: any) => row.company_id),
    ...acceptedCoverage.map((row: any) => row.company_id),
  ]);
  const covered = coveredCompanyIds.size;
  const status = rejected.length ? (acceptedAnything ? "partial" : "rejected") : "accepted";

  const { error: batchError } = await supabase.from("capital_ingest_batches").insert({
    provider,
    feed_type: categories.length === 1 ? categories[0] : "mixed",
    status,
    records_received: records.length,
    records_accepted: accepted.length,
    records_rejected: rejected.filter((item) => item.kind === "record").length,
    verified_at: verifiedAt,
    source_run_id: sourceRunId,
    errors: rejected,
    metadata: {
      orchestrator_version: CAPITAL_ORCHESTRATOR_VERSION,
      coverage_received: coverage.length,
      coverage_accepted: acceptedCoverage.length,
    coverage_applied: coverageToWrite.length,
      coverage_applied: coverageToWrite.length,
      coverage_rejected: rejected.filter((item) => item.kind === "coverage").length,
    },
  });
  if (batchError) throw batchError;

  const healthStatus = rejected.length ? "degraded" : "healthy";
  const now = new Date().toISOString();
  const healthRows = [
    ...categories.map((feedType: string) =>
      providerHealthRow({
        provider,
        feedType,
        status: healthStatus,
        lastAttemptAt: now,
        lastSuccessAt: acceptedAnything ? now : null,
        lastVerifiedAt: acceptedAnything ? verifiedAt : null,
        rowsWritten: accepted.filter((row: any) => row.activity_type === feedType).length,
        companiesCovered: new Set(
          acceptedCoverage
            .filter((row: any) => row.activity_type === feedType)
            .map((row: any) => row.company_id),
        ).size,
        lastError: rejected.length ? rejected.slice(0, 5).map((x) => x.errors.join("; ")).join(" | ") : null,
        metadata: { source_run_id: sourceRunId },
      }),
    ),
    providerHealthRow({
      provider,
      feedType: "all",
      status: healthStatus,
      lastAttemptAt: now,
      lastSuccessAt: acceptedAnything ? now : null,
      lastVerifiedAt: acceptedAnything ? verifiedAt : null,
      rowsWritten: accepted.length,
      companiesCovered: covered,
      lastError: rejected.length ? rejected.slice(0, 5).map((x) => x.errors.join("; ")).join(" | ") : null,
      metadata: { source_run_id: sourceRunId, categories },
    }),
  ];

  const { error: healthError } = await supabase
    .from("capital_provider_health")
    .upsert(healthRows, { onConflict: "provider,feed_type", ignoreDuplicates: false });
  if (healthError) throw healthError;

  return Response.json({
    ok: acceptedAnything > 0,
    provider,
    verified_at: verifiedAt,
    records_received: records.length,
    records_accepted: accepted.length,
    coverage_received: coverage.length,
    coverage_accepted: acceptedCoverage.length,
    rejected_count: rejected.length,
    companies_covered: covered,
    rejected,
  }, { status: acceptedAnything ? 200 : 422 });
}
