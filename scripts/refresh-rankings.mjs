import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalSha256, CANONICALIZATION_VERSION } from "../lib/integrity-hash.mjs";
import {
  DECISION_RANKING_METHODOLOGY_VERSION,
  READINESS_METHODOLOGY_VERSION,
  buildDecisionRanking,
  sortDecisionRankings,
  readinessLabel,
} from "../lib/decision-ranking-engine.mjs";

export const RANKING_METHODOLOGY_VERSION = DECISION_RANKING_METHODOLOGY_VERSION;

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const n = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const pct = (a, b) => {
  const x = n(a);
  const y = n(b);
  if (x == null || y == null || x === 0) return null;
  return ((y / x) - 1) * 100;
};

const gap = (price, fairValue) => {
  const p = n(price);
  const f = n(fairValue);
  if (p == null || f == null || f === 0) return null;
  return ((f - p) / f) * 100;
};

const signed = (value, digits = 1) =>
  value == null ? null : (value >= 0 ? "+" : "") + value.toFixed(digits);

function stateLabel(value) {
  return readinessLabel(value);
}

function explanationFor(current, previous, rank) {
  if (!previous) {
    return {
      explanation:
        "New Phase 3 ranking entered at #" + rank + " · " +
        stateLabel(current.decision.readiness.state) + ".",
      drivers: [
        { type: "readiness_state", value: current.decision.readiness.state },
        { type: "decision_score", value: current.decision.decisionScore },
        { type: "business_quality", value: current.decision.businessQuality.score },
        { type: "investment_opportunity", value: current.decision.investmentOpportunity.score },
        { type: "evidence_confidence", value: current.decision.evidenceConfidence.score },
      ],
      previousRank: null,
      rankDelta: null,
      scoreDelta: null,
      decisionScoreDelta: null,
      qualityDelta: null,
      opportunityDelta: null,
      confidenceDelta: null,
      priceDeltaPct: null,
      valuationGapDeltaPct: null,
      previousReadinessState: null,
      readinessChange: null,
    };
  }

  const previousGap = gap(previous.price, previous.base_fair_value);
  const currentGap = gap(current.price, current.base);
  const rankDelta = previous.rank == null ? null : previous.rank - rank;
  const decisionScoreDelta =
    n(previous.decision_score) == null || n(current.decision.decisionScore) == null
      ? null
      : n(current.decision.decisionScore) - n(previous.decision_score);
  const qualityDelta =
    n(previous.business_quality_score) == null || n(current.decision.businessQuality.score) == null
      ? null
      : n(current.decision.businessQuality.score) - n(previous.business_quality_score);
  const opportunityDelta =
    n(previous.investment_opportunity_score) == null || n(current.decision.investmentOpportunity.score) == null
      ? null
      : n(current.decision.investmentOpportunity.score) - n(previous.investment_opportunity_score);
  const confidenceDelta =
    n(previous.evidence_confidence_score) == null || n(current.decision.evidenceConfidence.score) == null
      ? null
      : n(current.decision.evidenceConfidence.score) - n(previous.evidence_confidence_score);
  const priceDeltaPct = pct(previous.price, current.price);
  const valuationGapDeltaPct =
    previousGap == null || currentGap == null ? null : currentGap - previousGap;
  const previousReadinessState = previous.readiness_state ?? null;
  const readinessChange =
    previousReadinessState && previousReadinessState !== current.decision.readiness.state
      ? previousReadinessState + "→" + current.decision.readiness.state
      : null;

  const parts = [];
  const drivers = [];

  if (readinessChange) {
    parts.push(
      "Readiness changed from " +
        stateLabel(previousReadinessState) +
        " to " +
        stateLabel(current.decision.readiness.state) +
        ".",
    );
    drivers.push({ type: "readiness_change", value: readinessChange });
  }

  if (rankDelta != null && rankDelta !== 0) {
    parts.push("Rank " + (rankDelta > 0 ? "improved " : "fell ") + Math.abs(rankDelta) + " place" + (Math.abs(rankDelta) === 1 ? "" : "s") + ".");
    drivers.push({ type: "rank_delta", value: rankDelta });
  } else {
    parts.push("Rank was unchanged.");
  }

  if (decisionScoreDelta != null && Math.abs(decisionScoreDelta) >= 0.5) {
    parts.push("Decision score changed " + signed(decisionScoreDelta) + " points.");
    drivers.push({ type: "decision_score_delta", value: decisionScoreDelta });
  }

  if (opportunityDelta != null && Math.abs(opportunityDelta) >= 2) {
    parts.push("Opportunity changed " + signed(opportunityDelta) + " points.");
    drivers.push({ type: "opportunity_delta", value: opportunityDelta });
  }

  if (confidenceDelta != null && Math.abs(confidenceDelta) >= 2) {
    parts.push("Evidence confidence changed " + signed(confidenceDelta) + " points.");
    drivers.push({ type: "evidence_confidence_delta", value: confidenceDelta });
  }

  if (priceDeltaPct != null && Math.abs(priceDeltaPct) >= 3) {
    parts.push("Price changed " + signed(priceDeltaPct) + "% since the prior ranking snapshot.");
    drivers.push({ type: "price_delta_pct", value: priceDeltaPct });
  }

  if (valuationGapDeltaPct != null && Math.abs(valuationGapDeltaPct) >= 2) {
    parts.push("The gap to base fair value changed " + signed(valuationGapDeltaPct) + " percentage points.");
    drivers.push({ type: "valuation_gap_delta_pct", value: valuationGapDeltaPct });
  }

  if (drivers.length <= 1 && rankDelta != null && rankDelta !== 0) {
    parts.push("Relative movement also reflects changes elsewhere in the ranked universe.");
  }

  return {
    explanation: parts.join(" "),
    drivers,
    previousRank: previous.rank,
    rankDelta,
    // Compatibility column now tracks the score that actually drives Phase 3 ranking.
    scoreDelta: decisionScoreDelta,
    decisionScoreDelta,
    qualityDelta,
    opportunityDelta,
    confidenceDelta,
    priceDeltaPct,
    valuationGapDeltaPct,
    previousReadinessState,
    readinessChange,
  };
}

async function startRun() {
  const { data, error } = await supabase
    .from("automation_runs")
    .insert({ pipeline: "ranking_refresh", status: "running" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function finishRun(id, status, records, message, details = {}) {
  const { error } = await supabase
    .from("automation_runs")
    .update({ status, records_written: records, message, details, completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

function latestCoverageByCompany(rows = []) {
  const out = new Map();
  for (const row of rows) {
    const existing = out.get(row.company_id);
    if (!existing) {
      out.set(row.company_id, row);
      continue;
    }
    const rowV2 = row.engine_version === "coverage-v2";
    const existingV2 = existing.engine_version === "coverage-v2";
    if (rowV2 && !existingV2) {
      out.set(row.company_id, row);
      continue;
    }
    if (rowV2 === existingV2) {
      const rowKey = String(row.as_of_date ?? "") + "|" + String(row.generated_at ?? "");
      const existingKey = String(existing.as_of_date ?? "") + "|" + String(existing.generated_at ?? "");
      if (rowKey > existingKey) out.set(row.company_id, row);
    }
  }
  return out;
}

const runId = await startRun();
let written = 0;

try {
  const marketCutoff = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [companiesResult, runsResult, marketResult, historyResult, coverageResult] = await Promise.all([
    supabase.from("companies").select("id,ticker,company_name"),
    supabase
      .from("research_runs")
      .select("id,company_id,version,researched_at,price_at_research")
      .eq("status", "published")
      .order("version", { ascending: false }),
    supabase
      .from("market_snapshots")
      .select("company_id,symbol,price,trading_date,observed_at")
      .gte("trading_date", marketCutoff)
      .order("trading_date", { ascending: false })
      .limit(10000),
    supabase
      .from("ranking_history")
      .select("id,company_id,research_run_id,ranked_at,rank,overall_score,decision_score,business_quality_score,business_quality_coverage_pct,investment_opportunity_score,opportunity_coverage_pct,evidence_confidence_score,evidence_component_coverage_pct,readiness_state,readiness_tier,price,base_fair_value,methodology_version")
      .order("ranked_at", { ascending: false })
      .limit(3000),
    supabase
      .from("data_coverage_reports")
      .select("*")
      .order("as_of_date", { ascending: false })
      .order("generated_at", { ascending: false })
      .limit(3000),
  ]);

  for (const result of [companiesResult, runsResult, marketResult, historyResult, coverageResult]) {
    if (result.error) throw result.error;
  }

  const latestRunByCompany = new Map();
  for (const run of runsResult.data ?? []) {
    if (!latestRunByCompany.has(run.company_id)) latestRunByCompany.set(run.company_id, run);
  }

  const runIds = [...latestRunByCompany.values()].map((run) => run.id);
  const [scoresResult, valuationsResult, returnsResult] = runIds.length
    ? await Promise.all([
        supabase
          .from("scores")
          .select("research_run_id,quality_score,growth_score,valuation_score,financial_strength_score,moat_score,thesis_integrity_score,overall_score")
          .in("research_run_id", runIds),
        supabase
          .from("valuations")
          .select("research_run_id,bear_value,base_value,bull_value,mos_25_price,mos_35_price,mos_50_price")
          .in("research_run_id", runIds),
        supabase
          .from("expected_return_scenarios")
          .select("research_run_id,scenario,horizon_years,expected_cagr,created_at")
          .in("research_run_id", runIds)
          .eq("scenario", "base")
          .eq("horizon_years", 5)
          .order("created_at", { ascending: false }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];

  for (const result of [scoresResult, valuationsResult, returnsResult]) {
    if (result.error) throw result.error;
  }

  const scores = new Map((scoresResult.data ?? []).map((row) => [row.research_run_id, row]));
  const valuations = new Map((valuationsResult.data ?? []).map((row) => [row.research_run_id, row]));
  const returns = new Map();
  for (const row of returnsResult.data ?? []) {
    if (!returns.has(row.research_run_id)) returns.set(row.research_run_id, row);
  }
  const coverage = latestCoverageByCompany(coverageResult.data ?? []);

  const market = new Map();
  for (const row of marketResult.data ?? []) {
    const key = row.company_id ?? row.symbol;
    if (key && !market.has(key)) market.set(key, row);
  }

  const previous = new Map();
  for (const row of historyResult.data ?? []) {
    if (!previous.has(row.company_id)) previous.set(row.company_id, row);
  }

  const ranked = [];
  for (const company of companiesResult.data ?? []) {
    const run = latestRunByCompany.get(company.id);
    if (!run) continue;

    const score = scores.get(run.id) ?? {};
    const valuation = valuations.get(run.id) ?? {};
    const marketRow = market.get(company.id) ?? market.get(company.ticker);
    const price = n(marketRow?.price) ?? n(run.price_at_research);
    const baseReturn = returns.get(run.id);
    const coverageRow = coverage.get(company.id) ?? {};

    const decision = buildDecisionRanking({
      scores: score,
      valuation,
      price,
      base5yCagr: baseReturn?.expected_cagr ?? null,
      coverage: coverageRow,
      researchedAt: run.researched_at,
    });

    ranked.push({
      ticker: company.ticker,
      company,
      run,
      score,
      valuation,
      price,
      base: n(valuation.base_value),
      base5yCagr: n(baseReturn?.expected_cagr),
      coverage: coverageRow,
      decision,
    });
  }

  ranked.sort(sortDecisionRankings);

  const currentState = ranked.map((item,index)=>({
    company_id:item.company.id,
    research_run_id:item.run.id,
    rank:index+1,
    overall_score:n(item.score.overall_score),
    price:item.price,
    base_fair_value:item.base,
    business_quality_score:item.decision.businessQuality.score,
    business_quality_coverage_pct:item.decision.businessQuality.coveragePct,
    investment_opportunity_score:item.decision.investmentOpportunity.score,
    opportunity_coverage_pct:item.decision.investmentOpportunity.coveragePct,
    evidence_confidence_score:item.decision.evidenceConfidence.score,
    evidence_component_coverage_pct:item.decision.evidenceConfidence.coveragePct,
    decision_score:item.decision.decisionScore,
    readiness_state:item.decision.readiness.state,
    readiness_tier:item.decision.readiness.tier,
  }));
  const currentFingerprint = canonicalSha256(currentState);

  const phase3History=(historyResult.data??[]).filter((row)=>row.methodology_version===RANKING_METHODOLOGY_VERSION);
  const previousRankedAt=phase3History[0]?.ranked_at??null;
  const previousState=previousRankedAt
    ? phase3History
        .filter((row)=>row.ranked_at===previousRankedAt)
        .sort((a,b)=>Number(a.rank)-Number(b.rank))
        .map((row)=>({
          company_id:row.company_id,
          research_run_id:row.research_run_id,
          rank:Number(row.rank),
          overall_score:n(row.overall_score),
          price:n(row.price),
          base_fair_value:n(row.base_fair_value),
          business_quality_score:n(row.business_quality_score),
          business_quality_coverage_pct:n(row.business_quality_coverage_pct),
          investment_opportunity_score:n(row.investment_opportunity_score),
          opportunity_coverage_pct:n(row.opportunity_coverage_pct),
          evidence_confidence_score:n(row.evidence_confidence_score),
          evidence_component_coverage_pct:n(row.evidence_component_coverage_pct),
          decision_score:n(row.decision_score),
          readiness_state:row.readiness_state,
          readiness_tier:n(row.readiness_tier),
        }))
    : [];
  const previousFingerprint=previousState.length?canonicalSha256(previousState):null;

  if(previousFingerprint&&previousFingerprint===currentFingerprint){
    await finishRun(runId,"success",0,"Phase 3 ranking unchanged; no duplicate snapshot written.",{
      methodology_version:RANKING_METHODOLOGY_VERSION,
      readiness_methodology_version:READINESS_METHODOLOGY_VERSION,
      duplicate_of_ranked_at:previousRankedAt,
      state_fingerprint:currentFingerprint,
      companies:ranked.length,
    });
    console.log(JSON.stringify({
      skipped:true,
      reason:"ranking_state_unchanged",
      duplicate_of_ranked_at:previousRankedAt,
      state_fingerprint:currentFingerprint,
      companies:ranked.length,
    },null,2));
    process.exit(0);
  }

  const rankedAt = new Date().toISOString();

  for (let index = 0; index < ranked.length; index += 1) {
    const current = ranked[index];
    const rank = index + 1;

    const scoreInputs = {
      methodology_version: current.decision.methodologyVersion,
      readiness_methodology_version: current.decision.readinessMethodologyVersion,
      raw_inputs: current.decision.inputs,
      business_quality: {
        score: current.decision.businessQuality.score,
        coverage_pct: current.decision.businessQuality.coveragePct,
        missing: current.decision.businessQuality.missing,
        contributions: current.decision.businessQuality.contributions,
      },
      investment_opportunity: {
        score: current.decision.investmentOpportunity.score,
        coverage_pct: current.decision.investmentOpportunity.coveragePct,
        missing: current.decision.investmentOpportunity.missing,
        contributions: current.decision.investmentOpportunity.contributions,
      },
      evidence_confidence: {
        score: current.decision.evidenceConfidence.score,
        evidence_score: current.decision.evidenceConfidence.evidenceScore,
        freshness_score: current.decision.evidenceConfidence.freshnessScore,
        component_coverage_pct: current.decision.evidenceConfidence.coveragePct,
        missing: current.decision.evidenceConfidence.missing,
        contributions: current.decision.evidenceConfidence.contributions,
      },
    };

    const readinessReasons = {
      state: current.decision.readiness.state,
      blockers: current.decision.readiness.blockers,
      warnings: current.decision.readiness.warnings,
      decision_ready_blockers: current.decision.readiness.decisionReadyBlockers,
    };

    const rankingSnapshot = {
      company_id: current.company.id,
      research_run_id: current.run.id,
      ranked_at: rankedAt,
      rank,
      // Retained legacy research score. It no longer determines Phase 3 rank order.
      overall_score: n(current.score.overall_score),
      price: current.price,
      base_fair_value: current.base,
      methodology_version: RANKING_METHODOLOGY_VERSION,
      integrity_version: "historical-integrity-v1",
      hash_algorithm: "sha256",
      canonicalization_version: CANONICALIZATION_VERSION,
      business_quality_score: current.decision.businessQuality.score,
      business_quality_coverage_pct: current.decision.businessQuality.coveragePct,
      investment_opportunity_score: current.decision.investmentOpportunity.score,
      opportunity_coverage_pct: current.decision.investmentOpportunity.coveragePct,
      evidence_confidence_score: current.decision.evidenceConfidence.score,
      evidence_component_coverage_pct: current.decision.evidenceConfidence.coveragePct,
      decision_score: current.decision.decisionScore,
      readiness_state: current.decision.readiness.state,
      readiness_tier: current.decision.readiness.tier,
      readiness_methodology_version: READINESS_METHODOLOGY_VERSION,
      score_inputs: scoreInputs,
      readiness_reasons: readinessReasons,
    };
    const snapshot_hash = canonicalSha256(rankingSnapshot);

    const { data: history, error: historyError } = await supabase
      .from("ranking_history")
      .insert({ ...rankingSnapshot, snapshot_hash })
      .select("id")
      .single();
    if (historyError) throw historyError;

    const why = explanationFor(current, previous.get(current.company.id), rank);
    const { error: explanationError } = await supabase
      .from("ranking_explanations")
      .insert({
        company_id: current.company.id,
        ranking_history_id: history.id,
        previous_rank: why.previousRank,
        rank_delta: why.rankDelta,
        score_delta: why.scoreDelta,
        decision_score_delta: why.decisionScoreDelta,
        business_quality_delta: why.qualityDelta,
        opportunity_delta: why.opportunityDelta,
        evidence_confidence_delta: why.confidenceDelta,
        previous_readiness_state: why.previousReadinessState,
        readiness_change: why.readinessChange,
        price_delta_pct: why.priceDeltaPct,
        valuation_gap_delta_pct: why.valuationGapDeltaPct,
        explanation: why.explanation,
        drivers: why.drivers,
      });
    if (explanationError) throw explanationError;

    written += 1;
  }

  const counts = ranked.reduce(
    (acc, item) => {
      acc[item.decision.readiness.state] = (acc[item.decision.readiness.state] ?? 0) + 1;
      return acc;
    },
    {},
  );

  await finishRun(runId, "success", written, "Refreshed " + written + " Phase 3 decision rankings.", {
    ranked_at: rankedAt,
    companies: ranked.length,
    methodology_version: RANKING_METHODOLOGY_VERSION,
    readiness_methodology_version: READINESS_METHODOLOGY_VERSION,
    readiness_counts: counts,
    state_fingerprint: currentFingerprint,
  });
  console.log(JSON.stringify({
    ranked_at: rankedAt,
    methodology_version: RANKING_METHODOLOGY_VERSION,
    readiness_counts: counts,
    ranking: ranked.map((item,index)=>({
      rank:index+1,
      ticker:item.ticker,
      readiness:stateLabel(item.decision.readiness.state),
      decision_score:item.decision.decisionScore,
      business_quality:item.decision.businessQuality.score,
      investment_opportunity:item.decision.investmentOpportunity.score,
      evidence_confidence:item.decision.evidenceConfidence.score,
    })),
  },null,2));
} catch (error) {
  await finishRun(runId, "failed", written, error.message, {
    methodology_version: RANKING_METHODOLOGY_VERSION,
  });
  throw error;
}
