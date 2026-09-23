import type { PipelineRun, PipelineRunState } from "./types";

export function selectAuthoritativeRun(runs: PipelineRun[]): PipelineRun | null {
  const successful = runs.filter((run) => run.state === "succeeded" || run.state === "unchanged");
  if (!successful.length) return null;
  return successful
    .slice()
    .sort((a, b) => Date.parse(b.completedAt ?? b.startedAt) - Date.parse(a.completedAt ?? a.startedAt))[0];
}

export function canPublishSnapshot(run: PipelineRun): { ok: boolean; reason: string } {
  if (run.state === "partial" || run.state === "failed" || run.state === "running") {
    return { ok: false, reason: "incomplete_or_failed_run_cannot_be_authoritative" };
  }
  const commit = run.stages.find((stage) => stage.name === "snapshot_commit");
  if (!commit || commit.status !== "succeeded") {
    return { ok: false, reason: "snapshot_commit_not_succeeded" };
  }
  if (run.failures.some((failure) => failure.fatalToSnapshot)) {
    return { ok: false, reason: "fatal_failure_blocks_snapshot" };
  }
  return { ok: true, reason: "ok" };
}

export function tickerFailureCorruptsSnapshot(run: PipelineRun, ticker: string): boolean {
  return run.failures.some((failure) => failure.ticker === ticker && failure.fatalToSnapshot);
}

export function applyIdenticalInputHash(previous: PipelineRun | null, incomingHash: string): PipelineRunState {
  if (previous && previous.inputHash === incomingHash && previous.state === "succeeded") {
    return "unchanged";
  }
  return "succeeded";
}
