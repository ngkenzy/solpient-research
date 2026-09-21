import { NextResponse } from "next/server";

export const runtime = "nodejs";

type CoachRequest = {
  question?: string;
  summary?: {
    score?: number;
    scoreLabel?: string;
    netWorth?: number;
    liquidCash?: number;
    monthlyIncome?: number;
    monthlyExpenses?: number;
    freeCashFlow?: number;
    emergencyMonths?: number;
    highestConsumerApr?: number;
    totalDebt?: number;
    activeGoalCount?: number;
    actions?: Array<{
      title?: string;
      amount?: number;
      reason?: string;
      kind?: string;
    }>;
    topSpending?: Array<{
      category?: string;
      amount?: number;
      share?: number;
    }>;
  };
};

const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function sanitize(body: CoachRequest) {
  const summary = body.summary ?? {};
  return {
    question: String(body.question ?? "").trim().slice(0, 600),
    summary: {
      score: number(summary.score),
      scoreLabel: String(summary.scoreLabel ?? "").slice(0, 40),
      netWorth: number(summary.netWorth),
      liquidCash: number(summary.liquidCash),
      monthlyIncome: number(summary.monthlyIncome),
      monthlyExpenses: number(summary.monthlyExpenses),
      freeCashFlow: number(summary.freeCashFlow),
      emergencyMonths: number(summary.emergencyMonths),
      highestConsumerApr: number(summary.highestConsumerApr),
      totalDebt: number(summary.totalDebt),
      activeGoalCount: number(summary.activeGoalCount),
      actions: (summary.actions ?? []).slice(0, 8).map((action) => ({
        title: String(action.title ?? "").slice(0, 120),
        amount: number(action.amount),
        reason: String(action.reason ?? "").slice(0, 350),
        kind: String(action.kind ?? "").slice(0, 30),
      })),
      topSpending: (summary.topSpending ?? []).slice(0, 5).map((item) => ({
        category: String(item.category ?? "").slice(0, 60),
        amount: number(item.amount),
        share: number(item.share),
      })),
    },
  };
}

function fallbackAnswer(data: ReturnType<typeof sanitize>) {
  const { summary, question } = data;
  const first = summary.actions[0];
  const questionText = question ? " On your question, " + question.toLowerCase() : "";

  if (!first) {
    return (
      "Solpient does not have enough positive monthly surplus to build a normal allocation sequence yet." +
      questionText +
      " The first objective is to make monthly cash flow reliably positive, then re-run the plan."
    );
  }

  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(first.amount);

  return (
    "The plan starts with " +
    first.title.toLowerCase() +
    " at about " +
    amount +
    " this month. " +
    first.reason +
    " Solpient ranks this ahead of later actions because the deterministic engine resolves liquidity, employer-match, expensive debt, retirement, and dated goals before optional long-term investing." +
    questionText
  );
}

function extractOutputText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type !== "message") continue;
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content?.text === "string") {
        return content.text.trim();
      }
    }
  }
  return "";
}

export async function POST(request: Request) {
  let body: CoachRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const data = sanitize(body);
  if (!data.question) {
    return NextResponse.json({ error: "Ask Solpient a question first." }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      answer: fallbackAnswer(data),
      source: "rules",
      model: null,
    });
  }

  const instructions = [
    "You are the Solpient Money coach.",
    "Explain an already-computed deterministic household financial plan in clear, concise language.",
    "Never change, override, or invent the numeric plan. The supplied actions are authoritative.",
    "Do not recommend individual stocks, securities, tax maneuvers, legal actions, or credit products.",
    "Do not claim certainty about future returns.",
    "When useful, explain tradeoffs and identify what user input would materially change the plan.",
    "Use no more than 180 words.",
  ].join(" ");

  const prompt = [
    "User question:",
    data.question,
    "",
    "Privacy-safe financial summary:",
    JSON.stringify(data.summary),
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        store: false,
        instructions,
        input: prompt,
        max_output_tokens: 500,
        reasoning: { effort: "low" },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({
        answer: fallbackAnswer(data),
        source: "rules",
        model: null,
      });
    }

    const payload = await response.json();
    const answer = extractOutputText(payload) || fallbackAnswer(data);

    return NextResponse.json({
      answer,
      source: "ai",
      model: "gpt-5.6-luna",
    });
  } catch {
    return NextResponse.json({
      answer: fallbackAnswer(data),
      source: "rules",
      model: null,
    });
  }
}
