import type { ResearchAIPack } from "@/lib/research-ai-pack";

export const LOCAL_RESEARCH_MODEL_ID = "Qwen2.5-3B-Instruct-q4f16_1-MLC";

export type LocalResearchAIProgress = {
  progress: number;
  text: string;
};

type LocalEngine = Awaited<
  ReturnType<typeof import("@mlc-ai/web-llm")["CreateWebWorkerMLCEngine"]>
>;

let enginePromise: Promise<LocalEngine> | null = null;
let loadedEngine: LocalEngine | null = null;

export function localResearchAISupported() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
}

export function localResearchModelLabel() {
  return "Qwen2.5 3B · Browser-local";
}

export async function loadLocalResearchAI(
  onProgress?: (report: LocalResearchAIProgress) => void,
) {
  if (!localResearchAISupported()) {
    throw new Error("WebGPU is not available in this browser.");
  }
  if (loadedEngine) {
    onProgress?.({ progress: 1, text: "Private research AI ready" });
    return loadedEngine;
  }
  if (!enginePromise) {
    enginePromise = (async () => {
      const webllm = await import("@mlc-ai/web-llm");
      const worker = new Worker(
        new URL("./local-research-ai.worker.ts", import.meta.url),
        { type: "module" },
      );
      const engine = await webllm.CreateWebWorkerMLCEngine(
        worker,
        LOCAL_RESEARCH_MODEL_ID,
        {
          initProgressCallback: (report) => {
            onProgress?.({
              progress:
                typeof report.progress === "number"
                  ? Math.max(0, Math.min(1, report.progress))
                  : 0,
              text: report.text || "Loading private research AI…",
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
    "You are Ask Solpient, a private equity-research explanation assistant running locally in the user's browser.",
    "Use only the supplied Solpient research pack.",
    "Published research fields (research, scores, valuation, metrics, thesis, changes, triggers, sources) are authoritative.",
    "systemContext contains current workflow metadata such as Solpient 100 screening, ranking, and readiness. Treat it as workflow context, not as a replacement for published research.",
    "Do not present candidate-pipeline or Valuation V3 development outputs as official published valuation unless they are explicitly present in the authoritative published research fields.",
    "Do not calculate or replace financial metrics, valuation outputs, scores, trigger states, or thesis states.",
    "Never invent missing facts. If the pack does not support a claim, say the evidence is unavailable.",
    "Explain the investment case, risks, valuation assumptions, thesis changes, and decision triggers clearly.",
    "If asked for a buy/sell/hold instruction, explain the relevant evidence and tradeoffs instead of issuing a personalized order.",
    "When a claim is supported by a listed source, cite its source reference exactly like [S1].",
    "Keep answers concise, evidence-led, and under 260 words unless the user explicitly asks for more detail.",
  ].join(" ");
}

export async function askLocalResearchAI(
  question: string,
  pack: ResearchAIPack,
  onProgress?: (report: LocalResearchAIProgress) => void,
) {
  const engine = await loadLocalResearchAI(onProgress);
  const response = await engine.chat.completions.create({
    messages: [
      { role: "system", content: systemPrompt() },
      {
        role: "user",
        content: [
          "Question:",
          question.slice(0, 1000),
          "",
          "Structured Solpient research pack:",
          JSON.stringify(pack),
        ].join("\n"),
      },
    ],
    temperature: 0.1,
    max_tokens: 520,
  });
  const output = response.choices?.[0]?.message?.content;
  if (typeof output === "string" && output.trim()) return output.trim();
  throw new Error("The local research model returned an empty response.");
}
