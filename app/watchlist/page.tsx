import Link from "next/link";
import { WatchlistClient } from "./WatchlistClient";

export default function WatchlistPage() {
  return (
    <>
      <header className="siteHeader">
        <Link className="brand" href="/">
          <strong>SOLPIENT</strong>
          <span>Research</span>
        </Link>
        <nav>
          <Link href="/research">Rankings</Link>
          <Link href="/watchlist">Watchlist</Link>
          <Link href="/alerts">Alerts</Link>
        </nav>
      </header>

      <main className="utilityShell">
        <span className="panelKicker">PERSONAL RESEARCH</span>
        <h1>Watchlist</h1>
        <p className="utilityLede">
          Keep the companies you care about in one place. Your current watchlist is stored on this device.
        </p>
        <WatchlistClient />
      </main>
    </>
  );
}
