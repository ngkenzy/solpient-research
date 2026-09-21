export type DecisionRankingRow = {
  id: string;
  company_id: string;
  research_run_id: string | null;
  ranked_at: string;
  rank: number;
  overall_score: number | string | null;
  price: number | string | null;
  base_fair_value: number | string | null;
  methodology_version: string | null;
  business_quality_score: number | string | null;
  business_quality_coverage_pct: number | string | null;
  investment_opportunity_score: number | string | null;
  opportunity_coverage_pct: number | string | null;
  evidence_confidence_score: number | string | null;
  evidence_component_coverage_pct: number | string | null;
  decision_score: number | string | null;
  readiness_state: "building" | "research_ready" | "decision_ready" | null;
  readiness_tier: number | null;
  readiness_methodology_version: string | null;
  score_inputs: Record<string, unknown> | null;
  readiness_reasons: Record<string, unknown> | null;
};

export function readinessDisplay(value?: string | null) {
  if (value === "decision_ready") return "Decision Ready";
  if (value === "research_ready") return "Research Ready";
  if (value === "building") return "Building";
  return "Legacy";
}

export async function loadLatestDecisionRanking(supabase: any) {
  const select = [
    "id",
    "company_id",
    "research_run_id",
    "ranked_at",
    "rank",
    "overall_score",
    "price",
    "base_fair_value",
    "methodology_version",
    "business_quality_score",
    "business_quality_coverage_pct",
    "investment_opportunity_score",
    "opportunity_coverage_pct",
    "evidence_confidence_score",
    "evidence_component_coverage_pct",
    "decision_score",
    "readiness_state",
    "readiness_tier",
    "readiness_methodology_version",
    "score_inputs",
    "readiness_reasons",
  ].join(",");

  const { data, error } = await supabase
    .from("ranking_history")
    .select(select)
    .eq("methodology_version", "decision-ranking-v1")
    .order("ranked_at", { ascending: false })
    .order("rank", { ascending: true })
    .limit(500);

  // The Phase 3 branch can be previewed before the migration is applied.
  // Missing Phase 3 columns should fall back to the legacy ranking UX rather than
  // breaking public pages.
  if (error) {
    return {
      available: false,
      rankedAt: null as string | null,
      rows: [] as DecisionRankingRow[],
      error: error.message,
    };
  }

  const rows = (data ?? []) as DecisionRankingRow[];
  const rankedAt = rows[0]?.ranked_at ?? null;
  const latest = rankedAt ? rows.filter((row) => row.ranked_at === rankedAt) : [];

  return {
    available: latest.length > 0,
    rankedAt,
    rows: latest,
    error: null as string | null,
  };
}

export function decisionRankingMap(rows: DecisionRankingRow[]) {
  return new Map(rows.map((row) => [row.company_id, row]));
}
