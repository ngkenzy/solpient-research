"use client";

import { useEffect, useState } from "react";

type WatchItem = {
  ticker: string;
  name: string;
  href: string;
};

type AlertPrefs = {
  smartMoney: boolean;
  congress: boolean;
  insiders: boolean;
  research: boolean;
  decision: boolean;
};

const WATCHLIST_KEY = "solpient.watchlist";
const ALERTS_KEY = "solpient.alerts";

function readWatchlist(): WatchItem[] {
  try {
    return JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function readAlerts(): Record<string, AlertPrefs> {
  try {
    return JSON.parse(localStorage.getItem(ALERTS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

const defaultPrefs: AlertPrefs = {
  smartMoney: true,
  congress: true,
  insiders: true,
  research: true,
  decision: true,
};

export function ResearchControls({ ticker, name }: { ticker: string; name: string }) {
  const [watched, setWatched] = useState(false);
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<AlertPrefs>(defaultPrefs);
  const [permission, setPermission] = useState<string>("default");

  useEffect(() => {
    const list = readWatchlist();
    setWatched(list.some((item) => item.ticker === ticker));
    const allPrefs = readAlerts();
    setPrefs(allPrefs[ticker] ?? defaultPrefs);
    if ("Notification" in window) setPermission(Notification.permission);
  }, [ticker]);

  function toggleWatchlist() {
    const list = readWatchlist();
    const exists = list.some((item) => item.ticker === ticker);
    const next = exists
      ? list.filter((item) => item.ticker !== ticker)
      : [...list, { ticker, name, href: "/research/" + ticker }];
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
    setWatched(!exists);
  }

  function updatePref(key: keyof AlertPrefs) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    const allPrefs = readAlerts();
    allPrefs[ticker] = next;
    localStorage.setItem(ALERTS_KEY, JSON.stringify(allPrefs));
  }

  async function enableNotifications() {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    const nextPermission = await Notification.requestPermission();
    setPermission(nextPermission);
  }

  return (
    <div className="researchControls">
      <button className={"researchControlButton " + (watched ? "active" : "")} onClick={toggleWatchlist}>
        <span>{watched ? "★" : "☆"}</span>
        {watched ? "Watchlisted" : "Add to watchlist"}
      </button>

      <button className={"researchControlButton " + (open ? "active" : "")} onClick={() => setOpen(!open)}>
        <span>◉</span>
        Alerts
      </button>

      {open ? (
        <div className="alertPopover">
          <div className="alertPopoverHeader">
            <div>
              <strong>{ticker} alerts</strong>
              <span>Choose which disclosures you want to track.</span>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close alert settings">×</button>
          </div>

          <div className="alertToggleList">
            {[
              ["smartMoney", "Smart money", "13F holder changes and notable fund activity"],
              ["congress", "Political trades", "Newly disclosed political purchases and sales"],
              ["insiders", "Insiders", "Open-market Form 4 purchases and sales"],
              ["research", "Research", "New SOLPIENT research versions and thesis changes"],
              ["decision", "Decision triggers", "Margin-of-safety, required-return, and thesis-review conditions"],
            ].map(([key, label, detail]) => {
              const prefKey = key as keyof AlertPrefs;
              return (
                <button className="alertToggleRow" onClick={() => updatePref(prefKey)} key={key}>
                  <div>
                    <strong>{label}</strong>
                    <span>{detail}</span>
                  </div>
                  <i className={prefs[prefKey] ? "toggleOn" : ""}><b /></i>
                </button>
              );
            })}
          </div>

          <div className="notificationState">
            <div>
              <strong>Browser notifications</strong>
              <span>
                {permission === "granted"
                  ? "Enabled on this device."
                  : permission === "denied"
                    ? "Blocked in browser settings."
                    : permission === "unsupported"
                      ? "Not supported by this browser."
                      : "Permission not granted yet."}
              </span>
            </div>
            {permission !== "granted" && permission !== "unsupported" ? (
              <button onClick={enableNotifications}>Enable</button>
            ) : null}
          </div>

          <p className="alertDeliveryNote">
            Preferences are saved on this device. True background delivery will activate when the
            live disclosures feed and push/email provider are connected.
          </p>
        </div>
      ) : null}
    </div>
  );
}
