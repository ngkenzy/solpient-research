import Link from "next/link";
import { AlertsClient } from "./AlertsClient";
import { AutoMonitorFeed } from "@/components/AutoMonitorFeed";

export default function AlertsPage() {
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
        <span className="panelKicker">MONITORING</span>
        <h1>Alerts</h1>
        <p className="utilityLede">
          Choose the evidence that matters to you: research changes, institutional holdings,
          political transaction disclosures, and insider activity.
        </p>
        <AutoMonitorFeed />
        <AlertsClient />
      </main>
    </>
  );
}
