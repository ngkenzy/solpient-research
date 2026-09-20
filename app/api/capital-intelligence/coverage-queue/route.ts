import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "@/lib/admin-supabase";

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

export async function GET(request: Request) {
  if (!secretMatches(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminSupabase();
  if (!supabase) {
    return Response.json({ error: "Server database connection is not configured." }, { status: 503 });
  }

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 66)));
  const statuses = (url.searchParams.get("status") ?? "pending,partial,unavailable")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const { data, error } = await supabase
    .from("capital_coverage_checks")
    .select("id,company_id,activity_type,status,provider,window_start,window_end,verified_at,record_count,source_url,notes,updated_at,companies!inner(ticker,company_name)")
    .in("status", statuses)
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const queue = (data ?? []).map((row: any) => ({
    id: row.id,
    ticker: row.companies?.ticker,
    company_name: row.companies?.company_name,
    activity_type: row.activity_type,
    status: row.status,
    previous_provider: row.provider,
    window_start: row.window_start,
    window_end: row.window_end,
    verified_at: row.verified_at,
    record_count: row.record_count,
    source_url: row.source_url,
    notes: row.notes,
  }));

  return Response.json({
    generated_at: new Date().toISOString(),
    queue_size: queue.length,
    statuses,
    queue,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
