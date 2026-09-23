import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  pgMaybeOne,
  pgQuery,
  closePostgresPool,
  postgresConfigured,
} from "../lib/postgres-node.mjs";
import { buildBaselineEvidencePack } from "../lib/baseline-research-contract-v1.mjs";

function arg(name, fallback = null) {
  const prefix = "--" + name + "=";
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const outputDir = path.resolve(
  arg("output-dir", process.env.BASELINE_RESEARCH_PACK_DIR ?? "data/baseline-research"),
);
const tickerFilter = new Set(
  String(arg("tickers", ""))
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean),
);
const limitArg = Number(arg("limit", "0"));
const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.floor(limitArg) : null;

if (!postgresConfigured()) {
  throw new Error("SOLPIENT_DATABASE_URL is not configured.");
}

function byCompany(rows = []) {
  return new Map(rows.filter((row) => row.company_id).map((row) => [row.company_id, row]));
}

function byTicker(rows = []) {
  return new Map(
    rows
      .filter((row) => row.ticker || row.symbol)
      .map((row) => [String(row.ticker ?? row.symbol).toUpperCase(), row]),
  );
}

async function loadLatestCandidateRun() {
  const run = await pgMaybeOne(
    `select *
     from public.research_candidate_pipeline_runs
     order by evaluation_as_of desc nulls last, created_at desc
     limit 1`,
  );
  if (!run) throw new Error("No Research Candidate Pipeline run exists.");

  const members = await pgQuery(
    `select
       i.id as source_pipeline_item_id,
       i.ticker,
       i.company_id,
       i.stage,
       i.readiness_state,
       i.decision_score as pipeline_decision_score,
       i.evidence_confidence as pipeline_evidence_confidence,
       i.item_hash,
       u.id as universe_screen_result_id,
       u.company_name,
       u.sector,
       u.industry,
       u.shortlist_rank,
       u.universe_rank,
       u.screen_score,
       u.quality_core_score,
       u.evidence_coverage_pct
     from public.research_candidate_pipeline_items i
     join public.universe_screen_results u
       on u.id=i.universe_screen_result_id
     where i.research_candidate_pipeline_run_id=$1
     order by u.shortlist_rank asc nulls last, i.ticker asc`,
    [run.id],
  );

  const expected = Number(run.candidate_count);
  if (members.length !== expected) {
    throw new Error(
      `Candidate snapshot incomplete: expected ${expected}, found ${members.length}.`,
    );
  }
  if (expected !== 100) {
    throw new Error(
      `Baseline Research Pack V1 requires the governed Solpient 100; latest candidate run has ${expected} members.`,
    );
  }
  return { run, members };
}

async function loadSupportingData(members) {
  const companyIds = [...new Set(members.map((row) => row.company_id).filter(Boolean))];
  const tickers = [...new Set(members.map((row) => String(row.ticker).toUpperCase()))];

  const [
    companies,
    drafts,
    coverage,
    valuationDrafts,
    publishedValuations,
    market,
  ] = await Promise.all([
    companyIds.length
      ? pgQuery(
          `select id,ticker,company_name,sector,industry,cik,exchange
           from public.companies
           where id=any($1::uuid[])`,
          [companyIds],
        )
      : Promise.resolve([]),
    companyIds.length
      ? pgQuery(
          `select distinct on (company_id) *
           from public.baseline_drafts
           where company_id=any($1::uuid[])
           order by company_id, generated_at desc, created_at desc`,
          [companyIds],
        )
      : Promise.resolve([]),
    companyIds.length
      ? pgQuery(
          `select distinct on (company_id) *
           from public.data_coverage_reports
           where company_id=any($1::uuid[])
             and engine_version='coverage-v2'
           order by company_id, as_of_date desc, generated_at desc`,
          [companyIds],
        )
      : Promise.resolve([]),
    companyIds.length
      ? pgQuery(
          `select distinct on (company_id) *
           from public.research_factory_valuation_drafts
           where company_id=any($1::uuid[])
             and status='draft'
           order by company_id, created_at desc`,
          [companyIds],
        )
      : Promise.resolve([]),
    companyIds.length
      ? pgQuery(
          `select distinct on (r.company_id)
             r.company_id,
             r.id as research_run_id,
             r.version as research_version,
             v.bear_value,
             v.base_value,
             v.bull_value,
             v.mos_25_price,
             v.mos_35_price
           from public.research_runs r
           left join public.valuations v on v.research_run_id=r.id
           where r.company_id=any($1::uuid[])
             and r.status='published'
           order by r.company_id, r.version desc, r.researched_at desc`,
          [companyIds],
        )
      : Promise.resolve([]),
    tickers.length
      ? pgQuery(
          `select distinct on (symbol) symbol,company_id,price,trading_date,observed_at
           from public.market_snapshots
           where symbol=any($1::text[])
           order by symbol, trading_date desc, observed_at desc nulls last`,
          [tickers],
        )
      : Promise.resolve([]),
  ]);

  return {
    companies: byCompany(companies),
    drafts: byCompany(drafts),
    coverage: byCompany(coverage),
    valuationDrafts: byCompany(valuationDrafts),
    publishedValuations: byCompany(publishedValuations),
    market: byTicker(market),
  };
}

const generatedAt = new Date().toISOString();

try {
  const { run, members: allMembers } = await loadLatestCandidateRun();
  let members = allMembers;

  if (tickerFilter.size) {
    members = members.filter((row) => tickerFilter.has(String(row.ticker).toUpperCase()));
  }
  if (limit) members = members.slice(0, limit);

  const supporting = await loadSupportingData(members);
  const packs = [];

  for (const member of members) {
    const ticker = String(member.ticker).toUpperCase();
    const company =
      supporting.companies.get(member.company_id) ?? {
        id: member.company_id ?? null,
        ticker,
        company_name: member.company_name ?? ticker,
        sector: member.sector ?? null,
        industry: member.industry ?? null,
      };
    const baselineDraft = supporting.drafts.get(member.company_id) ?? null;
    const coverage = supporting.coverage.get(member.company_id) ?? null;
    const valuationDraft = supporting.valuationDrafts.get(member.company_id) ?? null;
    const publishedValuation = supporting.publishedValuations.get(member.company_id) ?? null;
    const latestMarket = supporting.market.get(ticker) ?? null;

    const industryModule =
      baselineDraft?.industry_module ??
      valuationDraft?.industry_module ??
      coverage?.coverage_details?.industry_module ??
      null;

    packs.push(
      buildBaselineEvidencePack({
        company,
        candidate: member,
        coverage,
        baselineDraft,
        valuationDraft,
        publishedValuation,
        latestMarket,
        industryModule,
        generatedAt,
      }),
    );
  }

  await fs.mkdir(path.join(outputDir, "packs"), { recursive: true });

  for (const pack of packs) {
    await fs.writeFile(
      path.join(outputDir, "packs", pack.company.ticker + ".json"),
      JSON.stringify(pack, null, 2) + "\n",
      "utf8",
    );
  }

  const summary = {
    contract_version: packs[0]?.contract_version ?? "baseline-research-contract-v1",
    generated_at: generatedAt,
    source_candidate_pipeline_run_id: run.id,
    source_candidate_pipeline_input_hash: run.input_hash,
    source_candidate_pipeline_as_of: run.evaluation_as_of,
    source_candidate_count: Number(run.candidate_count),
    selected_count: packs.length,
    composer_allowed_count: packs.filter((pack) => pack.baseline_gate.composer_allowed).length,
    public_baseline_ready_count: packs.filter(
      (pack) => pack.baseline_gate.public_baseline_ready,
    ).length,
    building_count: packs.filter(
      (pack) => !pack.baseline_gate.public_baseline_ready,
    ).length,
    industry_module_review_count: packs.filter(
      (pack) => pack.baseline_gate.blockers.includes("industry_module_unreviewed"),
    ).length,
    rows: packs.map((pack) => ({
      ticker: pack.company.ticker,
      company_name: pack.company.company_name,
      shortlist_rank: pack.membership.shortlist_rank,
      industry_module: pack.sector_evidence.industry_module,
      evidence_pack_hash: pack.evidence_pack_hash,
      evidence_item_count: pack.evidence_items.length,
      gap_count: pack.evidence_gaps.length,
      composer_allowed: pack.baseline_gate.composer_allowed,
      public_baseline_ready: pack.baseline_gate.public_baseline_ready,
      blockers: pack.baseline_gate.blockers,
    })),
  };

  await fs.writeFile(
    path.join(outputDir, "index.json"),
    JSON.stringify(summary, null, 2) + "\n",
    "utf8",
  );

  console.log(JSON.stringify(summary, null, 2));
} finally {
  await closePostgresPool();
}
