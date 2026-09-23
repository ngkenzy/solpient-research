export const SOLPIENT_LIST_METHODOLOGY_VERSION = "solpient-lists-v1";

export const SOLPIENT_LIST_LIMITS = Object.freeze({
  universe: 100,
  core: 20,
  focus: 5,
});

const QUALIFIED_CORE_STATES = new Set(["decision_ready", "research_ready"]);
const QUALIFIED_FOCUS_STATES = new Set(["decision_ready"]);

const asNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const upper = (value) => String(value ?? "").trim().toUpperCase();

function sourceOrder(row) {
  return (
    asNumber(row?.shortlist_rank) ??
    asNumber(row?.shortlistRank) ??
    asNumber(row?.universe_rank) ??
    asNumber(row?.universeRank) ??
    Number.MAX_SAFE_INTEGER
  );
}

function rankingOrder(row) {
  return asNumber(row?.rank) ?? Number.MAX_SAFE_INTEGER;
}

function normalizedCandidate(row) {
  return {
    ticker: upper(row?.ticker),
    company_id: row?.company_id ?? row?.companyId ?? null,
    company_name: row?.company_name ?? row?.companyName ?? null,
    sector: row?.sector ?? null,
    industry: row?.industry ?? null,
    shortlist_rank: asNumber(row?.shortlist_rank ?? row?.shortlistRank),
    universe_rank: asNumber(row?.universe_rank ?? row?.universeRank),
    screen_score: asNumber(row?.screen_score ?? row?.screenScore),
    quality_core_score: asNumber(row?.quality_core_score ?? row?.qualityCoreScore),
    evidence_coverage_pct: asNumber(row?.evidence_coverage_pct ?? row?.evidenceCoveragePct),
    pipeline_stage: row?.stage ?? row?.pipeline_stage ?? null,
    pipeline_readiness_state: row?.readiness_state ?? row?.pipeline_readiness_state ?? null,
    pipeline_decision_score: asNumber(row?.pipeline_decision_score ?? row?.decision_score),
    pipeline_evidence_confidence: asNumber(row?.pipeline_evidence_confidence ?? row?.evidence_confidence),
  };
}

function normalizedRanking(row) {
  return {
    company_id: row?.company_id ?? row?.companyId ?? null,
    ticker: upper(row?.ticker),
    rank: asNumber(row?.rank),
    decision_score: asNumber(row?.decision_score ?? row?.decisionScore),
    business_quality_score: asNumber(row?.business_quality_score ?? row?.businessQualityScore),
    investment_opportunity_score: asNumber(row?.investment_opportunity_score ?? row?.investmentOpportunityScore),
    evidence_confidence_score: asNumber(row?.evidence_confidence_score ?? row?.evidenceConfidenceScore),
    readiness_state: row?.readiness_state ?? row?.readinessState ?? null,
    readiness_tier: asNumber(row?.readiness_tier ?? row?.readinessTier),
    price: asNumber(row?.price),
    base_fair_value: asNumber(row?.base_fair_value ?? row?.baseFairValue),
    snapshot_hash: row?.snapshot_hash ?? row?.snapshotHash ?? null,
  };
}

function uniqueCandidates(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (!row.ticker) throw new Error("Solpient list candidate is missing ticker.");
    if (seen.has(row.ticker)) {
      throw new Error("Duplicate Solpient candidate ticker: " + row.ticker);
    }
    seen.add(row.ticker);
  }
}

function rankingMaps(rankings) {
  const byCompany = new Map();
  const byTicker = new Map();
  for (const row of rankings) {
    if (row.company_id && !byCompany.has(row.company_id)) byCompany.set(row.company_id, row);
    if (row.ticker && !byTicker.has(row.ticker)) byTicker.set(row.ticker, row);
  }
  return { byCompany, byTicker };
}

function rankingFor(candidate, maps) {
  if (candidate.company_id && maps.byCompany.has(candidate.company_id)) {
    return maps.byCompany.get(candidate.company_id);
  }
  if (candidate.ticker && maps.byTicker.has(candidate.ticker)) {
    return maps.byTicker.get(candidate.ticker);
  }
  return null;
}

function enrichedEntry(candidate, ranking, listRank) {
  return {
    list_rank: listRank,
    ticker: candidate.ticker,
    company_id: candidate.company_id,
    company_name: candidate.company_name,
    sector: candidate.sector,
    industry: candidate.industry,
    shortlist_rank: candidate.shortlist_rank,
    universe_rank: candidate.universe_rank,
    screen_score: candidate.screen_score,
    quality_core_score: candidate.quality_core_score,
    evidence_coverage_pct: candidate.evidence_coverage_pct,
    pipeline_stage: candidate.pipeline_stage,
    pipeline_readiness_state: candidate.pipeline_readiness_state,
    phase3_rank: ranking?.rank ?? null,
    decision_score: ranking?.decision_score ?? candidate.pipeline_decision_score,
    business_quality_score: ranking?.business_quality_score ?? null,
    investment_opportunity_score: ranking?.investment_opportunity_score ?? null,
    evidence_confidence_score:
      ranking?.evidence_confidence_score ?? candidate.pipeline_evidence_confidence,
    readiness_state: ranking?.readiness_state ?? candidate.pipeline_readiness_state,
    readiness_tier: ranking?.readiness_tier ?? null,
    price: ranking?.price ?? null,
    base_fair_value: ranking?.base_fair_value ?? null,
  };
}

export function deriveSolpientLists({
  candidates = [],
  rankings = [],
  expectedCandidateCount = SOLPIENT_LIST_LIMITS.universe,
} = {}) {
  if (!Array.isArray(candidates)) throw new Error("candidates must be an array.");
  if (!Array.isArray(rankings)) throw new Error("rankings must be an array.");

  const normalizedCandidates = candidates.map(normalizedCandidate);
  uniqueCandidates(normalizedCandidates);
  normalizedCandidates.sort((a, b) => sourceOrder(a) - sourceOrder(b) || a.ticker.localeCompare(b.ticker));

  const normalizedRankings = rankings.map(normalizedRanking);
  const maps = rankingMaps(normalizedRankings);

  const universe = normalizedCandidates
    .slice(0, SOLPIENT_LIST_LIMITS.universe)
    .map((candidate, index) => enrichedEntry(candidate, rankingFor(candidate, maps), index + 1));

  const rankedCandidates = universe
    .filter((entry) => entry.phase3_rank != null && QUALIFIED_CORE_STATES.has(entry.readiness_state))
    .sort((a, b) => rankingOrder(a) - rankingOrder(b) || a.ticker.localeCompare(b.ticker));

  const core = rankedCandidates
    .slice(0, SOLPIENT_LIST_LIMITS.core)
    .map((entry, index) => ({ ...entry, list_rank: index + 1 }));

  const focus = rankedCandidates
    .filter((entry) => QUALIFIED_FOCUS_STATES.has(entry.readiness_state))
    .slice(0, SOLPIENT_LIST_LIMITS.focus)
    .map((entry, index) => ({ ...entry, list_rank: index + 1 }));

  const expected = expectedCandidateCount == null ? null : Number(expectedCandidateCount);
  const universeComplete =
    expected == null
      ? universe.length === SOLPIENT_LIST_LIMITS.universe
      : normalizedCandidates.length === expected &&
        expected === SOLPIENT_LIST_LIMITS.universe &&
        universe.length === SOLPIENT_LIST_LIMITS.universe;

  return {
    methodology_version: SOLPIENT_LIST_METHODOLOGY_VERSION,
    rules: {
      universe: "Latest complete immutable Research Candidate Pipeline shortlist, ordered by shortlist rank.",
      core: "Top Phase 3 ranked Solpient 100 members that are Research Ready or Decision Ready.",
      focus: "Top Phase 3 ranked Solpient 100 members that are Decision Ready.",
      fail_closed: "Core and Focus can contain fewer than 20/5 names rather than padding with evidence-incomplete companies.",
    },
    complete: {
      solpient_100: universeComplete,
      solpient_20: core.length === SOLPIENT_LIST_LIMITS.core,
      solpient_5: focus.length === SOLPIENT_LIST_LIMITS.focus,
    },
    counts: {
      source_candidates: normalizedCandidates.length,
      ranked_candidates: universe.filter((entry) => entry.phase3_rank != null).length,
      qualified_core_candidates: rankedCandidates.length,
      qualified_focus_candidates: rankedCandidates.filter((entry) =>
        QUALIFIED_FOCUS_STATES.has(entry.readiness_state),
      ).length,
      solpient_100: universe.length,
      solpient_20: core.length,
      solpient_5: focus.length,
    },
    solpient_100: universe,
    solpient_20: core,
    solpient_5: focus,
  };
}
