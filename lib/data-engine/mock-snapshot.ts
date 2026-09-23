import type { DataEngineSnapshot, PipelineRun, PipelineStage, PipelineStageName } from "./types";
import { canPublishSnapshot, selectAuthoritativeRun } from "./integrity";

const STAGE_LABELS: Record<PipelineStageName, string> = {
  universe_discovery: "Universe Discovery",
  sec_refresh: "SEC Refresh",
  price_refresh: "Price Refresh",
  normalization: "Normalization",
  derived_metrics: "Derived Metrics",
  universe_screen: "Universe Screen",
  solpient_100: "Solpient 100",
  deep_ranking: "Deep Ranking",
  solpient_20: "Solpient 20",
  solpient_5: "Solpient 5",
  snapshot_commit: "Snapshot Commit",
  material_change_detection: "Material Change Detection",
  research_draft_queue: "Research Draft Queue",
};

function stages(overrides: Partial<Record<PipelineStageName, Partial<PipelineStage>>> = {}): PipelineStage[] {
  return (Object.keys(STAGE_LABELS) as PipelineStageName[]).map((name, index) => {
    const extra = overrides[name] ?? {};
    return {
      name,
      label: STAGE_LABELS[name],
      status: extra.status ?? "succeeded",
      startedAt: extra.startedAt ?? `2026-09-23T10:0${Math.min(index, 9)}:00Z`,
      endedAt: extra.endedAt ?? `2026-09-23T10:0${Math.min(index, 9)}:12Z`,
      durationMs: extra.durationMs ?? 12000,
      recordsProcessed: extra.recordsProcessed ?? 6120,
      recordsSucceeded: extra.recordsSucceeded ?? 6114,
      recordsFailed: extra.recordsFailed ?? 6,
      warningCount: extra.warningCount ?? 2,
      error: extra.error ?? null,
    };
  });
}

function run(partial: Partial<PipelineRun> & Pick<PipelineRun, "id" | "state" | "authoritative">): PipelineRun {
  return {
    runDate: partial.runDate ?? "2026-09-23",
    methodologyVersion: partial.methodologyVersion ?? "solpient-universe-screen-v2.3+pending-deep-rank",
    inputHash: partial.inputHash ?? "sha256:mock-2026-09-23",
    universeCount: partial.universeCount ?? 6120,
    solpient100Count: partial.solpient100Count ?? 100,
    solpient20Count: partial.solpient20Count ?? 0,
    solpient5Count: partial.solpient5Count ?? 0,
    warningCount: partial.warningCount ?? 4,
    failureCount: partial.failureCount ?? 6,
    runtimeMs: partial.runtimeMs ?? 184000,
    startedAt: partial.startedAt ?? "2026-09-23T10:00:00Z",
    completedAt: partial.completedAt ?? "2026-09-23T10:03:04Z",
    stages: partial.stages ?? stages(),
    failures: partial.failures ?? [
      { ticker: "XYZQ", stage: "normalization", message: "malformed companyfacts", fatalToSnapshot: false },
    ],
    ...partial,
  };
}

export function buildMockDataEngineSnapshot(): DataEngineSnapshot {
  const succeeded = run({
    id: "run_2026-09-22_ok",
    runDate: "2026-09-22",
    state: "succeeded",
    authoritative: true,
    inputHash: "sha256:mock-2026-09-22",
    startedAt: "2026-09-22T10:00:00Z",
    completedAt: "2026-09-22T10:02:51Z",
    solpient20Count: 0,
    solpient5Count: 0,
  });
  succeeded.authoritative = canPublishSnapshot(succeeded).ok;

  const partial = run({
    id: "run_2026-09-23_partial",
    state: "partial",
    authoritative: false,
    stages: stages({
      snapshot_commit: { status: "failed", error: "commit aborted: deep ranking pending", recordsFailed: 1 },
      solpient_20: { status: "skipped", recordsProcessed: 0, recordsSucceeded: 0 },
      solpient_5: { status: "skipped", recordsProcessed: 0, recordsSucceeded: 0 },
    }),
    failures: [
      { ticker: null, stage: "snapshot_commit", message: "ChatGPT engine not connected; snapshot not published", fatalToSnapshot: true },
    ],
    failureCount: 1,
  });
  partial.authoritative = canPublishSnapshot(partial).ok;

  const history = [partial, succeeded];
  const live = selectAuthoritativeRun(history);

  return {
    adapter: "mock_pending_chatgpt_engine",
    generatedAt: new Date().toISOString(),
    health: {
      state: "degraded",
      lastSuccessfulRunId: live?.id ?? null,
      lastSuccessfulAt: live?.completedAt ?? null,
      currentRunId: partial.id,
      methodologyVersion: succeeded.methodologyVersion,
      inputHash: succeeded.inputHash,
      banner:
        "Latest run is partial and is not the authoritative snapshot. Yesterday's successful run remains live. Solpient 20/5 stay 0 until ChatGPT connects the deep-ranking engine.",
    },
    universe: {
      discovered: 7840,
      secMapped: 6412,
      normalized: 6120,
      screened: 6120,
      excluded: 1840,
      watch: 4180,
      researchCandidates: 210,
    },
    ranking: {
      source: "pending_chatgpt_engine",
      methodologyVersion: succeeded.methodologyVersion,
      universeScreenRunId: null,
      rankingRunId: live?.id ?? null,
      solpient100: 100,
      solpient20: 0,
      solpient5: 0,
      note: "100 count is illustrative from the last successful mock screen. 20 and 5 are not inferred from screen_score.",
    },
    freshness: [
      { key: "sec_facts", label: "SEC company facts", status: "Aging", asOf: "2026-09-22T21:10:00Z" },
      { key: "sec_submissions", label: "SEC submissions", status: "Aging", asOf: "2026-09-22T21:10:00Z" },
      { key: "prices", label: "Market prices", status: "Stale", asOf: "2026-09-22T20:00:00Z" },
      { key: "valuation", label: "Valuation data", status: "Missing", asOf: null },
      { key: "published_research", label: "Published research", status: "Aging", asOf: "2026-09-20T16:00:00Z" },
      { key: "ownership", label: "Ownership / insider", status: "Missing", asOf: null },
    ],
    latestRun: partial,
    history,
    failedTickers: [
      { ticker: "XYZQ", companyName: "Example malformed issuer", category: "failed", detail: "companyfacts JSON invalid" },
    ],
    staleTickers: [
      { ticker: "ADBE", companyName: "Adobe Inc.", category: "stale", detail: "price snapshot older than 1 session" },
    ],
    missingFundamentals: [
      { ticker: "NEWCO", companyName: "Unmapped issuer", category: "missing_fundamentals", detail: "no normalized facts" },
    ],
    missingPrices: [
      { ticker: "HALT", companyName: "Halted example", category: "missing_price", detail: "no EOD print" },
    ],
    sectorIssues: [
      { ticker: "MISC", companyName: "Unclassified", category: "sector_issue", detail: "screen profile unresolved" },
    ],
    reviewQueue: [
      { id: "draft-pfe", ticker: "PFE", versionLabel: "draft after 10-Q", reason: "Material filing; do not auto-publish", href: "/review" },
    ],
    materialChanges: [
      { ticker: "PFE", title: "New 10-Q detected", summary: "Facts changed. Draft only.", detectedAt: "2026-09-23T09:14:00Z", requiresReview: true },
    ],
    incompleteRuns: history.filter((item) => item.state === "partial" || item.state === "failed"),
  };
}

export function getDataEngineSnapshot(): DataEngineSnapshot {
  return buildMockDataEngineSnapshot();
}
