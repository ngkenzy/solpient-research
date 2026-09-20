"use client";

import { useEffect, useState } from "react";

type WatchItem = { ticker: string; name: string; href: string };
type AlertPrefs = {
  smartMoney: boolean;
  congress: boolean;
  insiders: boolean;
  research: boolean;
};

const WATCHLIST_KEY = "solpient.watchlist";
const ALERTS_KEY = "solpient.alerts";

const defaults: AlertPrefs = {
  smartMoney: true,
  congress: true,
  insiders: true,
  research: true,
};

export function AlertsClient() {
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [prefs, setPrefs] = useState<Record<string, AlertPrefs>>({});
  const [permission, setPermission] = useState<string>("default");

  useEffect(() => {
    try {
      setWatchlist(JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? "[]"));
      setPrefs(JSON.parse(localStorage.getItem(ALERTS_KEY) ?? "{}"));
    } catch {
      setWatchlist([]);
      setPrefs({});
    }
    if ("Notification" in window) setPermission(Notification.permission);
  }, []);

  function toggle(ticker: string, key: keyof AlertPrefs) {
    const current = prefs[ticker] ?? defaults;
    const nextPrefs = { ...prefs, [ticker]: { ...current, [key]: !current[key] } };
    setPrefs(nextPrefs);
    localStorage.setItem(ALERTS_KEY, JSON.stringify(nextPrefs));
  }

  async function enableNotifications() {
    if (!("Notification" in window)) return;
    const next = await Notification.requestPermission();
    setPermission(next);
  }

  return (
    <>
      <section className="alertStatusCard">
        <div>
          <span>DELIVERY STATUS</span>
          <strong>Preferences ready · background feed pending</strong>
          <p>
            Watchlist and alert rules work now. Live push/email delivery requires a disclosure feed
            and notification provider before SOLPIENT can check for new filings while the app is closed.
          </p>
        </div>
        <button onClick={enableNotifications} disabled={permission === "granted"}>
          {permission === "granted" ? "Browser enabled" : "Enable browser notifications"}
        </button>
      </section>

      {watchlist.length === 0 ? (
        <section className="emptyState">
          <strong>No companies are being watched yet.</strong>
          <p>Add companies to your watchlist first, then their alert rules will appear here.</p>
        </section>
      ) : (
        <section className="alertCompanyList">
          {watchlist.map((item) => {
            const current = prefs[item.ticker] ?? defaults;
            return (
              <article className="alertCompanyCard" key={item.ticker}>
                <div className="alertCompanyHeader">
                  <div className="companyMonogram">{item.ticker.slice(0, 2)}</div>
                  <div>
                    <span>{item.ticker}</span>
                    <strong>{item.name}</strong>
                  </div>
                </div>
                <div className="alertRuleGrid">
                  {([
                    ["smartMoney", "Smart money"],
                    ["congress", "Political trades"],
                    ["insiders", "Insiders"],
                    ["research", "Research changes"],
                  ] as Array<[keyof AlertPrefs, string]>).map(([key, label]) => (
                    <button onClick={() => toggle(item.ticker, key)} key={key}>
                      <span>{label}</span>
                      <i className={current[key] ? "toggleOn" : ""}><b /></i>
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}
