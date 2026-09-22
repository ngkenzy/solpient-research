import "server-only";

import { dbQuery } from "@/lib/db";
import type { DecisionRankingRow } from "@/lib/decision-ranking-read-model";

export async function loadLatestDecisionRankingFromPostgres() {
  try {
    const rows = await dbQuery<DecisionRankingRow & Record<string, unknown>>(
      `
        select
          id,
          company_id,
          research_run_id,
          ranked_at,
          rank,
          overall_score,
          price,
          base_fair_value,
          methodology_version,
          business_quality_score,
          business_quality_coverage_pct,
          investment_opportunity_score,
          opportunity_coverage_pct,
          evidence_confidence_score,
          evidence_component_coverage_pct,
          decision_score,
          readiness_state,
          readiness_tier,
          readiness_methodology_version,
          score_inputs,
          readiness_reasons
        from public.ranking_history
        where methodology_version = 'decision-ranking-v1'
          and ranked_at = (
            select max(ranked_at)
            from public.ranking_history
            where methodology_version = 'decision-ranking-v1'
          )
        order by rank asc
        limit 500
      `,
    );

    const rankedAt = rows[0]?.ranked_at ?? null;
    return {
      available: rows.length > 0,
      rankedAt,
      rows: rows as DecisionRankingRow[],
      error: null as string | null,
    };
  } catch (error) {
    return {
      available: false,
      rankedAt: null as string | null,
      rows: [] as DecisionRankingRow[],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
