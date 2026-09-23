import type { OperatorAction, OperatorResult } from "./types";

const REASONS: Record<OperatorAction, string> = {
  run_daily: "pending_chatgpt_engine: npm run solpient:daily is not wired",
  refresh_prices: "pending_adapter: local price refresh script not bound",
  refresh_sec: "pending_adapter: local SEC refresh script not bound",
  retry_failed: "pending_chatgpt_engine: retry queue not wired",
  recalculate_rankings: "pending_chatgpt_engine: ranking snapshot writer not wired",
};

export function runOperatorAction(action: OperatorAction): OperatorResult {
  return { ok: false, action, reason: REASONS[action] };
}
