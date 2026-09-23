"use client";

import Link from "next/link";
import { useState } from "react";
import type { DataEngineSnapshot, OperatorAction, OperatorResult } from "@/lib/data-engine/types";
import styles from "./data-engine.module.css";

const ACTIONS: { action: OperatorAction; label: string }[] = [
  { action: "run_daily", label: "Run Daily Pipeline" },
  { action: "refresh_prices", label: "Refresh Prices" },
  { action: "refresh_sec", label: "Refresh SEC Data" },
  { action: "retry_failed", label: "Retry Failed Tickers" },
  { action: "recalculate_rankings", label: "Recalculate Rankings" },
];

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ms(value: number | null | undefined) {
  if (value == null) return "—";
  return `${Math.round(value / 1000)}s`;
}

export function DataEngineClient({ snapshot }: { snapshot: DataEngineSnapshot }) {
  const [notice, setNotice] = useState<OperatorResult | null>(null);
  const [busy, setBusy] = useState<OperatorAction | null>(null);

  async function operate(action: OperatorAction) {
    setBusy(action);
    const response = await fetch("/api/data-engine/operator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = (await response.json()) as OperatorResult;
    setNotice(body);
    setBusy(null);
  }

  return (
    <>
      {notice ? (
        <p className={styles.notice}>
          {notice.action}: {notice.reason}
        </p>
      ) : null}

      <section className={styles.controls}>
        {ACTIONS.map((item) => (
          <button key={item.action} type="button" disabled={busy === item.action} onClick={() => operate(item.action)}>
            {item.label}
          </button>
        ))}
        <Link className={styles.reviewLink} href="/review">
          Open Review Queue
        </Link>
      </section>

      <section className={styles.grid4}>
        <article>
          <span>Last successful</span>
          <strong>{snapshot.health.lastSuccessfulRunId ?? "—"}</strong>
          <small>{fmt(snapshot.health.lastSuccessfulAt)}</small>
        </article>
        <article>
          <span>Current run</span>
          <strong>{snapshot.health.currentRunId ?? "—"}</strong>
          <small>{snapshot.latestRun?.state ?? "none"}</small>
        </article>
        <article>
          <span>Methodology</span>
          <strong>{snapshot.health.methodologyVersion}</strong>
          <small>{snapshot.health.inputHash ?? "hash pending"}</small>
        </article>
        <article>
          <span>Adapter</span>
          <strong>{snapshot.adapter === "local_postgres" ? "LOCAL POSTGRES" : "PENDING ENGINE"}</strong>
          <small>{snapshot.adapter}</small>
        </article>
      </section>

      <section className={styles.panel}>
        <h2>Universe</h2>
        <div className={styles.counters}>
          {Object.entries(snapshot.universe).map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <strong>{value.toLocaleString()}</strong>
            </div>
          ))}
          <div>
            <span>Solpient 100</span>
            <strong>{snapshot.ranking.solpient100}</strong>
          </div>
          <div>
            <span>Solpient 20</span>
            <strong>{snapshot.ranking.solpient20}</strong>
          </div>
          <div>
            <span>Solpient 5</span>
            <strong>{snapshot.ranking.solpient5}</strong>
          </div>
        </div>
        <p className={styles.note}>{snapshot.ranking.note}</p>
      </section>

      <section className={styles.panel}>
        <h2>Freshness</h2>
        <div className={styles.freshness}>
          {snapshot.freshness.map((row) => (
            <div key={row.key}>
              <span>{row.label}</span>
              <strong className={styles[row.status.toLowerCase()] ?? ""}>{row.status}</strong>
              <small>{fmt(row.asOf)}</small>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Pipeline stages</h2>
        <ol className={styles.stages}>
          {(snapshot.latestRun?.stages ?? []).map((stage) => (
            <li key={stage.name} className={styles[stage.status]}>
              <strong>{stage.label}</strong>
              <span>{stage.status}</span>
              <span>
                {stage.recordsSucceeded}/{stage.recordsProcessed} ok · {stage.recordsFailed} fail
              </span>
              <span>{ms(stage.durationMs)}</span>
              {stage.error ? <em>{stage.error}</em> : null}
            </li>
          ))}
        </ol>
      </section>

      <Attention title="Failed tickers" rows={snapshot.failedTickers} />
      <Attention title="Stale tickers" rows={snapshot.staleTickers} />
      <Attention title="Missing fundamentals" rows={snapshot.missingFundamentals} />
      <Attention title="Missing prices" rows={snapshot.missingPrices} />
      <Attention title="Sector issues" rows={snapshot.sectorIssues} />

      <section className={styles.panel}>
        <h2>Research requiring review</h2>
        {snapshot.reviewQueue.map((item) => (
          <Link key={item.id} href={item.href} className={styles.rowLink}>
            {item.ticker} · {item.versionLabel} — {item.reason}
          </Link>
        ))}
      </section>

      <section className={styles.panel}>
        <h2>Material changes</h2>
        {snapshot.materialChanges.map((item) => (
          <div key={item.ticker + item.detectedAt} className={styles.change}>
            <strong>{item.ticker}</strong> {item.title}
            <p>{item.summary}</p>
            {item.requiresReview ? <span>REVIEW REQUIRED — not published</span> : null}
          </div>
        ))}
      </section>

      <section className={styles.panel}>
        <h2>Pipeline history</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Run</th>
              <th>State</th>
              <th>Auth</th>
              <th>100</th>
              <th>20</th>
              <th>5</th>
              <th>Fail</th>
              <th>Runtime</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.history.map((run) => (
              <tr key={run.id} className={run.authoritative ? styles.auth : styles.notAuth}>
                <td>{run.runDate}</td>
                <td>{run.id}</td>
                <td>{run.state}</td>
                <td>{run.authoritative ? "YES" : "NO"}</td>
                <td>{run.solpient100Count}</td>
                <td>{run.solpient20Count}</td>
                <td>{run.solpient5Count}</td>
                <td>{run.failureCount}</td>
                <td>{ms(run.runtimeMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Attention({
  title,
  rows,
}: {
  title: string;
  rows: { ticker: string; companyName: string; detail: string }[];
}) {
  return (
    <section className={styles.panel}>
      <h2>{title}</h2>
      {rows.length === 0 ? <p className={styles.note}>None.</p> : null}
      {rows.map((row) => (
        <Link key={row.ticker} href={`/research/${row.ticker}`} className={styles.rowLink}>
          {row.ticker} · {row.companyName} — {row.detail}
        </Link>
      ))}
    </section>
  );
}
