import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildBaselineEvidencePack } from "../lib/baseline-research-contract-v1.mjs";
import { runBaselineResearchBatch } from "../lib/baseline-research-batch-v1.mjs";
import { INDUSTRY_MODULES } from "../lib/industry-modules.mjs";
import { V2_CORE_METRIC_KEYS } from "../lib/research-standard-v2.mjs";

function coverage(module) {
  return {
    engine_version: "coverage-v2",
    as_of_date: "2026-09-23",
    status: "sufficient",
    fundamentals_pct: 95,
    balance_sheet_pct: 90,
    history_pct: 100,
    market_history_pct: 90,
    industry_pct: 100,
    peer_pct: 80,
    valuation_history_pct: 80,
    capital_allocation_pct: 80,
    consensus_pct: 40,
    research_structure_pct: 0,
    decision_readiness_pct: 82,
    overall_pct: 84,
    missing_fields: [],
    coverage_details: { industry_module: module },
  };
}

function draft(module) {
  const universal = V2_CORE_METRIC_KEYS.map((metric_key, index) => ({
    module: "universal",
    metric_key,
    label: metric_key,
    status: "available",
    basis: "derived",
    value_numeric: index + 1,
    unit: "unit",
    period_end: "2026-06-30",
    source_title: "SEC filing",
    source_url: "https://www.sec.gov/example",
  }));
  const sector = (INDUSTRY_MODULES[module]?.requiredMetricKeys ?? []).map(
    (metric_key, index) => ({
      module,
      metric_key,
      label: metric_key,
      status: "available",
      basis: "reported",
      value_numeric: index + 20,
      unit: "unit",
      period_end: "2026-06-30",
      source_title: "Primary evidence",
      source_url: "https://www.sec.gov/example-sector",
    }),
  );
  return {
    id: "draft-" + module,
    draft_payload: {
      metric_observations: [...universal, ...sector],
      sources: [
        {
          source_type: "10-K",
          title: "Annual report",
          url: "https://www.sec.gov/example",
          accession_number: "0000000000-26-000001",
        },
      ],
    },
  };
}

function pack(ticker, module) {
  return buildBaselineEvidencePack({
    company: {
      id: "company-" + ticker.toLowerCase(),
      ticker,
      company_name: ticker + " Corp",
      sector: "Test",
      industry: "Test",
    },
    candidate: {
      readiness_state: "building",
      shortlist_rank: 1,
      evidence_coverage_pct: 90,
    },
    coverage: coverage(module),
    baselineDraft: draft(module),
    industryModule: module,
    latestMarket: { price: 100 },
    publishedValuation: {
      bear_value: 80,
      base_value: 125,
      bull_value: 160,
    },
    generatedAt: "2026-09-23T17:00:00.000Z",
  });
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "solpient-baseline-batch-"));
const packDir = path.join(root, "packs");
const outDir = path.join(root, "compositions");
const checkpoint = path.join(root, "checkpoint.json");
await fs.mkdir(packDir, { recursive: true });

const packs = [pack("ADBE", "software_platform"), pack("JPM", "financial_bank")];
for (const item of packs) {
  await fs.writeFile(
    path.join(packDir, item.company.ticker + ".json"),
    JSON.stringify(item, null, 2),
  );
}
await fs.writeFile(
  path.join(root, "index.json"),
  JSON.stringify({
    source_candidate_count: 100,
    source_candidate_pipeline_run_id: "run-1",
    rows: packs.map((item) => ({
      ticker: item.company.ticker,
      evidence_pack_hash: item.evidence_pack_hash,
    })),
  }),
);

const first = await runBaselineResearchBatch({
  inputDir: root,
  outputDir: outDir,
  checkpointPath: checkpoint,
});
assert.equal(first.failed_count, 0);
assert.equal(first.succeeded_count, 2);
assert.equal(first.skipped_unchanged_count, 0);
assert.equal(first.authoritative, true);

const second = await runBaselineResearchBatch({
  inputDir: root,
  outputDir: outDir,
  checkpointPath: checkpoint,
});
assert.equal(second.failed_count, 0);
assert.equal(second.succeeded_count, 0);
assert.equal(second.skipped_unchanged_count, 2);

const brokenIndex = JSON.parse(await fs.readFile(path.join(root, "index.json"), "utf8"));
brokenIndex.rows.push({ ticker: "MISSING", evidence_pack_hash: "x" });
await fs.writeFile(path.join(root, "index.json"), JSON.stringify(brokenIndex));

const third = await runBaselineResearchBatch({
  inputDir: root,
  outputDir: outDir,
  checkpointPath: checkpoint,
  force: true,
});
assert.equal(third.failed_count, 1);
assert.equal(third.authoritative, false);

await fs.rm(root, { recursive: true, force: true });
console.log("Baseline Research Batch V1 tests passed.");
