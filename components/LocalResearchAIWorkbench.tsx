"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  askLocalResearchAI,
  localResearchAISupported,
  localResearchModelLabel,
} from "@/lib/local-research-ai";
import type { ResearchAIPack } from "@/lib/research-ai-pack";
import styles from "./LocalResearchAIWorkbench.module.css";

const EXAMPLES = [
  "What is the weakest part of the thesis?",
  "What changed in the latest research version?",
  "Explain the valuation range and its assumptions.",
  "Which decision trigger matters most right now?",
];

export function LocalResearchAIWorkbench({ pack }: { pack: ResearchAIPack }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [question, setQuestion] = useState(EXAMPLES[0]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Not loaded");
  const [error, setError] = useState("");

  useEffect(() => {
    setSupported(localResearchAISupported());
  }, []);

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    setError("");
    setAnswer("");
    try {
      const result = await askLocalResearchAI(question.trim(), pack, (report) => {
        setProgress(report.progress);
        setStatus(report.text);
      });
      setAnswer(result);
      setProgress(1);
      setStatus("Private research AI ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Local AI failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.workbench}>
      <div className={styles.topline}>
        <div>
          <span className={styles.kicker}>ASK SOLPIENT · LOCAL AI LAB</span>
          <h2>{pack.company.ticker} private research analyst</h2>
          <p>
            Questions and the structured research pack stay in your browser during inference.
            Model weights may download to the browser when Private AI is first loaded.
          </p>
        </div>
        <div className={styles.modelCard}>
          <span>MODEL</span>
          <strong>{localResearchModelLabel()}</strong>
          <small>
            {supported === null
              ? "Checking WebGPU…"
              : supported
                ? status
                : "WebGPU unavailable"}
          </small>
        </div>
      </div>

      <div className={styles.examples}>
        {EXAMPLES.map((example) => (
          <button
            type="button"
            key={example}
            onClick={() => setQuestion(example)}
            disabled={busy}
          >
            {example}
          </button>
        ))}
      </div>

      <form onSubmit={ask} className={styles.form}>
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="Ask about the thesis, valuation, changes, risks, or decision triggers…"
        />
        <div className={styles.formFooter}>
          <div className={styles.progressWrap}>
            <div className={styles.progressTrack}>
              <span style={{ width: String(Math.round(progress * 100)) + "%" }} />
            </div>
            <small>{status}</small>
          </div>
          <button type="submit" disabled={busy || supported !== true}>
            {busy ? "Thinking locally…" : "Ask privately"}
          </button>
        </div>
      </form>

      {error ? <div className={styles.error}>{error}</div> : null}
      {answer ? (
        <div className={styles.answer}>
          <span>PRIVATE AI RESPONSE</span>
          <p>{answer}</p>
        </div>
      ) : null}

      <div className={styles.packMeta}>
        <span>Research v{pack.research.version ?? "—"}</span>
        <span>{pack.thesis.length} thesis variables</span>
        <span>{pack.changes.length} recent changes</span>
        <span>{pack.triggers.length} decision triggers</span>
        <span>{pack.sources.length} source references</span>
      </div>
    </section>
  );
}
