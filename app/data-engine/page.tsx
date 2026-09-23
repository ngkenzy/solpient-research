import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";
import { getDataEngineSnapshot } from "@/lib/data-engine/store";
import { DataEngineClient } from "./DataEngineClient";
import styles from "./data-engine.module.css";

export const dynamic = "force-dynamic";

export default async function DataEnginePage() {
  const snapshot = await getDataEngineSnapshot();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <SolpientBrand />
        <nav className={styles.sideNav}>
          <Link href="/">Home</Link>
          <Link href="/research">Research</Link>
          <Link href="/research-health">Research Health</Link>
          <Link className={styles.active} href="/data-engine">
            Data Engine
          </Link>
          <Link href="/review">Review</Link>
          <Link href="/watchlist">Watchlist</Link>
          <Link href="/alerts">Alerts</Link>
        </nav>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <span className={styles.kicker}>SOLPIENT OPERATIONS</span>
            <h1>Data Engine Control Center</h1>
            <p>Monitors the daily pipeline. Does not rank stocks. Does not publish research.</p>
          </div>
          <div className={`${styles.healthPill} ${styles[snapshot.health.state]}`}>
            {snapshot.health.state.toUpperCase()}
          </div>
        </header>

        {snapshot.health.banner ? <div className={styles.banner}>{snapshot.health.banner}</div> : null}

        <DataEngineClient snapshot={snapshot} />
      </main>
    </div>
  );
}
