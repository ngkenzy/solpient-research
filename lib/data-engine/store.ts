import "server-only";

import { databaseConfigured, dbQuery } from "@/lib/db";
import { buildMockDataEngineSnapshot } from "./mock-snapshot";
import { canPublishSnapshot } from "./integrity";
import type {
  DataEngineSnapshot,
  DataFreshness,
  FreshnessStatus,
  MaterialChange,
  PipelineFailure,
  PipelineRun,
  PipelineRunState,
  PipelineStage,
  PipelineStageName,
  ResearchReviewItem,
  StageStatus,
  TickerStatus,
} from "./types";

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

const num = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const iso = (value: unknown): string | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const details = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

function freshnessStatus(
  asOf: string | null,
  freshHours: number,
  staleHours: number,
): FreshnessStatus {
  if (!asOf) return "Missing";
  const ageHours = Math.max(0, (Date.now() - Date.parse(asOf)) / 3_600_000);
  if (!Number.isFinite(ageHours)) return "Failed";
  if (ageHours <= freshHours) return "Fresh";
  if (ageHours <= staleHours) return "Aging";
  return "Stale";
}

function stageStatus(value: unknown): StageStatus {
  if (value === "success" || value === "succeeded") return "succeeded";
  if (value === "failed") return "failed";
  if (value === "running") return "running";
  if (value === "skipped") return "skipped";
  return "pending";
}

function automationState(value: unknown): PipelineRunState {
  if (value === "success") return "succeeded";
  if (value === "skipped") return "unchanged";
  if (value === "partial") return "partial";
  if (value === "failed") return "failed";
  return "running";
}

function durationMs(startedAt: unknown, completedAt: unknown): number | null {
  const start = startedAt ? Date.parse(String(startedAt)) : NaN;
  const end = completedAt ? Date.parse(String(completedAt)) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function blankStage(name: PipelineStageName, status: StageStatus = "skipped"): PipelineStage {
  return {
    name,
    label: STAGE_LABELS[name],
    status,
    startedAt: null,
    endedAt: null,
    durationMs: null,
    recordsProcessed: 0,
    recordsSucceeded: 0,
    recordsFailed: 0,
    warningCount: 0,
    error: null,
  };
}

function stageFromStep(
  name: PipelineStageName,
  step: Record<string, any> | null,
  counts: { processed?: number; succeeded?: number; failed?: number } = {},
): PipelineStage {
  if (!step) return blankStage(name, "skipped");
  const status = stageStatus(step.status);
  return {
    name,
    label: STAGE_LABELS[name],
    status,
    startedAt: iso(step.started_at),
    endedAt: iso(step.completed_at),
    durationMs: durationMs(step.started_at, step.completed_at),
    recordsProcessed: counts.processed ?? 0,
    recordsSucceeded: counts.succeeded ?? (status === "succeeded" ? counts.processed ?? 0 : 0),
    recordsFailed: counts.failed ?? (status === "failed" ? 1 : 0),
    warningCount: 0,
    error: status === "failed" ? String(step.error ?? step.reason ?? "stage failed") : null,
  };
}

function buildPipelineRun(row: Record<string, any>, fallbackCandidateCount: number): PipelineRun {
  const runDetails = details(row.details);
  const listDetails = details(runDetails.lists);
  const listCounts = details(listDetails.counts);
  const listComplete = details(listDetails.complete);
  const marketDetails = details(runDetails.market);
  const marketFailures = num(marketDetails.failures, 0);
  const steps = Array.isArray(runDetails.steps) ? runDetails.steps : [];
  const stepByName = new Map(
    steps
      .filter((step: any) => step && typeof step === "object")
      .map((step: any) => [String(step.name), step]),
  );

  const candidateCount = num(listCounts.solpient_100, fallbackCandidateCount);
  const coreCount = num(listCounts.solpient_20, 0);
  const focusCount = num(listCounts.solpient_5, 0);
  const marketStep = (stepByName.get("market_refresh") as Record<string, any> | undefined) ?? null;
  const rankingStep = (stepByName.get("phase3_ranking") as Record<string, any> | undefined) ?? null;
  const listStep = (stepByName.get("solpient_lists") as Record<string, any> | undefined) ?? null;

  const stages: PipelineStage[] = [
    blankStage("universe_discovery"),
    blankStage("sec_refresh"),
    stageFromStep("price_refresh", marketStep, {
      processed: candidateCount,
      succeeded: Math.max(0, candidateCount - marketFailures),
      failed: marketFailures,
    }),
    blankStage("normalization"),
    blankStage("derived_metrics"),
    blankStage("universe_screen"),
    {
      ...blankStage("solpient_100", candidateCount === 100 ? "succeeded" : "failed"),
      recordsProcessed: candidateCount,
      recordsSucceeded: candidateCount === 100 ? candidateCount : 0,
      recordsFailed: candidateCount === 100 ? 0 : Math.abs(100 - candidateCount),
      error: candidateCount === 100 ? null : "Current immutable candidate set is not exactly 100.",
    },
    stageFromStep("deep_ranking", rankingStep, { processed: candidateCount }),
    stageFromStep("solpient_20", listStep, {
      processed: candidateCount,
      succeeded: coreCount,
    }),
    stageFromStep("solpient_5", listStep, {
      processed: coreCount,
      succeeded: focusCount,
    }),
    {
      ...stageFromStep("snapshot_commit", listStep, {
        processed: candidateCount,
        succeeded: listStep?.status === "success" && listComplete.solpient_100 === true ? 1 : 0,
        failed: listStep?.status === "failed" || listComplete.solpient_100 === false ? 1 : 0,
      }),
      status:
        listStep?.status === "success" && listComplete.solpient_100 === true
          ? "succeeded"
          : stageStatus(listStep?.status),
    },
    blankStage("material_change_detection"),
    blankStage("research_draft_queue"),
  ];

  const failures: PipelineFailure[] = [];
  if (marketFailures > 0) {
    failures.push({
      ticker: null,
      stage: "price_refresh",
      message: marketFailures + " market-data ticker refreshes failed; existing snapshots remain available.",
      fatalToSnapshot: false,
    });
  }
  if (runDetails.failed_step) {
    const stage: PipelineStageName =
      runDetails.failed_step === "market_refresh"
        ? "price_refresh"
        : runDetails.failed_step === "phase3_ranking"
          ? "deep_ranking"
          : "snapshot_commit";
    failures.push({
      ticker: null,
      stage,
      message: String(row.message ?? runDetails.failed_step + " failed"),
      fatalToSnapshot: true,
    });
  }
  if (candidateCount !== 100) {
    failures.push({
      ticker: null,
      stage: "solpient_100",
      message: "Authoritative daily snapshot requires exactly 100 governed candidates.",
      fatalToSnapshot: true,
    });
  }

  const state = automationState(row.status);
  const base: PipelineRun = {
    id: String(row.id),
    runDate: String(row.started_at ?? "").slice(0, 10),
    methodologyVersion:
      String(listDetails.methodology_version ?? "solpient-lists-v1") +
      "+decision-ranking-v1",
    inputHash: listDetails.input_hash ? String(listDetails.input_hash) : null,
    universeCount: num(runDetails.universe_count, candidateCount),
    solpient100Count: candidateCount,
    solpient20Count: coreCount,
    solpient5Count: focusCount,
    warningCount: marketFailures,
    failureCount: failures.length,
    runtimeMs: durationMs(row.started_at, row.completed_at),
    state,
    authoritative: false,
    startedAt: iso(row.started_at) ?? new Date(0).toISOString(),
    completedAt: iso(row.completed_at),
    stages,
    failures,
  };
  base.authoritative = canPublishSnapshot(base).ok;
  return base;
}

function uniqueTickerStatuses(rows: TickerStatus[]): TickerStatus[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.ticker)) return false;
    seen.add(row.ticker);
    return true;
  });
}

export async function getDataEngineSnapshot(): Promise<DataEngineSnapshot> {
  if (!databaseConfigured()) return buildMockDataEngineSnapshot();

  try {
    const [
      screenRows,
      candidateRunRows,
      listRunRows,
      dailyRows,
      freshnessRows,
      repairRows,
      reviewRows,
      changeRows,
    ] = await Promise.all([
      dbQuery<any>(
        `select id,as_of_at,methodology_version,input_hash,input_count,result_count,
                excluded_count,watch_count,research_candidate_count,
                solpient_100_candidate_count,proposed_deep_research_count,metadata
         from public.universe_screen_runs
         order by as_of_at desc
         limit 1`,
      ),
      dbQuery<any>(
        `select id,universe_screen_run_id,pipeline_version,evaluation_as_of,input_hash,
                candidate_count,decision_ready_count,research_ready_count,building_count,created_at
         from public.research_candidate_pipeline_runs
         order by evaluation_as_of desc nulls last,created_at desc
         limit 1`,
      ),
      dbQuery<any>(
        `select id,started_at,completed_at,status,records_written,message,details
         from public.automation_runs
         where pipeline='solpient_list_refresh' and status='success'
         order by started_at desc
         limit 1`,
      ),
      dbQuery<any>(
        `select id,started_at,completed_at,status,records_written,message,details
         from public.automation_runs
         where pipeline='solpient_daily'
         order by started_at desc
         limit 20`,
      ),
      dbQuery<any>(
        `select
           (select max(observed_at) from public.fundamental_snapshots) as fundamentals_at,
           (select max(observed_at) from public.market_snapshots) as prices_at,
           (select max(created_at) from public.valuations) as valuation_at,
           (select max(researched_at) from public.research_runs where status='published') as research_at,
           (select max(last_verified_at) from public.capital_provider_health) as ownership_at`,
      ),
      dbQuery<any>(
        `select c.ticker,c.company_name,j.status,j.reason,j.last_error,j.updated_at
         from public.research_repair_jobs j
         join public.companies c on c.id=j.company_id
         where j.last_error is not null or j.status in ('blocked','needs_review')
         order by j.updated_at desc
         limit 30`,
      ),
      dbQuery<any>(
        `select d.id,c.ticker,d.generation_version,d.status,d.standard_status,d.generated_at
         from public.baseline_drafts d
         join public.companies c on c.id=d.company_id
         where d.status<>'promoted'
         order by d.generated_at desc
         limit 20`,
      ),
      dbQuery<any>(
        `select e.id,c.ticker,e.label,e.summary,e.materiality,e.decision_impact,
                e.occurred_at,e.created_at
         from public.company_change_events e
         join public.companies c on c.id=e.company_id
         order by e.created_at desc
         limit 20`,
      ),
    ]);

    const screen = screenRows[0] ?? null;
    const candidateRun = candidateRunRows[0] ?? null;
    const listRun = listRunRows[0] ?? null;
    const freshness = freshnessRows[0] ?? {};
    const listRunDetails = details(listRun?.details);
    const listCounts = details(listRunDetails.counts);
    const listComplete = details(listRunDetails.complete);
    const listSource = details(listRunDetails.source);
    const candidateCount = num(
      listCounts.solpient_100,
      num(candidateRun?.candidate_count, 0),
    );

    const candidateStatusRows = candidateRun
      ? await dbQuery<any>(
          `select
             i.ticker,
             coalesce(c.company_name,i.ticker) as company_name,
             i.company_id,
             u.sector,
             u.screen_profile,
             u.score_detail,
             f.fundamental_at,
             m.market_at
           from public.research_candidate_pipeline_items i
           left join public.companies c on c.id=i.company_id
           left join public.universe_screen_results u on u.id=i.universe_screen_result_id
           left join lateral (
             select max(observed_at) as fundamental_at
             from public.fundamental_snapshots f0
             where f0.company_id=i.company_id
           ) f on true
           left join lateral (
             select max(observed_at) as market_at
             from public.market_snapshots m0
             where m0.company_id=i.company_id
           ) m on true
           where i.research_candidate_pipeline_run_id=$1
           order by i.ticker`,
          [candidateRun.id],
        )
      : [];

    const missingFundamentals: TickerStatus[] = candidateStatusRows
      .filter((row: any) => !row.fundamental_at)
      .map((row: any) => ({
        ticker: String(row.ticker),
        companyName: String(row.company_name ?? row.ticker),
        category: "missing_fundamentals" as const,
        detail: "No local fundamental snapshot.",
      }));

    const missingPrices: TickerStatus[] = candidateStatusRows
      .filter((row: any) => !row.market_at)
      .map((row: any) => ({
        ticker: String(row.ticker),
        companyName: String(row.company_name ?? row.ticker),
        category: "missing_price" as const,
        detail: "No local market snapshot.",
      }));

    const staleCutoff = Date.now() - 4 * 24 * 60 * 60 * 1000;
    const staleTickers: TickerStatus[] = candidateStatusRows
      .filter((row: any) => row.market_at && Date.parse(String(row.market_at)) < staleCutoff)
      .map((row: any) => ({
        ticker: String(row.ticker),
        companyName: String(row.company_name ?? row.ticker),
        category: "stale" as const,
        detail: "Latest market snapshot is older than four calendar days.",
      }));

    const sectorIssues: TickerStatus[] = candidateStatusRows
      .filter((row: any) => {
        const classification = details(row?.score_detail?.sector_classification);
        const sector = String(row.sector ?? "").trim().toLowerCase();
        return (
          !sector ||
          sector === "unknown" ||
          classification.classification_method === "review_required"
        );
      })
      .map((row: any) => ({
        ticker: String(row.ticker),
        companyName: String(row.company_name ?? row.ticker),
        category: "sector_issue" as const,
        detail: "Sector classification is unresolved or requires review.",
      }));

    const failedTickers = uniqueTickerStatuses(
      repairRows.map((row: any) => ({
        ticker: String(row.ticker),
        companyName: String(row.company_name ?? row.ticker),
        category: "failed" as const,
        detail: String(row.last_error ?? row.reason ?? row.status),
      })),
    );

    const reviewQueue: ResearchReviewItem[] = reviewRows.map((row: any) => ({
      id: String(row.id),
      ticker: String(row.ticker),
      versionLabel: String(row.generation_version ?? row.standard_status ?? "draft"),
      reason: String(row.status ?? "review required"),
      href: "/review/" + String(row.id),
    }));

    const materialChanges: MaterialChange[] = changeRows.map((row: any) => ({
      ticker: String(row.ticker),
      title: String(row.label ?? "Company change"),
      summary: String(row.summary ?? ""),
      detectedAt: iso(row.created_at) ?? String(row.occurred_at ?? ""),
      requiresReview:
        String(row.materiality ?? "").toLowerCase() === "high" ||
        !["", "none", "monitor"].includes(
          String(row.decision_impact ?? "").toLowerCase(),
        ),
    }));

    const history = dailyRows.map((row: any) => buildPipelineRun(row, candidateCount));
    const latestRun = history[0] ?? null;
    const authoritativeRuns = history
      .filter((run) => run.authoritative)
      .sort(
        (a, b) =>
          Date.parse(b.completedAt ?? b.startedAt) -
          Date.parse(a.completedAt ?? a.startedAt),
      );
    const live = authoritativeRuns[0] ?? null;

    const rankingAvailable = Boolean(listRun && listComplete.solpient_100 === true);
    const coreCount = rankingAvailable ? num(listCounts.solpient_20, 0) : 0;
    const focusCount = rankingAvailable ? num(listCounts.solpient_5, 0) : 0;

    const fundamentalsAt = iso(freshness.fundamentals_at);
    const pricesAt = iso(freshness.prices_at);
    const valuationAt = iso(freshness.valuation_at);
    const researchAt = iso(freshness.research_at);
    const ownershipAt = iso(freshness.ownership_at);
    const screenAsOf = iso(screen?.as_of_at);

    const freshnessItems: DataFreshness[] = [
      {
        key: "sec_facts",
        label: "SEC company facts",
        status: freshnessStatus(fundamentalsAt, 48, 120),
        asOf: fundamentalsAt,
      },
      {
        key: "sec_submissions",
        label: "SEC submissions / screen source",
        status: freshnessStatus(screenAsOf, 48, 120),
        asOf: screenAsOf,
      },
      {
        key: "prices",
        label: "Market prices",
        status: freshnessStatus(pricesAt, 36, 96),
        asOf: pricesAt,
      },
      {
        key: "valuation",
        label: "Valuation data",
        status: freshnessStatus(valuationAt, 24 * 30, 24 * 90),
        asOf: valuationAt,
      },
      {
        key: "published_research",
        label: "Published research",
        status: freshnessStatus(researchAt, 24 * 30, 24 * 90),
        asOf: researchAt,
      },
      {
        key: "ownership",
        label: "Ownership / insider",
        status: freshnessStatus(ownershipAt, 24 * 7, 24 * 30),
        asOf: ownershipAt,
      },
    ];

    let healthState: DataEngineSnapshot["health"]["state"] = "healthy";
    let banner: string | null = null;
    if (!rankingAvailable) {
      healthState = "degraded";
      banner =
        "No successful Solpient list snapshot exists yet. Run npm run local:daily; 20/5 remain zero until that authoritative refresh succeeds.";
    } else if (latestRun?.state === "running") {
      healthState = "running";
      banner = "Daily pipeline is currently running. The previous authoritative snapshot remains live.";
    } else if (latestRun && !latestRun.authoritative) {
      healthState = "degraded";
      banner =
        "Latest daily run is not authoritative. The most recent successful snapshot remains live.";
    } else if ((latestRun?.warningCount ?? 0) > 0) {
      healthState = "degraded";
      banner =
        "Daily ranking completed with non-fatal ticker refresh failures. Existing observations were preserved for those names.";
    } else if (!latestRun) {
      healthState = "degraded";
      banner =
        "Ranking snapshot is available, but no solpient_daily orchestration run has been recorded yet.";
    }

    return {
      adapter: "local_postgres",
      generatedAt: new Date().toISOString(),
      health: {
        state: healthState,
        lastSuccessfulRunId: live?.id ?? (listRun ? String(listRun.id) : null),
        lastSuccessfulAt: live?.completedAt ?? iso(listRun?.completed_at),
        currentRunId: latestRun?.id ?? null,
        methodologyVersion: String(
          listRunDetails.methodology_version ??
            screen?.methodology_version ??
            "solpient-lists-v1",
        ),
        inputHash: listRunDetails.input_hash
          ? String(listRunDetails.input_hash)
          : screen?.input_hash
            ? String(screen.input_hash)
            : null,
        banner,
      },
      universe: {
        discovered: num(screen?.input_count, 0),
        secMapped: num(screen?.input_count, 0),
        normalized: num(screen?.result_count, 0),
        screened: num(screen?.result_count, 0),
        excluded: num(screen?.excluded_count, 0),
        watch: num(screen?.watch_count, 0),
        researchCandidates: num(screen?.research_candidate_count, 0),
      },
      ranking: {
        source: rankingAvailable ? "ranking_snapshot" : "pending_chatgpt_engine",
        methodologyVersion: String(
          listRunDetails.methodology_version ?? "solpient-lists-v1",
        ),
        universeScreenRunId: String(
          listSource.universe_screen_run_id ??
            candidateRun?.universe_screen_run_id ??
            screen?.id ??
            "",
        ) || null,
        rankingRunId: listRun ? String(listRun.id) : null,
        solpient100: rankingAvailable ? num(listCounts.solpient_100, candidateCount) : candidateCount,
        solpient20: coreCount,
        solpient5: focusCount,
        note: rankingAvailable
          ? "100/20/5 are read from the latest successful audited Solpient list refresh. They are not inferred from screen_score."
          : "Solpient 100 comes from the latest immutable candidate run. 20/5 remain zero until the deep-ranking list refresh succeeds.",
      },
      freshness: freshnessItems,
      latestRun,
      history,
      failedTickers,
      staleTickers,
      missingFundamentals,
      missingPrices,
      sectorIssues,
      reviewQueue,
      materialChanges,
      incompleteRuns: history.filter(
        (run) => run.state === "partial" || run.state === "failed" || !run.authoritative,
      ),
    };
  } catch (error) {
    const fallback = buildMockDataEngineSnapshot();
    fallback.health.state = "degraded";
    fallback.health.banner =
      "Local PostgreSQL Data Engine adapter failed: " +
      (error instanceof Error ? error.message : String(error)) +
      ". Showing the safe mock fallback; no ranking state was written.";
    return fallback;
  }
}

export { runOperatorAction } from "./operator";
