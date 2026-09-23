import type { OperatorAction, OperatorResult } from "./types";

const REASONS: Record<OperatorAction, string> = {
  run_daily: "manual_only_v1: run npm run local:daily from the Solpient project root",
  refresh_prices: "manual_only_v1: run node scripts/sync-market-history.mjs --solpient-100",
  refresh_sec: "pending_adapter: local SEC refresh script not bound",
  retry_failed: "pending_chatgpt_engine: retry queue not wired",
  recalculate_rankings: "manual_only_v1: run npm run rankings:refresh then npm run lists:refresh",
};

export function runOperatorAction(action: OperatorAction): OperatorResult {
  return { ok: false, action, reason: REASONS[action] };
}
