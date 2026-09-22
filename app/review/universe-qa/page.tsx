import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";
import { UniverseQAWorkbench } from "@/components/UniverseQAWorkbench";
import { requireReviewAccess } from "@/lib/review-auth";
import styles from "../review.module.css";

export const dynamic="force-dynamic";
export const runtime="nodejs";

export default async function UniverseQAPage(){
  await requireReviewAccess();
  return <>
    <header className={styles.header}>
      <SolpientBrand subtitle="Universe QA" />
      <div>
        <Link href="/review/universe-screening">Universe Screening</Link>
        <Link href="/review/research-candidates">Research Candidates</Link>
        <Link href="/review/methodologies">Methodologies</Link>
      </div>
    </header>
    <main className={styles.shell}>
      <section className={styles.hero}>
        <div>
          <span className={styles.kicker}>PRE-MATERIALIZATION AUDIT</span>
          <h1>Trust the Top 100 only after the universe passes QA.</h1>
          <p>
            Audit sector balance, evidence ceilings, data completeness, exclusion reasons,
            duplicate issuers and suspicious score/coverage combinations before writing an
            immutable universe-screen snapshot.
          </p>
        </div>
      </section>
      <UniverseQAWorkbench />
    </main>
  </>;
}
