// GitHub Actions runtime: Node 22+
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

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

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function percentDelta(oldValue, newValue) {
  const oldN = asNumber(oldValue);
  const newN = asNumber(newValue);
  if (oldN == null || newN == null || oldN === 0) return null;
  return ((newN - oldN) / Math.abs(oldN)) * 100;
}

function addNumericChange(changes, {
  category,
  metricKey,
  label,
  oldValue,
  newValue,
  absThreshold = 0,
  relativeThreshold = 0,
  materiality = "material",
  suffix = "",
}) {
  const oldN = asNumber(oldValue);
  const newN = asNumber(newValue);

  if (oldN == null || newN == null) return;

  const delta = newN - oldN;
  const relative = percentDelta(oldN, newN);
  const isMaterial =
    Math.abs(delta) >= absThreshold ||
    (relative != null && Math.abs(relative) >= relativeThreshold);

  if (!isMaterial) return;

  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "unchanged";
  const signedDelta = `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}${suffix}`;
  const relText = relative == null ? "" : ` (${relative >= 0 ? "+" : ""}${relative.toFixed(1)}%)`;

  changes.push({
    company_id: company.id,
    current_run_id: run.id,
    previous_run_id: latestRun?.id ?? null,
    category,
    change_type: "metric",
    metric_key: metricKey,
    label,
    old_value: oldN,
    new_value: newN,
    delta_value: delta,
    delta_percent: relative,
    direction,
    materiality,
    summary: `${label} moved ${direction} by ${signedDelta}${relText}.`,
  });
}

function buildChanges() {
  if (!latestRun) return [];

  const changes = [];

  addNumericChange(changes, {
    category: "market",
    metricKey: "price_at_research",
    label: "Price at research",
    oldValue: latestRun.price_at_research,
    newValue: payload.research.price_at_research,
    relativeThreshold: 3,
  });

  const metricRules = [
    ["revenue_growth_1y", "Revenue growth", 1, 0, "pp"],
    ["revenue_cagr_5y", "5Y revenue CAGR", 1, 0, "pp"],
    ["gross_margin", "Gross margin", 1, 0, "pp"],
    ["operating_margin", "Operating margin", 1, 0, "pp"],
    ["net_margin", "Net margin", 1, 0, "pp"],
    ["fcf_margin", "FCF margin", 1, 0, "pp"],
    ["roe", "ROE", 1, 0, "pp"],
    ["roic", "ROIC", 1, 0, "pp"],
    ["roa", "ROA", 1, 0, "pp"],
    ["eps_growth_1y", "EPS growth", 2, 0, "pp"],
    ["current_ratio", "Current ratio", 0.1, 0, ""],
    ["quick_ratio", "Quick ratio", 0.1, 0, ""],
    ["debt_to_equity", "Debt / equity", 0.1, 0, ""],
    ["pe", "P/E", 1, 0, "x"],
    ["forward_pe", "Forward P/E", 1, 0, "x"],
    ["peg", "PEG", 0.2, 0, ""],
    ["revenue", "Revenue", 0, 5, ""],
    ["free_cash_flow", "Free cash flow", 0, 5, ""],
    ["cash", "Cash", 0, 10, ""],
    ["total_debt", "Total debt", 0, 10, ""],
  ];

  for (const [key, label, absThreshold, relativeThreshold, suffix] of metricRules) {
    addNumericChange(changes, {
      category: "financial",
      metricKey: key,
      label,
      oldValue: previousMetrics?.[key],
      newValue: payload.financial_metrics?.[key],
      absThreshold,
      relativeThreshold,
      suffix,
    });
  }

  const scoreRules = [
    ["overall_score", "Overall score"],
    ["quality_score", "Quality score"],
    ["growth_score", "Growth score"],
    ["valuation_score", "Valuation score"],
    ["financial_strength_score", "Financial strength score"],
    ["moat_score", "Moat score"],
    ["thesis_integrity_score", "Thesis integrity score"],
  ];

  for (const [key, label] of scoreRules) {
    addNumericChange(changes, {
      category: "score",
      metricKey: key,
      label,
      oldValue: previousScores?.[key],
      newValue: payload.scores?.[key],
      absThreshold: 3,
      suffix: " pts",
    });
  }

  const valuationRules = [
    ["bear_value", "Bear fair value"],
    ["base_value", "Base fair value"],
    ["bull_value", "Bull fair value"],
    ["dcf_value", "DCF value"],
    ["owner_earnings_value", "Owner earnings value"],
    ["earnings_multiple_value", "Earnings multiple value"],
  ];

  for (const [key, label] of valuationRules) {
    addNumericChange(changes, {
      category: "valuation",
      metricKey: key,
      label,
      oldValue: previousValuation?.[key],
      newValue: payload.valuations?.[key],
      relativeThreshold: 5,
    });
  }

  const previousThesisMap = new Map(
    previousThesis.map((item) => [String(item.variable_name).trim().toLowerCase(), item])
  );
  const currentThesis = Array.isArray(payload.thesis_variables) ? payload.thesis_variables : [];
  const currentNames = new Set();

  for (const item of currentThesis) {
    const normalizedName = String(item.variable_name).trim().toLowerCase();
    currentNames.add(normalizedName);
    const previous = previousThesisMap.get(normalizedName);

    if (!previous) {
      changes.push({
        company_id: company.id,
        current_run_id: run.id,
        previous_run_id: latestRun.id,
        category: "thesis",
        change_type: "new",
        metric_key: `thesis:${normalizedName}`,
        label: item.variable_name,
        old_text: null,
        new_text: item.observed_value ?? item.expectation ?? null,
        direction: item.status ?? "new",
        materiality: "material",
        summary: `New thesis condition added: ${item.variable_name}.`,
      });
      continue;
    }

    const statusChanged = (previous.status ?? "unknown") !== (item.status ?? "unknown");
    const evidenceChanged =
      String(previous.observed_value ?? "").trim() !== String(item.observed_value ?? "").trim();

    if (statusChanged || evidenceChanged) {
      const statusText = statusChanged
        ? ` status changed from ${previous.status ?? "unknown"} to ${item.status ?? "unknown"}.`
        : " evidence was updated.";

      changes.push({
        company_id: company.id,
        current_run_id: run.id,
        previous_run_id: latestRun.id,
        category: "thesis",
        change_type: statusChanged ? "status" : "evidence",
        metric_key: `thesis:${normalizedName}`,
        label: item.variable_name,
        old_text: previous.observed_value ?? previous.expectation ?? null,
        new_text: item.observed_value ?? item.expectation ?? null,
        direction: item.status ?? "unknown",
        materiality: statusChanged ? "material" : "notable",
        summary: `${item.variable_name}:${statusText}`,
      });
    }
  }

  for (const previous of previousThesis) {
    const normalizedName = String(previous.variable_name).trim().toLowerCase();
    if (currentNames.has(normalizedName)) continue;

    changes.push({
      company_id: company.id,
      current_run_id: run.id,
      previous_run_id: latestRun.id,
      category: "thesis",
      change_type: "removed",
      metric_key: `thesis:${normalizedName}`,
      label: previous.variable_name,
      old_text: previous.observed_value ?? previous.expectation ?? null,
      new_text: null,
      direction: "removed",
      materiality: "material",
      summary: `Thesis condition removed: ${previous.variable_name}.`,
    });
  }

  return changes;
}

try {
  await insertOne("financial_metrics", payload.financial_metrics);
  await insertOne("scores", payload.scores);
  await insertOne("valuations", payload.valuations);
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

  const changes = buildChanges();
  if (changes.length > 0) {
    const { error: changesError } = await supabase.from("research_changes").insert(changes);
    if (changesError) throw changesError;
  }

  console.log(
    `Imported ${company.ticker} research version ${run.version} with ${changes.length} material changes from ${ingestionKey}`
  );
} catch (error) {
  await supabase.from("research_runs").delete().eq("id", run.id);
  throw error;
}
