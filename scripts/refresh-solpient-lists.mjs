import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pgMaybeOne, pgQuery, closePostgresPool } from "../lib/postgres-node.mjs";
import { canonicalSha256 } from "../lib/integrity-hash.mjs";
import { deriveSolpientLists, SOLPIENT_LIST_METHODOLOGY_VERSION } from "../lib/solpient-list-engine.mjs";

function arg(name, fallback = null) {
  const prefix = "--" + name + "=";
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const output = path.resolve(
  arg("output", process.env.SOLPIENT_LIST_OUTPUT ?? "data/rankings/solpient-lists-latest.json"),
);

async function startAutomationRun() {
  const rows = await pgQuery(
    "insert into public.automation_runs(pipeline,status,details) " +
      "values('solpient_list_refresh','running',$1::jsonb) returning id",
    [JSON.stringify({ methodology_version: SOLPIENT_LIST_METHODOLOGY_VERSION })],
  );
  return rows[0]?.id ?? null;
}

async function finishAutomationRun(id, status, recordsWritten, message, details) {
  if (!id) return;
  await pgQuery(
    "update public.automation_runs " +
      "set status=$2, records_written=$3, message=$4, details=$5::jsonb, completed_at=now() " +
      "where id=$1",
    [id, status, recordsWritten, message, JSON.stringify(details ?? {})],
  );
}

async function loadSource() {
  const candidateRun = await pgMaybeOne(
    "select id,universe_screen_run_id,pipeline_version,evaluation_as_of,input_hash," +
      "candidate_count,decision_ready_count,research_ready_count,building_count,created_at " +
      "from public.research_candidate_pipeline_runs " +
      "order by evaluation_as_of desc nulls last, created_at desc limit 1",
  );
  if (!candidateRun) throw new Error("No Research Candidate Pipeline run exists.");

  const candidates = await pgQuery(
    "select i.ticker,i.company_id,i.stage,i.readiness_state," +
      "i.decision_score as pipeline_decision_score," +
      "i.evidence_confidence as pipeline_evidence_confidence," +
      "u.company_name,u.sector,u.industry,u.shortlist_rank,u.universe_rank," +
      "u.screen_score,u.quality_core_score,u.evidence_coverage_pct " +
      "from public.research_candidate_pipeline_items i " +
      "join public.universe_screen_results u on u.id=i.universe_screen_result_id " +
      "where i.research_candidate_pipeline_run_id=$1 " +
      "order by u.shortlist_rank asc nulls last, i.ticker asc",
    [candidateRun.id],
  );

  if (candidates.length !== Number(candidateRun.candidate_count)) {
    throw new Error(
      "Latest candidate pipeline run is incomplete: expected " +
        candidateRun.candidate_count +
        " items, found " +
        candidates.length +
        ".",
    );
  }

  const rankingHead = await pgMaybeOne(
    "select max(ranked_at) as ranked_at from public.ranking_history " +
      "where methodology_version='decision-ranking-v1'",
  );
  const rankedAt = rankingHead?.ranked_at ?? null;
  const rankings = rankedAt
    ? await pgQuery(
        "select h.company_id,c.ticker,h.rank,h.decision_score," +
          "h.business_quality_score,h.investment_opportunity_score," +
          "h.evidence_confidence_score,h.readiness_state,h.readiness_tier," +
          "h.price,h.base_fair_value,h.snapshot_hash " +
          "from public.ranking_history h " +
          "left join public.companies c on c.id=h.company_id " +
          "where h.methodology_version='decision-ranking-v1' and h.ranked_at=$1 " +
          "order by h.rank asc",
        [rankedAt],
      )
    : [];

  return { candidateRun, candidates, rankedAt, rankings };
}

const automationRunId = await startAutomationRun();
let written = 0;

try {
  const source = await loadSource();
  const lists = deriveSolpientLists({
    candidates: source.candidates,
    rankings: source.rankings,
    expectedCandidateCount: Number(source.candidateRun.candidate_count),
  });

  if (!lists.complete.solpient_100) {
    throw new Error(
      "Solpient 100 is not complete; refusing to publish a daily list artifact. " +
        JSON.stringify(lists.counts),
    );
  }

  const inputHash = canonicalSha256({
    methodology_version: SOLPIENT_LIST_METHODOLOGY_VERSION,
    candidate_pipeline_run_id: source.candidateRun.id,
    candidate_pipeline_input_hash: source.candidateRun.input_hash,
    ranking_ranked_at: source.rankedAt,
    rankings: source.rankings.map((row) => ({
      company_id: row.company_id,
      rank: row.rank,
      snapshot_hash: row.snapshot_hash,
    })),
  });

  let previousHash = null;
  try {
    const previous = JSON.parse(await fs.readFile(output, "utf8"));
    previousHash = previous?.input_hash ?? null;
  } catch {}

  const generatedAt = new Date().toISOString();
  const artifact = {
    generated_at: generatedAt,
    input_hash: inputHash,
    source: {
      candidate_pipeline_run_id: source.candidateRun.id,
      candidate_pipeline_version: source.candidateRun.pipeline_version,
      candidate_pipeline_as_of: source.candidateRun.evaluation_as_of,
      candidate_pipeline_input_hash: source.candidateRun.input_hash,
      universe_screen_run_id: source.candidateRun.universe_screen_run_id,
      ranking_ranked_at: source.rankedAt,
      ranking_methodology_version: "decision-ranking-v1",
    },
    ...lists,
  };

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(artifact, null, 2) + "\n", "utf8");

  if (previousHash !== inputHash) {
    const historyDir = path.join(path.dirname(output), "history");
    await fs.mkdir(historyDir, { recursive: true });
    const historyFile = path.join(
      historyDir,
      generatedAt.replaceAll(":", "-").replaceAll(".", "-") + "-" + inputHash.slice(0, 12) + ".json",
    );
    await fs.writeFile(historyFile, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  }

  written = lists.counts.solpient_100 + lists.counts.solpient_20 + lists.counts.solpient_5;
  const details = {
    methodology_version: SOLPIENT_LIST_METHODOLOGY_VERSION,
    input_hash: inputHash,
    source: artifact.source,
    counts: lists.counts,
    complete: lists.complete,
    solpient_20: lists.solpient_20.map((row) => row.ticker),
    solpient_5: lists.solpient_5.map((row) => row.ticker),
    artifact_path: output,
    duplicate_input: previousHash === inputHash,
  };

  await finishAutomationRun(
    automationRunId,
    "success",
    written,
    previousHash === inputHash
      ? "Solpient list inputs unchanged; latest artifact verified."
      : "Refreshed Solpient 100 / 20 / 5 derived lists.",
    details,
  );

  console.log(JSON.stringify({ ...details, skipped: previousHash === inputHash }, null, 2));
} catch (error) {
  await finishAutomationRun(
    automationRunId,
    "failed",
    written,
    error instanceof Error ? error.message : String(error),
    { methodology_version: SOLPIENT_LIST_METHODOLOGY_VERSION },
  );
  throw error;
} finally {
  await closePostgresPool();
}
