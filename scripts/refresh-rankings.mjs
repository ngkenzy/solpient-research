import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalSha256, CANONICALIZATION_VERSION } from "../lib/integrity-hash.mjs";

export const RANKING_METHODOLOGY_VERSION = "ranking-v1-overall-thesis-valuation";

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

function explanationFor(current, previous, rank) {
  if (!previous) {
    return {
      explanation: "New published research entered the ranking at #" + rank + ".",
      drivers: [{ type: "new_research", value: rank }],
      previousRank: null,
      rankDelta: null,
      scoreDelta: null,
      priceDeltaPct: null,
      valuationGapDeltaPct: null,
    };
  }

  const previousGap = gap(previous.price, previous.base_fair_value);
  const currentGap = gap(current.price, current.base);
  const rankDelta = previous.rank == null ? null : previous.rank - rank;
  const scoreDelta = n(previous.overall_score) == null || n(current.overall) == null
    ? null
    : n(current.overall) - n(previous.overall_score);
  const priceDeltaPct = pct(previous.price, current.price);
  const valuationGapDeltaPct =
    previousGap == null || currentGap == null ? null : currentGap - previousGap;

  const parts = [];
  const drivers = [];

  if (rankDelta != null && rankDelta !== 0) {
    parts.push("Rank " + (rankDelta > 0 ? "improved " : "fell ") + Math.abs(rankDelta) + " place" + (Math.abs(rankDelta) === 1 ? "" : "s") + ".");
    drivers.push({ type: "rank_delta", value: rankDelta });
  } else {
    parts.push("Rank was unchanged.");
  }

  if (scoreDelta != null && Math.abs(scoreDelta) >= 0.5) {
    parts.push("Overall score changed " + signed(scoreDelta) + " points.");
    drivers.push({ type: "score_delta", value: scoreDelta });
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
    parts.push("The relative position also reflects changes elsewhere in the ranked universe.");
  }

  return {
    explanation: parts.join(" "),
    drivers,
    previousRank: previous.rank,
    rankDelta,
    scoreDelta,
    priceDeltaPct,
    valuationGapDeltaPct,
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

const runId = await startRun();
let written = 0;

try {
  const [companiesResult, runsResult, marketResult, historyResult] = await Promise.all([
    supabase.from("companies").select("id,ticker,company_name"),
    supabase
      .from("research_runs")
      .select("id,company_id,version,researched_at,price_at_research")
      .eq("status", "published")
      .order("version", { ascending: false }),
    supabase
      .from("market_snapshots")
      .select("symbol,price,trading_date")
      .order("trading_date", { ascending: false }),
    supabase
      .from("ranking_history")
      .select("id,company_id,ranked_at,rank,overall_score,price,base_fair_value")
      .order("ranked_at", { ascending: false })
      .limit(2000),
  ]);

  for (const result of [companiesResult, runsResult, marketResult, historyResult]) {
    if (result.error) throw result.error;
  }

  const latestRunByCompany = new Map();
  for (const run of runsResult.data ?? []) {
    if (!latestRunByCompany.has(run.company_id)) latestRunByCompany.set(run.company_id, run);
  }

  const runIds = [...latestRunByCompany.values()].map((run) => run.id);
  const [scoresResult, valuationsResult] = runIds.length
    ? await Promise.all([
        supabase
          .from("scores")
          .select("research_run_id,overall_score,thesis_integrity_score,valuation_score")
          .in("research_run_id", runIds),
        supabase
          .from("valuations")
          .select("research_run_id,base_value")
          .in("research_run_id", runIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  if (scoresResult.error) throw scoresResult.error;
  if (valuationsResult.error) throw valuationsResult.error;

  const scores = new Map((scoresResult.data ?? []).map((row) => [row.research_run_id, row]));
  const valuations = new Map((valuationsResult.data ?? []).map((row) => [row.research_run_id, row]));

  const market = new Map();
  for (const row of marketResult.data ?? []) {
    if (!market.has(row.symbol)) market.set(row.symbol, row);
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
    const marketRow = market.get(company.ticker);
    ranked.push({
      company,
      run,
      overall: n(score.overall_score),
      thesis: n(score.thesis_integrity_score),
      valuationScore: n(score.valuation_score),
      price: n(marketRow?.price) ?? n(run.price_at_research),
      base: n(valuation.base_value),
    });
  }

  ranked.sort((a, b) => {
    const overall = (b.overall ?? -1) - (a.overall ?? -1);
    if (overall !== 0) return overall;
    const thesis = (b.thesis ?? -1) - (a.thesis ?? -1);
    if (thesis !== 0) return thesis;
    return (b.valuationScore ?? -1) - (a.valuationScore ?? -1);
  });

  const rankedAt = new Date().toISOString();

  for (let index = 0; index < ranked.length; index += 1) {
    const current = ranked[index];
    const rank = index + 1;
    const rankingSnapshot = {
      company_id: current.company.id,
      research_run_id: current.run.id,
      ranked_at: rankedAt,
      rank,
      overall_score: current.overall,
      price: current.price,
      base_fair_value: current.base,
      methodology_version: RANKING_METHODOLOGY_VERSION,
      integrity_version: "historical-integrity-v1",
      hash_algorithm: "sha256",
      canonicalization_version: CANONICALIZATION_VERSION,
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
        price_delta_pct: why.priceDeltaPct,
        valuation_gap_delta_pct: why.valuationGapDeltaPct,
        explanation: why.explanation,
        drivers: why.drivers,
      });
    if (explanationError) throw explanationError;

    written += 1;
  }

  await finishRun(runId, "success", written, "Refreshed " + written + " ranked research records.", {
    ranked_at: rankedAt,
    companies: ranked.length,
  });
  console.log("Refreshed rankings:", written);
} catch (error) {
  await finishRun(runId, "failed", written, error.message);
  throw error;
}
