import fs from "node:fs/promises";
import path from "node:path";
import {
  postgresConfigured,
  insertObject,
} from "./postgres-node.mjs";
import { composeBaselineResearch } from "./baseline-research-composer-v1.mjs";
import {
  baselineResearchState,
  validateBaselineComposerOutput,
} from "./baseline-research-contract-v1.mjs";

export const BASELINE_RESEARCH_BATCH_VERSION = "baseline-research-batch-v1";

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function atomicWriteJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + ".tmp-" + process.pid;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(temp, file);
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function loadCheckpoint(file) {
  if (!(await fileExists(file))) {
    return {
      batch_version: BASELINE_RESEARCH_BATCH_VERSION,
      updated_at: null,
      items: {},
    };
  }
  try {
    const value = await readJson(file);
    if (value?.batch_version !== BASELINE_RESEARCH_BATCH_VERSION) {
      return {
        batch_version: BASELINE_RESEARCH_BATCH_VERSION,
        updated_at: null,
        items: {},
      };
    }
    return {
      batch_version: BASELINE_RESEARCH_BATCH_VERSION,
      updated_at: value.updated_at ?? null,
      items: value.items ?? {},
    };
  } catch {
    return {
      batch_version: BASELINE_RESEARCH_BATCH_VERSION,
      updated_at: null,
      items: {},
    };
  }
}

async function persistComposition({ pack, output, validation }) {
  if (!postgresConfigured()) {
    throw new Error("SOLPIENT_DATABASE_URL is required for --persist.");
  }
  const draftId = pack?.provenance?.baseline_draft_id ?? null;
  const companyId = pack?.company?.id ?? null;
  if (!draftId || !companyId) {
    return {
      persisted: false,
      reason: !draftId ? "baseline_draft_id_missing" : "company_id_missing",
      composition_id: null,
    };
  }
  if (!validation.valid) {
    return {
      persisted: false,
      reason: "composer_output_invalid",
      composition_id: null,
    };
  }

  const row = await insertObject(
    "research_compositions",
    {
      draft_id: draftId,
      company_id: companyId,
      engine_version: output.composer_version ?? "baseline-research-composer-v1",
      context_pack_id: null,
      status: "generated",
      composition_payload: output,
      validation_result: validation,
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      conflict: ["draft_id", "engine_version"],
      update: true,
      returning: "id,status,generated_at,updated_at",
    },
  );

  return {
    persisted: Boolean(row?.id),
    reason: row?.id ? null : "insert_returned_no_id",
    composition_id: row?.id ?? null,
  };
}

function selectedRows(index, tickers, limit) {
  let rows = Array.isArray(index?.rows) ? index.rows : [];
  if (tickers?.size) {
    rows = rows.filter((row) => tickers.has(String(row.ticker ?? "").toUpperCase()));
  }
  if (limit && limit > 0) rows = rows.slice(0, limit);
  return rows;
}

export async function runBaselineResearchBatch({
  inputDir = "data/baseline-research",
  outputDir = "data/baseline-research/compositions",
  checkpointPath = "data/baseline-research/batch-checkpoint-v1.json",
  tickers = new Set(),
  limit = null,
  persist = false,
  force = false,
  now = () => new Date().toISOString(),
} = {}) {
  const root = path.resolve(inputDir);
  const outRoot = path.resolve(outputDir);
  const checkpointFile = path.resolve(checkpointPath);
  const index = await readJson(path.join(root, "index.json"));

  if (Number(index?.source_candidate_count) !== 100) {
    throw new Error(
      "Baseline Research Batch V1 requires a complete governed Solpient 100 evidence-pack index.",
    );
  }

  const rows = selectedRows(index, tickers, limit);
  const checkpoint = await loadCheckpoint(checkpointFile);
  const summary = {
    batch_version: BASELINE_RESEARCH_BATCH_VERSION,
    source_candidate_pipeline_run_id: index.source_candidate_pipeline_run_id ?? null,
    selected_count: rows.length,
    attempted_count: 0,
    succeeded_count: 0,
    skipped_unchanged_count: 0,
    failed_count: 0,
    persisted_count: 0,
    persistence_skipped_count: 0,
    public_baseline_ready_count: 0,
    building_count: 0,
    results: [],
  };

  for (const row of rows) {
    const ticker = String(row.ticker ?? "").toUpperCase();
    const packFile = path.join(root, "packs", ticker + ".json");
    const outputFile = path.join(outRoot, ticker + ".json");
    const prior = checkpoint.items[ticker] ?? null;

    try {
      const pack = await readJson(packFile);
      if (String(pack?.company?.ticker ?? "").toUpperCase() !== ticker) {
        throw new Error("Evidence-pack ticker does not match index ticker.");
      }
      if (!pack?.evidence_pack_hash) {
        throw new Error("Evidence pack has no evidence_pack_hash.");
      }

      if (
        !force &&
        prior?.status === "success" &&
        prior?.evidence_pack_hash === pack.evidence_pack_hash &&
        (await fileExists(outputFile))
      ) {
        summary.skipped_unchanged_count += 1;
        const priorValidation = prior.validation ?? {};
        if (priorValidation.public_baseline_ready) summary.public_baseline_ready_count += 1;
        else summary.building_count += 1;
        summary.results.push({
          ticker,
          status: "skipped_unchanged",
          evidence_pack_hash: pack.evidence_pack_hash,
          output: outputFile,
          public_baseline_ready: Boolean(priorValidation.public_baseline_ready),
        });
        continue;
      }

      summary.attempted_count += 1;
      const output = composeBaselineResearch(pack);
      const validation = validateBaselineComposerOutput(pack, output);
      if (!validation.valid) {
        throw new Error(
          "Composer output failed canonical validation: " + validation.errors.join(", "),
        );
      }

      const state = baselineResearchState({
        evidencePack: pack,
        composerValidation: validation,
        candidateReadinessState: pack?.membership?.candidate_readiness_state ?? null,
      });

      const artifact = {
        generated_at: now(),
        batch_version: BASELINE_RESEARCH_BATCH_VERSION,
        evidence_pack_hash: pack.evidence_pack_hash,
        research_state: state,
        validation,
        composition: output,
      };
      await atomicWriteJson(outputFile, artifact);

      const persistence = persist
        ? await persistComposition({ pack, output, validation })
        : { persisted: false, reason: "persistence_disabled", composition_id: null };

      if (persistence.persisted) summary.persisted_count += 1;
      else summary.persistence_skipped_count += 1;

      const checkpointItem = {
        status: "success",
        updated_at: now(),
        evidence_pack_hash: pack.evidence_pack_hash,
        output: outputFile,
        validation,
        research_state: state,
        persistence,
        attempts: Number(prior?.attempts ?? 0) + 1,
        last_error: null,
      };
      checkpoint.items[ticker] = checkpointItem;
      checkpoint.updated_at = now();
      await atomicWriteJson(checkpointFile, checkpoint);

      summary.succeeded_count += 1;
      if (validation.public_baseline_ready) summary.public_baseline_ready_count += 1;
      else summary.building_count += 1;
      summary.results.push({
        ticker,
        status: "success",
        evidence_pack_hash: pack.evidence_pack_hash,
        research_state: state,
        public_baseline_ready: validation.public_baseline_ready,
        persistence,
        output: outputFile,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.failed_count += 1;
      checkpoint.items[ticker] = {
        status: "failed",
        updated_at: now(),
        evidence_pack_hash: row.evidence_pack_hash ?? null,
        output: outputFile,
        validation: null,
        research_state: "building",
        persistence: { persisted: false, reason: "failed", composition_id: null },
        attempts: Number(prior?.attempts ?? 0) + 1,
        last_error: message,
      };
      checkpoint.updated_at = now();
      await atomicWriteJson(checkpointFile, checkpoint);
      summary.results.push({ ticker, status: "failed", error: message });
    }
  }

  summary.completed_at = now();
  summary.authoritative = summary.failed_count === 0 && summary.selected_count > 0;
  return summary;
}
