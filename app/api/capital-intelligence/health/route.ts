import { getAdminSupabase } from "@/lib/admin-supabase";
import { summarizeCapitalCoverageMatrix } from "@/lib/capital-intelligence-orchestrator.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const supabase = getAdminSupabase();
  if (!supabase) {
    return Response.json({ error: "Server database connection is not configured." }, { status: 503 });
  }

  const [companiesR, activityR, coverageR, healthR, runR] = await Promise.all([
    supabase.from("companies").select("id,ticker,company_name").order("ticker"),
    supabase.from("capital_activity").select("company_id,activity_type,provider,verified_at,created_at"),
    supabase.from("capital_coverage_checks").select("*"),
    supabase.from("capital_provider_health").select("*").order("updated_at", { ascending: false }),
    supabase.from("automation_runs")
      .select("status,started_at,completed_at,records_written,message,details")
      .eq("pipeline", "capital_intelligence_orchestrator")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  for (const result of [companiesR, activityR, coverageR, healthR, runR]) {
    if (result.error) {
      return Response.json({ error: result.error.message }, { status: 500 });
    }
  }

  const coverage = summarizeCapitalCoverageMatrix(
    coverageR.data ?? [],
    activityR.data ?? [],
    companiesR.data ?? [],
  );
  const anyReviewed = coverage.filter((row: any) => row.categories_reviewed > 0).length;
  const fullyReviewed = coverage.filter((row: any) => row.fully_reviewed).length;
  const fullyVerified = coverage.filter((row: any) => row.fully_verified).length;
  const unresolvedCells = coverage.reduce((sum: number, row: any) => sum + (3 - row.categories_complete), 0);

  return Response.json({
    generated_at: new Date().toISOString(),
    companies_total: coverage.length,
    companies_with_any_review: anyReviewed,
    companies_fully_reviewed: fullyReviewed,
    companies_fully_verified: fullyVerified,
    total_coverage_cells: coverage.length * 3,
    unresolved_coverage_cells: unresolvedCells,
    providers: healthR.data ?? [],
    coverage,
    latest_orchestrator_run: runR.data ?? null,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
