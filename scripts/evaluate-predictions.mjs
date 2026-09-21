import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const today = new Date().toISOString().slice(0, 10);

async function startRun() {
  const { data, error } = await supabase
    .from("automation_runs")
    .insert({ pipeline: "prediction_evaluation", status: "running" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function finishRun(id, status, records, message, details = {}) {
  await supabase
    .from("automation_runs")
    .update({
      status,
      records_written: records,
      message,
      details,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);
}

async function latestPrice(symbol, targetDate) {
  const { data, error } = await supabase
    .from("market_snapshots")
    .select("price,trading_date")
    .eq("symbol", symbol)
    .lte("trading_date", targetDate)
    .order("trading_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function latestFundamental(companyId, targetDate) {
  const { data, error } = await supabase
    .from("fundamental_snapshots")
    .select("period_end,revenue,free_cash_flow,eps_diluted")
    .eq("company_id", companyId)
    .lte("period_end", targetDate)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function pctChange(start, end) {
  const a = Number(start);
  const b = Number(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return ((b / a) - 1) * 100;
}

function numericError(predicted, actual) {
  const p = Number(predicted);
  const a = Number(actual);
  if (!Number.isFinite(p) || !Number.isFinite(a)) {
    return { absolute_error: null, percentage_error: null, direction_correct: null };
  }
  return {
    absolute_error: Math.abs(a - p),
    percentage_error: p === 0 ? null : Math.abs((a - p) / p) * 100,
    direction_correct: Math.sign(a) === Math.sign(p),
  };
}

const runId = await startRun();
let written = 0;
const skipped = [];
const failures = [];

try {
  const { data: outcomes, error } = await supabase
    .from("prediction_outcomes")
    .select(`
      id,
      metric_key,
      label,
      predicted_value,
      predicted_probability,
      unit,
      target_date,
      prediction_snapshots!inner(
        id,
        company_id,
        benchmark_ticker,
        price_at_prediction,
        benchmark_price_at_prediction,
        companies!inner(ticker)
      )
    `)
    .not("target_date", "is", null)
    .lte("target_date", today);

  if (error) throw error;

  for (const outcome of outcomes ?? []) {
    const { data: existing } = await supabase
      .from("realized_outcomes")
      .select("id")
      .eq("prediction_outcome_id", outcome.id)
      .limit(1)
      .maybeSingle();
    if (existing) continue;

    const snap = outcome.prediction_snapshots;
    const ticker = snap?.companies?.ticker;
    const benchmark = snap?.benchmark_ticker || "SPY";

    try {
      let actualValue = null;
      let actualText = null;
      let sourceNote = null;

      if (["price_return_pct", "relative_return_pct", "prob_outperform_benchmark"].includes(outcome.metric_key)) {
        const companyPrice = await latestPrice(ticker, outcome.target_date);
        if (!companyPrice) {
          skipped.push({ id: outcome.id, reason: "No company market snapshot by target date" });
          continue;
        }

        const companyReturn = pctChange(snap.price_at_prediction, companyPrice.price);

        if (outcome.metric_key === "price_return_pct") {
          actualValue = companyReturn;
          sourceNote = `${ticker} return through ${companyPrice.trading_date}`;
        } else {
          const benchmarkPrice = await latestPrice(benchmark, outcome.target_date);
          if (!benchmarkPrice || snap.benchmark_price_at_prediction == null) {
            skipped.push({ id: outcome.id, reason: "Benchmark start/end price unavailable" });
            continue;
          }
          const benchmarkReturn = pctChange(snap.benchmark_price_at_prediction, benchmarkPrice.price);
          if (companyReturn == null || benchmarkReturn == null) {
            skipped.push({ id: outcome.id, reason: "Return calculation unavailable" });
            continue;
          }
          const excess = companyReturn - benchmarkReturn;

          if (outcome.metric_key === "relative_return_pct") {
            actualValue = excess;
            sourceNote = `${ticker} minus ${benchmark} through ${outcome.target_date}`;
          } else {
            actualValue = excess > 0 ? 1 : 0;
            actualText = excess > 0 ? "Outperformed benchmark" : "Did not outperform benchmark";
            sourceNote = `Excess return ${excess.toFixed(2)} percentage points`;
          }
        }
      } else if (["revenue", "free_cash_flow", "eps_diluted"].includes(outcome.metric_key)) {
        const fundamental = await latestFundamental(snap.company_id, outcome.target_date);
        if (!fundamental || fundamental[outcome.metric_key] == null) {
          skipped.push({ id: outcome.id, reason: "Fundamental outcome unavailable" });
          continue;
        }
        actualValue = Number(fundamental[outcome.metric_key]);
        sourceNote = `SEC-derived period ending ${fundamental.period_end}`;
      } else {
        skipped.push({ id: outcome.id, reason: "Metric requires manual or specialized evaluation" });
        continue;
      }

      const { data: realized, error: realizedError } = await supabase
        .from("realized_outcomes")
        .insert({
          prediction_outcome_id: outcome.id,
          observed_at: new Date().toISOString(),
          actual_value: actualValue,
          actual_text: actualText,
          source_note: sourceNote,
        })
        .select("id")
        .single();
      if (realizedError) throw realizedError;

      let score = numericError(outcome.predicted_value, actualValue);
      let brier = null;

      if (outcome.metric_key === "prob_outperform_benchmark" && outcome.predicted_probability != null) {
        const p = Number(outcome.predicted_probability) / 100;
        brier = (p - Number(actualValue)) ** 2;
        score = {
          absolute_error: null,
          percentage_error: null,
          direction_correct:
            (Number(outcome.predicted_probability) >= 50 && Number(actualValue) === 1) ||
            (Number(outcome.predicted_probability) < 50 && Number(actualValue) === 0),
        };
      }

      const { error: scoreError } = await supabase.from("prediction_scores").insert({
        prediction_outcome_id: outcome.id,
        realized_outcome_id: realized.id,
        absolute_error: score.absolute_error,
        percentage_error: score.percentage_error,
        direction_correct: score.direction_correct,
        probability_brier_score: brier,
        benchmark_excess_return:
          outcome.metric_key === "relative_return_pct" ? actualValue : null,
        methodology_version: "score-v1",
        notes: sourceNote,
      });
      if (scoreError) throw scoreError;

      written += 1;
      console.log("Evaluated prediction", ticker, outcome.metric_key, outcome.target_date);
    } catch (error) {
      failures.push({ id: outcome.id, ticker, metric: outcome.metric_key, error: error.message });
      console.warn("Prediction evaluation failed", ticker, outcome.metric_key, error.message);
    }
  }

  await finishRun(
    runId,
    failures.length === 0 ? "success" : written > 0 ? "partial" : "failed",
    written,
    `Evaluated ${written} matured predictions; ${skipped.length} pending specialized data; ${failures.length} failures.`,
    { skipped, failures }
  );
} catch (error) {
  await finishRun(runId, "failed", written, error.message, { skipped, failures });
  throw error;
}
