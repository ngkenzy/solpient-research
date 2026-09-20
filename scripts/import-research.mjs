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
  .select("version")
  .eq("company_id", company.id)
  .order("version", { ascending: false })
  .limit(1)
  .maybeSingle();

if (latestRunError) throw latestRunError;

const version = Number(latestRun?.version ?? 0) + 1;

const { data: run, error: runError } = await supabase
  .from("research_runs")
  .insert({
    company_id: company.id,
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
} catch (error) {
  await supabase.from("research_runs").delete().eq("id", run.id);
  throw error;
}

console.log(
  `Imported ${company.ticker} research version ${run.version} from ${ingestionKey}`
);
