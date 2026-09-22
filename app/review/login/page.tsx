import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";
import { reviewAccessConfigured } from "@/lib/review-auth";
import { unlockReviewAction } from "../actions";
import styles from "../review.module.css";

export const dynamic="force-dynamic";
export const runtime="nodejs";

export default async function ReviewLogin({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const params=await searchParams;
  const configured=reviewAccessConfigured();
  return <main className={styles.loginShell}>
    <div className={styles.loginCard}>
      <SolpientBrand subtitle="Research review" />
      <span className={styles.kicker}>INTERNAL WORKBENCH</span>
      <h1>Review access</h1>
      <p>Factory drafts stay private until a reviewed package passes the SOLPIENT Research Standard and is deliberately promoted.</p>
      {!configured ? <div className={styles.setupNotice}>
        <strong>Workbench access is not configured for this deployment.</strong>
        <span>Add server-only <code>REVIEW_WORKBENCH_KEY</code> and configure <code>SOLPIENT_DATABASE_URL</code>. During migration, a Supabase admin key remains an accepted fallback.</span>
      </div> : <form action={unlockReviewAction} className={styles.loginForm}>
        <label htmlFor="key">Workbench key</label>
        <input id="key" name="key" type="password" autoComplete="current-password" required />
        {params.error?<span className={styles.errorText}>Access key was not accepted.</span>:null}
        <button type="submit">Unlock review queue</button>
      </form>}
      <Link className={styles.backLink} href="/">← Back to SOLPIENT</Link>
    </div>
  </main>;
}
