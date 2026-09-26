"use client";

import { useMemo, useState } from "react";
import styles from "@/app/command-center/home.module.css";

export type CapitalActivityItem = {
  id: string;
  ticker: string;
  company: string;
  category: "insiders" | "investors" | "congress";
  actor: string;
  action: string;
  detail: string;
  dateLabel: string;
  sourceUrl: string;
  tone: "positive" | "negative" | "neutral";
};

const tabs = [
  ["all", "All activity"],
  ["insiders", "Insiders"],
  ["investors", "Notable investors"],
  ["congress", "Congressional"],
] as const;

export function CapitalActivity({ items }: { items: CapitalActivityItem[] }) {
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("all");

  const visible = useMemo(
    () => (tab === "all" ? items : items.filter((item) => item.category === tab)),
    [items, tab],
  );

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <span className={styles.panelEyebrow}>DISCLOSED CAPITAL ACTIVITY</span>
          <h2>Who is buying, selling, or changing exposure</h2>
        </div>
        <span className={styles.sourceNote}>Evidence, not a recommendation</span>
      </div>

      <div className={styles.activityTabs} role="tablist" aria-label="Capital activity filters">
        {tabs.map(([key, label]) => (
          <button
            className={tab === key ? styles.activeTab : ""}
            key={key}
            onClick={() => setTab(key)}
            role="tab"
            aria-selected={tab === key}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.activityList}>
        {visible.length ? (
          visible.slice(0, 7).map((item) => (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className={styles.activityRow}
              key={item.id}
            >
              <div className={styles.tickerMark}>{item.ticker}</div>
              <div className={styles.activityBody}>
                <div>
                  <strong>{item.actor}</strong>
                  <span>{item.company}</span>
                </div>
                <p>{item.detail}</p>
                <small>{item.dateLabel}</small>
              </div>
              <span className={styles[item.tone]}>{item.action}</span>
            </a>
          ))
        ) : (
          <div className={styles.emptyCompact}>
            No tracked activity in this category yet.
          </div>
        )}
      </div>

      <p className={styles.disclosureNote}>
        13F and political disclosures can arrive well after the underlying transaction. Solpient
        keeps transaction/report dates separate from disclosure dates.
      </p>
    </section>
  );
}
