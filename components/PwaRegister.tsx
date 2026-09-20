"use client";

import { useEffect } from "react";

type MonitorEvent = {
  id: string;
  ticker: string;
  label: string;
  reason: string;
  category: string;
};

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
};

const WATCHLIST_KEY = "solpient.watchlist";
const ALERTS_KEY = "solpient.alerts";
const SEEN_EVENTS_KEY = "solpient.monitor.seen";

function alertKey(event: MonitorEvent): keyof AlertPrefs {
  if (event.category === "insider_filing") return "insiders";
  if (event.category === "institutional_filing") return "smartMoney";
  return "research";
}

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {});

    async function surfaceUnseenEvents() {
      if (!("Notification" in window) || Notification.permission !== "granted") return;

      let watchlist: WatchItem[] = [];
      let prefs: Record<string, AlertPrefs> = {};
      let seen: string[] = [];

      try {
        watchlist = JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? "[]");
        prefs = JSON.parse(localStorage.getItem(ALERTS_KEY) ?? "{}");
        seen = JSON.parse(localStorage.getItem(SEEN_EVENTS_KEY) ?? "[]");
      } catch {
        return;
      }

      if (watchlist.length === 0) return;

      const watched = new Set(watchlist.map((item) => item.ticker));
      const seenSet = new Set(seen);

      const response = await fetch("/api/monitor-events", { cache: "no-store" });
      if (!response.ok) return;

      const payload = await response.json();
      const events = (payload.events ?? []) as MonitorEvent[];
      const registration = await navigator.serviceWorker.ready;

      for (const event of events.slice(0, 30)) {
        if (seenSet.has(event.id) || !watched.has(event.ticker)) continue;

        const companyPrefs = prefs[event.ticker] ?? {
          smartMoney: true,
          congress: true,
          insiders: true,
          research: true,
        };

        if (!companyPrefs[alertKey(event)]) continue;

        await registration.showNotification("SOLPIENT · " + event.ticker, {
          body: event.label + " — " + event.reason,
          icon: "/icon.svg",
          badge: "/icon.svg",
          data: { url: "/research/" + event.ticker },
        });

        seenSet.add(event.id);
      }

      localStorage.setItem(SEEN_EVENTS_KEY, JSON.stringify(Array.from(seenSet).slice(-300)));
    }

    surfaceUnseenEvents().catch(() => {});
  }, []);

  return null;
}
