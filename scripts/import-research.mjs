// GitHub Actions runtime: Node 22+
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { buildResearchChanges } from "../lib/research-changes.mjs";
import { validateResearchStandard } from "../lib/research-standard.mjs";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node scripts/import-research.mjs <research-json-file>");
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const absolutePath = path.resolve(filePath);
const ingestionKey = path.relative(process.cwd(), absolutePath).replaceAll("\\", "/");
const raw = await fs.readFile(absolutePath, "utf8");
const payload = JSON.parse(raw);

for (const field of ["ticker", "company_name", "research"]) {
  if (!payload[field]) {
    throw new Error(`Missing required field: ${field}`);
  }
}

const standardValidation = validateResearchStandard(payload);
if (standardValidation.applies && !standardValidation.valid) {
  throw new Error(
    "Research Standard validation failed: " +
      standardValidation.notes.join(" ")
  );
}

const legacyMigrationMode =
  process.argv.includes("--legacy-direct-publish") &&
  process.env.SOLPIENT_LEGACY_MIGRATION_MODE === "enabled";

if (!legacyMigrationMode) {
  console.log(
    `Validated legacy research file ${ingestionKey}. Direct publication is quarantined; use the reviewed V2 workbench and transactional publication RPC.`
  );
  process.exit(0);
}

console.warn(
  "LEGACY MIGRATION MODE: direct publication code is retained only for historical migration diagnostics. " +
  "The database historical-integrity guard rejects normal published inserts outside the authoritative reviewed V2 RPC."
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: existing } = await supabase
  .from("research_runs")
  .select("id")
  .eq("ingestion_key", ingestionKey)
  .maybeSingle();

if (existing) {
  console.log(`Already imported: ${ingestionKey}`);
  process.exit(0);
}

const companyPayload = {
  ticker: String(payload.ticker).toUpperCase(),
  company_name: payload.company_name,
  cik: payload.cik ?? null,
  exchange: payload.exchange ?? null,
  sector: payload.sector ?? null,
  industry: payload.industry ?? null,
  description: payload.description ?? null,
  updated_at: new Date().toISOString(),
};

const { data: company, error: companyError } = await supabase
  .from("companies")
  .upsert(companyPayload, { onConflict: "ticker" })
  .select("id,ticker")
  .single();

if (companyError) throw companyError;

const { data: latestRun, error: latestRunError } = await supabase
  .from("research_runs")
  .select("id,version,price_at_research")
  .eq("company_id", company.id)
  .order("version", { ascending: false })
  .limit(1)
  .maybeSingle();

if (latestRunError) throw latestRunError;

let previousMetrics = null;
let previousScores = null;
let previousValuation = null;
let previousThesis = [];

if (latestRun) {
  const [metricsResult, scoresResult, valuationResult, thesisResult] = await Promise.all([
    supabase.from("financial_metrics").select("*").eq("research_run_id", latestRun.id).maybeSingle(),
    supabase.from("scores").select("*").eq("research_run_id", latestRun.id).maybeSingle(),
    supabase.from("valuations").select("*").eq("research_run_id", latestRun.id).maybeSingle(),
    supabase.from("thesis_variables").select("*").eq("research_run_id", latestRun.id),
  ]);

  if (metricsResult.error) throw metricsResult.error;
  if (scoresResult.error) throw scoresResult.error;
  if (valuationResult.error) throw valuationResult.error;
  if (thesisResult.error) throw thesisResult.error;

  previousMetrics = metricsResult.data;
  previousScores = scoresResult.data;
  previousValuation = valuationResult.data;
  previousThesis = thesisResult.data ?? [];
}

const version = Number(latestRun?.version ?? 0) + 1;

const { data: run, error: runError } = await supabase
  .from("research_runs")
  .insert({
    company_id: company.id,
    previous_run_id: latestRun?.id ?? null,
    version,
    researched_at: payload.research.researched_at ?? new Date().toISOString(),
    price_at_research: payload.research.price_at_research ?? null,
    market_cap: payload.research.market_cap ?? null,
    source_period: payload.research.source_period ?? null,
    status: payload.research.status ?? "published",
    summary: payload.research.summary ?? null,
    full_report: payload.research.full_report ?? null,
    ingestion_key: ingestionKey,
    standard_version: payload.research.standard_version ?? null,
    standard_status: standardValidation.status,
    data_cutoff_at: payload.research.data_cutoff_at ?? null,
    benchmark_ticker: payload.research.benchmark_ticker ?? "SPY",
    completeness_pct: standardValidation.completenessPct,
    validation_notes: standardValidation.notes,
  })
  .select("id,version")
  .single();

if (runError) throw runError;

async function insertOne(table, value) {
  if (!value) return;
  const { error } = await supabase
    .from(table)
    .insert({ ...value, research_run_id: run.id });
  if (error) throw error;
}

async function insertMany(table, values) {
  if (!Array.isArray(values) || values.length === 0) return;
  const rows = values.map((value) => ({ ...value, research_run_id: run.id }));
  const { error } = await supabase.from(table).insert(rows);
  if (error) throw error;
}

try {
  await insertOne("financial_metrics", payload.financial_metrics);
  await insertOne("scores", payload.scores);
  await insertOne("valuations", payload.valuations);
  await insertOne("business_assessments", payload.business_assessment);
  await insertMany("metric_observations", payload.metric_observations);
  await insertMany("risk_register", payload.risk_register);
  await insertMany("expected_return_scenarios", payload.expected_return_scenarios);
  await insertMany("thesis_variables", payload.thesis_variables);
  await insertMany("sources", payload.sources);

  if (payload.ranking) {
    const { error: rankingError } = await supabase.from("ranking_history").insert({
      company_id: company.id,
      research_run_id: run.id,
      ranked_at: payload.ranking.ranked_at ?? payload.research.researched_at ?? new Date().toISOString(),
      rank: payload.ranking.rank ?? null,
      overall_score: payload.ranking.overall_score ?? payload.scores?.overall_score ?? null,
      price: payload.ranking.price ?? payload.research.price_at_research ?? null,
      base_fair_value: payload.ranking.base_fair_value ?? payload.valuations?.base_value ?? null,
    });
    if (rankingError) throw rankingError;
  }

  if (payload.prediction) {
    const predictionKey = payload.prediction.prediction_key ?? ingestionKey + "#prediction";
    const { data: predictionSnapshot, error: predictionError } = await supabase
      .from("prediction_snapshots")
      .insert({
        company_id: company.id,
        research_run_id: run.id,
        prediction_key: predictionKey,
        predicted_at: payload.prediction.predicted_at ?? payload.research.researched_at ?? new Date().toISOString(),
        model_version: payload.prediction.model_version ?? "solpient-research-v1",
        horizon_months: payload.prediction.horizon_months ?? 12,
        benchmark_ticker: payload.prediction.benchmark_ticker ?? "SPY",
        price_at_prediction: payload.prediction.price_at_prediction ?? payload.research.price_at_research ?? null,
        benchmark_price_at_prediction: payload.prediction.benchmark_price_at_prediction ?? null,
        confidence: payload.prediction.confidence ?? null,
        thesis_status: payload.prediction.thesis_status ?? "intact",
        rationale: payload.prediction.rationale ?? null,
        feature_snapshot: payload.prediction.feature_snapshot ?? {
          financial_metrics: payload.financial_metrics ?? null,
          scores: payload.scores ?? null,
          valuations: payload.valuations ?? null,
        },
        source_snapshot: payload.prediction.source_snapshot ?? payload.sources ?? [],
      })
      .select("id")
      .single();
    if (predictionError) throw predictionError;

    if (Array.isArray(payload.prediction.outcomes) && payload.prediction.outcomes.length > 0) {
      const rows = payload.prediction.outcomes.map((outcome) => ({
        prediction_snapshot_id: predictionSnapshot.id,
        metric_key: outcome.metric_key,
        label: outcome.label,
        outcome_type: outcome.outcome_type,
        predicted_value: outcome.predicted_value ?? null,
        predicted_low: outcome.predicted_low ?? null,
        predicted_high: outcome.predicted_high ?? null,
        predicted_probability: outcome.predicted_probability ?? null,
        predicted_text: outcome.predicted_text ?? null,
        unit: outcome.unit ?? null,
        target_date: outcome.target_date ?? null,
      }));
      const { error: outcomeError } = await supabase.from("prediction_outcomes").insert(rows);
      if (outcomeError) throw outcomeError;
    }
  }

  const changes = buildResearchChanges({
    companyId: company.id,
    currentRunId: run.id,
    previousRun: latestRun,
    payload,
    previousMetrics,
    previousScores,
    previousValuation,
    previousThesis,
  });
  if (changes.length > 0) {
    const { error: changesError } = await supabase.from("research_changes").insert(changes);
    if (changesError) throw changesError;
  }

  console.log(
    `Imported ${company.ticker} research version ${run.version} with ${changes.length} material changes from ${ingestionKey}`
  );
  if (standardValidation.applies) {
    console.log(
      `Research Standard v1: ${standardValidation.status}, ${standardValidation.completenessPct}% complete, ${standardValidation.metricCoveragePct}% required metric coverage`
    );
  }
} catch (error) {
  await supabase.from("research_runs").delete().eq("id", run.id);
  throw error;
}
