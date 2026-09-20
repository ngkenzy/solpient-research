"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type WatchItem = {
  ticker: string;
  name: string;
  href: string;
};

const WATCHLIST_KEY = "solpient.watchlist";

export function WatchlistClient() {
  const [items, setItems] = useState<WatchItem[]>([]);

  useEffect(() => {
    try {
      setItems(JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? "[]"));
    } catch {
      setItems([]);
    }
  }, []);

  function remove(ticker: string) {
    const next = items.filter((item) => item.ticker !== ticker);
    setItems(next);
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
  }

  if (items.length === 0) {
    return (
      <section className="emptyState watchlistEmpty">
        <strong>Your watchlist is empty.</strong>
        <p>Open a company research page and select “Add to watchlist.”</p>
        <Link className="landingSecondary" href="/research">Browse rankings →</Link>
      </section>
    );
  }

  return (
    <section className="watchlistGrid">
      {items.map((item) => (
        <article className="watchlistCard" key={item.ticker}>
          <Link href={item.href}>
            <div className="companyMonogram">{item.ticker.slice(0, 2)}</div>
            <span>{item.ticker}</span>
            <strong>{item.name}</strong>
            <small>Open research →</small>
          </Link>
          <button onClick={() => remove(item.ticker)}>Remove</button>
        </article>
      ))}
    </section>
  );
}
