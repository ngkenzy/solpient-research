import { promises as fs } from "node:fs";
import path from "node:path";

export interface SolpientListEntry {
  list_rank: number;
  ticker: string;
  company_id: string | null;
  company_name: string | null;
  sector: string | null;
  industry: string | null;
  shortlist_rank: number | null;
  universe_rank: number | null;
  screen_score: number | null;
  quality_core_score: number | null;
  evidence_coverage_pct: number | null;
  pipeline_stage: string | null;
  pipeline_readiness_state: string | null;
  phase3_rank: number | null;
  decision_score: number | null;
  business_quality_score: number | null;
  investment_opportunity_score: number | null;
  evidence_confidence_score: number | null;
  readiness_state: string | null;
  readiness_tier: number | null;
  price: number | null;
  base_fair_value: number | null;
}

export interface SolpientListsArtifact {
  methodology_version: string;
  generated_at?: string | null;
  rules?: Record<string, string>;
  complete: {
    solpient_100: boolean;
    solpient_20: boolean;
    solpient_5: boolean;
  };
  counts: {
    source_candidates?: number;
    ranked_candidates?: number;
    qualified_core_candidates?: number;
    qualified_focus_candidates?: number;
    solpient_100: number;
    solpient_20: number;
    solpient_5: number;
  };
  solpient_100: SolpientListEntry[];
  solpient_20: SolpientListEntry[];
  solpient_5: SolpientListEntry[];
}

const LATEST = path.join(process.cwd(), "data", "rankings", "solpient-lists-latest.json");

export async function loadSolpientListsArtifact(): Promise<SolpientListsArtifact | null> {
  try {
    const raw = await fs.readFile(LATEST, "utf8");
    const parsed = JSON.parse(raw) as SolpientListsArtifact;
    if (!Array.isArray(parsed.solpient_100)) return null;
    parsed.solpient_20 = parsed.solpient_20 ?? [];
    parsed.solpient_5 = parsed.solpient_5 ?? [];
    parsed.counts = parsed.counts ?? {
      solpient_100: parsed.solpient_100.length,
      solpient_20: parsed.solpient_20.length,
      solpient_5: parsed.solpient_5.length,
    };
    parsed.complete = parsed.complete ?? {
      solpient_100: parsed.solpient_100.length === 100,
      solpient_20: parsed.solpient_20.length === 20,
      solpient_5: parsed.solpient_5.length === 5,
    };
    return parsed;
  } catch {
    return null;
  }
}

export function valuationGap(price: number | null, fairValue: number | null) {
  if (price == null || fairValue == null || fairValue === 0) return null;
  return ((fairValue - price) / fairValue) * 100;
}
