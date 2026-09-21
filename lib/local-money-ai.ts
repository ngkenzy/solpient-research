import type { CoachSummary } from "@/lib/money-v2";

export const LOCAL_MODEL_ID = "Qwen2.5-3B-Instruct-q4f16_1-MLC";

export type LocalAIProgress = {
  progress: number;
  text: string;
};

type LocalEngine = Awaited<
  ReturnType<typeof import("@mlc-ai/web-llm")["CreateWebWorkerMLCEngine"]>
>;

let enginePromise: Promise<LocalEngine> | null = null;
let loadedEngine: LocalEngine | null = null;

export function localAISupported() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
}

export function localAIModelLabel() {
  return "Qwen2.5 3B · Private";
}

export async function loadLocalMoneyAI(
  onProgress?: (report: LocalAIProgress) => void,
) {
  if (!localAISupported()) {
    throw new Error("WebGPU is not available in this browser.");
  }

  if (loadedEngine) {
    onProgress?.({ progress: 1, text: "Private AI ready" });
    return loadedEngine;
  }

  if (!enginePromise) {
    enginePromise = (async () => {
      const webllm = await import("@mlc-ai/web-llm");
      const worker = new Worker(
        new URL("./local-money-ai.worker.ts", import.meta.url),
        { type: "module" },
      );
      const engine = await webllm.CreateWebWorkerMLCEngine(
        worker,
        LOCAL_MODEL_ID,
        {
          initProgressCallback: (report) => {
            onProgress?.({
              progress:
                typeof report.progress === "number"
                  ? Math.max(0, Math.min(1, report.progress))
                  : 0,
              text: report.text || "Loading Private AI…",
            });
          },
          logLevel: "WARN",
        },
      );
      loadedEngine = engine;
      return engine;
    })().catch((error) => {
      enginePromise = null;
      loadedEngine = null;
      throw error;
    });
  }

  return enginePromise;
}

function systemPrompt() {
  return [
    "You are Solpient Private AI, a local financial-plan explanation assistant running entirely in the user's browser.",
    "The deterministic Solpient engine has already calculated the financial plan. Treat supplied actions and numbers as authoritative.",
    "Explain the plan clearly and concisely. Do not recalculate, override, or invent numeric recommendations.",
    "Do not recommend individual stocks, securities, tax maneuvers, legal actions, loans, or credit products.",
    "Do not claim certainty about investment returns.",
    "When the user asks whether to invest more, explain the tradeoff using the supplied cash flow, liquidity, debt APR, goals, and action sequence.",
    "If information is missing, identify the missing input rather than guessing.",
    "Keep the answer under 180 words.",
  ].join(" ");
}

export function buildRulesMoneyExplanation(
  question: string,
  summary: CoachSummary,
) {
  const first = summary.actions[0];
  if (!first) {
    return "Solpient does not have enough information to build a normal allocation sequence yet. Add or review monthly income, spending, liquid cash, debt, and goals first.";
  }

  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(first.amount);

  const context =
    summary.highestConsumerApr >= 10
      ? " Your highest consumer debt rate is " +
        summary.highestConsumerApr.toFixed(1) +
        "%, which can materially affect the priority order."
      : summary.emergencyMonths < 3
        ? " Your liquid reserve is " +
          summary.emergencyMonths.toFixed(1) +
          " months, so liquidity remains important."
        : "";

  return (
    "Your current first action is " +
    first.title.toLowerCase() +
    " at about " +
    amount +
    ". " +
    first.reason +
    context +
    " The deterministic engine resolves liquidity, employer match, expensive debt, retirement, and dated goals before optional long-term investing. Your question was: " +
    question.slice(0, 240)
  );
}

export async function askLocalMoneyAI(
  question: string,
  summary: CoachSummary,
  onProgress?: (report: LocalAIProgress) => void,
) {
  const engine = await loadLocalMoneyAI(onProgress);

  const response = await engine.chat.completions.create({
    messages: [
      { role: "system", content: systemPrompt() },
      {
        role: "user",
        content: [
          "Question:",
          question.slice(0, 600),
          "",
          "Privacy-safe Solpient financial summary:",
          JSON.stringify(summary),
        ].join("\n"),
      },
    ],
    temperature: 0.2,
    max_tokens: 320,
  });

  const output = response.choices?.[0]?.message?.content;
  if (typeof output === "string" && output.trim()) {
    return output.trim();
  }

  throw new Error("The local model returned an empty response.");
}
