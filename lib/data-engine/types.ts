export type PipelineHealthState = "healthy" | "running" | "degraded" | "failed";
export type PipelineRunState =
  | "running"
  | "succeeded"
  | "failed"
  | "partial"
  | "unchanged";
export type StageStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";
export type FreshnessStatus = "Fresh" | "Aging" | "Stale" | "Missing" | "Failed";

export type PipelineStageName =
  | "universe_discovery"
  | "sec_refresh"
  | "price_refresh"
  | "normalization"
  | "derived_metrics"
  | "universe_screen"
  | "solpient_100"
  | "deep_ranking"
  | "solpient_20"
  | "solpient_5"
  | "snapshot_commit"
  | "material_change_detection"
  | "research_draft_queue";

export interface PipelineStage {
  name: PipelineStageName;
  label: string;
  status: StageStatus;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  recordsProcessed: number;
  recordsSucceeded: number;
  recordsFailed: number;
  warningCount: number;
  error: string | null;
}

export interface PipelineFailure {
  ticker: string | null;
  stage: PipelineStageName;
  message: string;
  fatalToSnapshot: boolean;
}

export interface PipelineRun {
  id: string;
  runDate: string;
  methodologyVersion: string;
  inputHash: string | null;
  universeCount: number;
  solpient100Count: number;
  solpient20Count: number;
  solpient5Count: number;
  warningCount: number;
  failureCount: number;
  runtimeMs: number | null;
  state: PipelineRunState;
  authoritative: boolean;
  startedAt: string;
  completedAt: string | null;
  stages: PipelineStage[];
  failures: PipelineFailure[];
}

export interface RankingSummary {
  source: "pending_chatgpt_engine" | "ranking_snapshot";
  methodologyVersion: string;
  universeScreenRunId: string | null;
  rankingRunId: string | null;
  solpient100: number;
  solpient20: number;
  solpient5: number;
  note: string;
}

export interface UniverseCounters {
  discovered: number;
  secMapped: number;
  normalized: number;
  screened: number;
  excluded: number;
  watch: number;
  researchCandidates: number;
}

export interface DataFreshness {
  key: string;
  label: string;
  status: FreshnessStatus;
  asOf: string | null;
}

export interface TickerStatus {
  ticker: string;
  companyName: string;
  category: "failed" | "stale" | "missing_fundamentals" | "missing_price" | "sector_issue";
  detail: string;
}

export interface MaterialChange {
  ticker: string;
  title: string;
  summary: string;
  detectedAt: string;
  requiresReview: boolean;
}

export interface ResearchReviewItem {
  id: string;
  ticker: string;
  versionLabel: string;
  reason: string;
  href: string;
}

export interface PipelineHealth {
  state: PipelineHealthState;
  lastSuccessfulRunId: string | null;
  lastSuccessfulAt: string | null;
  currentRunId: string | null;
  methodologyVersion: string;
  inputHash: string | null;
  banner: string | null;
}

export interface DataEngineSnapshot {
  adapter: "mock_pending_chatgpt_engine" | "local_postgres";
  generatedAt: string;
  health: PipelineHealth;
  universe: UniverseCounters;
  ranking: RankingSummary;
  freshness: DataFreshness[];
  latestRun: PipelineRun | null;
  history: PipelineRun[];
  failedTickers: TickerStatus[];
  staleTickers: TickerStatus[];
  missingFundamentals: TickerStatus[];
  missingPrices: TickerStatus[];
  sectorIssues: TickerStatus[];
  reviewQueue: ResearchReviewItem[];
  materialChanges: MaterialChange[];
  incompleteRuns: PipelineRun[];
}

export type OperatorAction =
  | "run_daily"
  | "refresh_prices"
  | "refresh_sec"
  | "retry_failed"
  | "recalculate_rankings";

export interface OperatorResult {
  ok: boolean;
  action: OperatorAction;
  reason: string;
}
