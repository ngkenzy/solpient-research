import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { buildBaselineDraft, BASELINE_FACTORY_VERSION } from "../lib/baseline-factory.mjs";

const ticker = String(process.argv[2] ?? process.env.BASELINE_TICKER ?? "").trim().toUpperCase();
const outputFlag = process.argv.indexOf("--output");
const outputPath = outputFlag >= 0 ? process.argv[outputFlag + 1] : null;

if (!ticker) {
  console.error("Usage: node scripts/build-baseline-draft.mjs <TICKER> [--output path.json]");
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: company, error: companyError } = await supabase
  .from("companies")
  .select("id,ticker,company_name,cik,exchange,sector,industry,description")
  .eq("ticker", ticker)
  .maybeSingle();
if (companyError) throw companyError;
if (!company) throw new Error("Tracked company not found: " + ticker);

const [marketResult, fundamentalResult, filingResult, contextResult] = await Promise.all([
  supabase
    .from("market_snapshots")
    .select("*")
    .eq("symbol", ticker)
    .order("trading_date", { ascending: false })
    .limit(1)
    .maybeSingle(),
  supabase
    .from("fundamental_snapshots")
    .select("*")
    .eq("company_id", company.id)
    .order("period_end", { ascending: false })
    .limit(20),
  supabase
    .from("filing_events")
    .select("id,provider,form_type,filed_at,accepted_at,accession_number,filing_url,period_end,title")
    .eq("company_id", company.id)
    .order("filed_at", { ascending: false })
    .limit(25),
  supabase
    .from("research_context_packs")
    .select("*")
    .eq("company_id", company.id)
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle(),
]);

if (marketResult.error) throw marketResult.error;
if (fundamentalResult.error) throw fundamentalResult.error;
if (filingResult.error) throw filingResult.error;
if (contextResult.error) throw contextResult.error;

const result = buildBaselineDraft({
  company,
  market: marketResult.data,
  fundamentals: fundamentalResult.data ?? [],
  filings: filingResult.data ?? [],
});

if (contextResult.data) {
  result.payload.factory.research_context = {
    context_pack_id: contextResult.data.id,
    context_version: contextResult.data.context_version,
    as_of_date: contextResult.data.as_of_date,
    history_coverage: contextResult.data.history_coverage,
    trends: contextResult.data.trends,
    latest_metrics: contextResult.data.latest_metrics,
    peer_set: contextResult.data.peer_set,
    peer_comparison: contextResult.data.peer_comparison,
    capital_allocation: contextResult.data.capital_allocation,
    limitations: contextResult.data.limitations,
    summary: contextResult.data.summary,
  };
  result.payload.factory.review_queue.unshift(
    "Review the historical/peer context pack before qualitative scoring or valuation."
  );
}

const { data: stored, error: draftError } = await supabase
  .from("baseline_drafts")
  .upsert({
    company_id: company.id,
    generation_version: BASELINE_FACTORY_VERSION,
    generated_at: result.payload.factory.generated_at,
    source_cutoff_at: result.sourceCutoffAt,
    industry_module: result.industryModule,
    status: "generated",
    evidence_completeness_pct: result.evidenceCompletenessPct,
    standard_valid: result.validation.valid,
    standard_status: result.validation.status,
    validation_result: result.validation,
    evidence_summary: { ...result.evidenceSummary, context_pack_id: contextResult.data?.id ?? null, context_version: contextResult.data?.context_version ?? null },
    draft_payload: result.payload,
    updated_at: new Date().toISOString(),
  }, {
    onConflict: "company_id,generation_version,source_cutoff_at",
  })
  .select("id,status,evidence_completeness_pct,standard_valid,standard_status")
  .single();

if (draftError) throw draftError;

if (outputPath) {
  const absolute = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, JSON.stringify(result.payload, null, 2) + "\n", "utf8");
  console.log("Wrote draft artifact:", absolute);
}

console.log(JSON.stringify({
  ticker,
  draft_id: stored.id,
  industry_module: result.industryModule,
  evidence_completeness_pct: result.evidenceCompletenessPct,
  standard_valid: result.validation.valid,
  standard_status: result.validation.status,
  evidence_gaps: result.payload.factory.evidence_gaps.length,
  auto_publish: false,
}, null, 2));
