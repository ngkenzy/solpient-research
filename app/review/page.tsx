import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";
import { getAdminSupabase } from "@/lib/admin-supabase";
import { requireReviewAccess } from "@/lib/review-auth";
import { logoutReviewAction } from "./actions";
import styles from "./review.module.css";

export const dynamic="force-dynamic";
export const runtime="nodejs";
const pct=(value:unknown)=>Number.isFinite(Number(value))?Number(value).toFixed(1)+"%":"—";

export default async function ReviewQueue() {
  await requireReviewAccess();
  const supabase=getAdminSupabase();
  if (!supabase) return null;

  const [draftResult,companyResult,reviewResult]=await Promise.all([
    supabase.from("baseline_drafts").select("id,company_id,generation_version,generated_at,source_cutoff_at,industry_module,status,evidence_completeness_pct,standard_status,published_run_id").order("generated_at",{ascending:false}),
    supabase.from("companies").select("id,ticker,company_name"),
    supabase.from("baseline_reviews").select("draft_id,status,promotion_readiness,reviewed_at,published_run_id"),
  ]);
  if (draftResult.error) throw draftResult.error;
  const companies=new Map((companyResult.data ?? []).map((row:any)=>[row.id,row]));
  const reviews=new Map((reviewResult.data ?? []).map((row:any)=>[row.draft_id,row]));

  return <>
    <header className={styles.header}>
      <SolpientBrand subtitle="Review workbench" />
      <div><Link href="/">Public research</Link><form action={logoutReviewAction}><button type="submit">Lock</button></form></div>
    </header>
    <main className={styles.shell}>
      <section className={styles.hero}>
        <div><span className={styles.kicker}>BASELINE FACTORY → HUMAN REVIEW</span><h1>Research promotion queue</h1>
          <p>Draft evidence can be inspected and edited here, but only a complete, source-verified package can become published research.</p>
        </div>
        <div className={styles.heroStat}><span>Drafts</span><strong>{draftResult.data?.length ?? 0}</strong></div>
      </section>
      <section className={styles.queue}>
        {(draftResult.data ?? []).map((draft:any)=>{
          const company:any=companies.get(draft.company_id);
          const review:any=reviews.get(draft.id);
          const ready=Boolean(review?.promotion_readiness?.ready);
          return <Link className={styles.queueRow} href={"/review/"+draft.id} key={draft.id}>
            <div className={styles.companyMark}>{company?.ticker?.slice(0,2) ?? "—"}</div>
            <div className={styles.companyCopy}><strong>{company?.ticker ?? "Unknown"} · {company?.company_name ?? "Company"}</strong><span>{draft.industry_module?.replaceAll("_"," ") ?? "module pending"}</span></div>
            <div className={styles.queueMetric}><span>Evidence</span><strong>{pct(draft.evidence_completeness_pct)}</strong></div>
            <div className={styles.queueMetric}><span>Standard</span><strong>{draft.standard_status ?? "partial"}</strong></div>
            <div className={styles.queueMetric}><span>Review</span><strong className={ready?styles.readyText:styles.pendingText}>{draft.status==="promoted"?"promoted":ready?"ready":review?.status ?? "not started"}</strong></div>
            <span className={styles.openArrow}>→</span>
          </Link>;
        })}
        {!draftResult.data?.length?<div className={styles.empty}>No factory drafts are waiting for review.</div>:null}
      </section>
    </main>
  </>;
}
