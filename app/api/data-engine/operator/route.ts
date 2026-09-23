import { NextResponse } from "next/server";
import { runOperatorAction } from "@/lib/data-engine/operator";
import type { OperatorAction } from "@/lib/data-engine/types";

const ACTIONS: OperatorAction[] = [
  "run_daily",
  "refresh_prices",
  "refresh_sec",
  "retry_failed",
  "recalculate_rankings",
];

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (!body.action || !ACTIONS.includes(body.action as OperatorAction)) {
    return NextResponse.json({ ok: false, action: body.action, reason: "unknown_action" }, { status: 400 });
  }
  return NextResponse.json(runOperatorAction(body.action as OperatorAction));
}
