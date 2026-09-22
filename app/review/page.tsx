import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";
import { getAdminSupabase } from "@/lib/admin-supabase";
import { requireReviewAccess } from "@/lib/review-auth";
import { buildCompanyReviewAction, logoutReviewAction, prepareV2ReviewsAction } from "./actions";
// @ts-expect-error Node ESM research helper
import { BASELINE_FACTORY_VERSION } from "@/lib/baseline-factory.mjs";
import styles from "./review.module.css";

export const dynamic="force-dynamic";
export const runtime="nodejs";

const pct=(value:unknown)=>Number.isFinite(Number(value))?Number(value).toFixed(1)+"%":"—";

function stageFor(row:any) {
  const activeDraft=row.draft&&!row.draft.published_run_id;
  if (activeDraft&&row.review?.promotion_readiness?.ready&&row.review?.human_verified_at) return {label:"Ready to publish",tone:"ready"};
  if (activeDraft&&row.review?.promotion_readiness?.ready) return {label:"Ready for verification",tone:"review"};
  if (activeDraft&&row.review) return {label:"Human review",tone:"review"};
  if (activeDraft&&row.composition) return {label:"Composer ready",tone:"composer"};
  if (activeDraft) return {label:"Draft ready",tone:"composer"};
  if (row.latestRun?.standard_version==="solpient-v2"&&row.draft?.published_run_id&&row.draft?.generation_version!==BASELINE_FACTORY_VERSION) return {label:"Rebuild analysis",tone:"backfill"};
  if (row.latestRun?.standard_version==="solpient-v2") return {label:"Published V2",tone:"published"};
  if (row.latestRun) return {label:"V2 backfill",tone:"backfill"};
  if (!row.draft && row.coverage?.status==="sufficient") return {label:"Build draft",tone:"composer"};
  return {label:"Needs data",tone:"blocked"};
}

export default async function ReviewQueue({searchParams}:{searchParams:Promise<{prepared?:string}>}) {
  await requireReviewAccess();
  const messages=await searchParams;
  const supabase=getAdminSupabase();
  if (!supabase) return null;

  const [companyResult,draftResult,reviewResult,compositionResult,runResult,coverageResult]=await Promise.all([
    supabase.from("companies").select("id,ticker,company_name").order("ticker"),
    supabase.from("baseline_drafts").select("id,company_id,generation_version,generated_at,source_cutoff_at,industry_module,status,evidence_completeness_pct,standard_status,published_run_id").order("generated_at",{ascending:false}),
    supabase.from("baseline_reviews").select("draft_id,status,promotion_readiness,reviewed_at,prepared_at,preparation_source,human_verified_at,human_verified_by,human_verified_payload_hash,attestation_version,published_run_id"),
    supabase.from("research_compositions").select("id,draft_id,company_id,engine_version,status,validation_result,generated_at").order("generated_at",{ascending:false}),
    supabase.from("research_runs").select("id,company_id,version,researched_at,standard_version,standard_status,completeness_pct").eq("status","published").order("version",{ascending:false}),
    supabase.from("data_coverage_reports").select("company_id,status,overall_pct,generated_at").order("generated_at",{ascending:false}),
  ]);
  for (const result of [companyResult,draftResult,reviewResult,compositionResult,runResult,coverageResult]) {
    if (result.error) throw result.error;
  }

  const latestByCompany=<T extends {company_id:string}>(rows:T[])=>{
    const map=new Map<string,T>();
    for (const row of rows) if (!map.has(row.company_id)) map.set(row.company_id,row);
    return map;
  };

  const draftByCompany=latestByCompany(draftResult.data ?? []);
  const compositionByCompany=latestByCompany(compositionResult.data ?? []);
  const runByCompany=latestByCompany(runResult.data ?? []);
  const coverageByCompany=latestByCompany(coverageResult.data ?? []);
  const reviewByDraft=new Map((reviewResult.data ?? []).map((row:any)=>[row.draft_id,row]));

  const rows=(companyResult.data ?? []).map((company:any)=>{
    const draft:any=draftByCompany.get(company.id);
    return {
      company,
      draft,
      review:draft?reviewByDraft.get(draft.id):null,
      composition:compositionByCompany.get(company.id),
      latestRun:runByCompany.get(company.id),
      coverage:coverageByCompany.get(company.id),
    };
  });

  const priority=(row:any)=>{
    const stage=stageFor(row).tone;
    return ({ready:0,review:1,composer:2,backfill:3,blocked:4,published:5} as Record<string,number>)[stage] ?? 9;
  };
  rows.sort((a:any,b:any)=>priority(a)-priority(b)||a.company.ticker.localeCompare(b.company.ticker));

  const publishedV2=rows.filter((row:any)=>row.latestRun?.standard_version==="solpient-v2").length;
  const ready=rows.filter((row:any)=>row.review?.promotion_readiness?.ready && row.review?.human_verified_at && row.latestRun?.standard_version!=="solpient-v2").length;
  const readyToVerify=rows.filter((row:any)=>row.review?.promotion_readiness?.ready && !row.review?.human_verified_at && row.latestRun?.standard_version!=="solpient-v2").length;
  const inReview=rows.filter((row:any)=>row.review && !row.review?.promotion_readiness?.ready && row.latestRun?.standard_version!=="solpient-v2").length;
  const composerReady=rows.filter((row:any)=>row.composition && !row.review && row.latestRun?.standard_version!=="solpient-v2").length;
  const backfill=rows.filter((row:any)=>row.latestRun && !row.draft && row.latestRun.standard_version!=="solpient-v2").length;
  const prepareCount=(compositionResult.data ?? []).filter((row:any)=>row.status==="generated" && !reviewByDraft.has(row.draft_id)).length;

  return <>
    <header className={styles.header}>
      <SolpientBrand subtitle="Research Standard V2 operations" />
      <div><Link href="/">Public research</Link><form action={logoutReviewAction}><button type="submit">Lock</button></form></div>
    </header>

    <main className={styles.shell}>
      <section className={styles.hero}>
        <div>
          <span className={styles.kicker}>RESEARCH OPERATIONS</span>
          <h1>Research Standard V2</h1>
          <p>Move the full universe from normalized evidence to reviewed, versioned research. Composer automation can prepare private drafts; only a human-reviewed package can be published.</p>
        </div>
        <div className={styles.heroProgress}>
          <span>Published V2</span>
          <strong>{publishedV2} / {rows.length}</strong>
          <div className={styles.progressTrack}><i style={{width:rows.length?((publishedV2/rows.length)*100)+"%":"0%"}} /></div>
        </div>
      </section>

      {messages.prepared?<div className={styles.successBanner}>{messages.prepared} V2 review package(s) prepared. Nothing was published automatically.</div>:null}

      <section className={styles.opsGrid}>
        <div className={styles.opsCard}><span>Published V2</span><strong>{publishedV2}</strong><small>Immutable research versions</small></div>
        <div className={styles.opsCard}><span>Ready to publish</span><strong>{ready}</strong><small>Human attestation current</small></div>
        <div className={styles.opsCard}><span>Ready to verify</span><strong>{readyToVerify}</strong><small>Promotion gates passed; human attestation pending</small></div>
        <div className={styles.opsCard}><span>Human review</span><strong>{inReview}</strong><small>Judgment or evidence still pending</small></div>
        <div className={styles.opsCard}><span>Composer ready</span><strong>{composerReady}</strong><small>Can be prepared safely</small></div>
        <div className={styles.opsCard}><span>V2 backfill</span><strong>{backfill}</strong><small>Legacy research needs a new draft</small></div>
      </section>

      <section className={styles.preparePanel}>
        <div>
          <span className={styles.kicker}>SAFE AUTOMATION</span>
          <h2>Prepare generated V2 drafts for review</h2>
          <p>This applies composer output only to companies with no existing human review. It does not publish, overwrite reviewed work, or alter legacy ADBE/DECK research.</p>
        </div>
        <form action={prepareV2ReviewsAction}>
          <button type="submit" disabled={!prepareCount}>Prepare {prepareCount} review package{prepareCount===1?"":"s"}</button>
        </form>
      </section>

      <section className={styles.queueHeader}>
        <div><span className={styles.kicker}>UNIVERSE STATUS</span><h2>Company completion queue</h2></div>
        <span>{ready+readyToVerify+inReview+composerReady} active V2 draft{ready+readyToVerify+inReview+composerReady===1?"":"s"}</span>
      </section>

      <section className={styles.queue}>
        {rows.map((row:any)=>{
          const stage=stageFor(row);
          const composed=row.composition?.validation_result?.completenessPct;
          const content=<>
            <div className={styles.companyMark}>{row.company.ticker.slice(0,2)}</div>
            <div className={styles.companyCopy}>
              <strong>{row.company.ticker} · {row.company.company_name}</strong>
              <span>{row.draft?.industry_module?.replaceAll("_"," ") ?? (row.latestRun?"legacy published research":row.coverage?.status==="sufficient"?"data ready; draft not built":"research setup pending")}</span>
            </div>
            <div className={styles.queueMetric}><span>Data coverage</span><strong>{pct(row.coverage?.overall_pct)}</strong></div>
            <div className={styles.queueMetric}><span>V2 draft</span><strong>{composed!=null?pct(composed):row.latestRun?.standard_version==="solpient-v2"?pct(row.latestRun.completeness_pct):"—"}</strong></div>
            <div className={styles.queueMetric}><span>Version</span><strong>{row.latestRun?"v"+row.latestRun.version:"—"}</strong></div>
            <div className={styles.stageCell}><span className={styles["stage_"+stage.tone]}>{stage.label}</span></div>
          </>;
          const needsInitialBuild=!row.draft&&row.coverage?.status==="sufficient"&&!row.latestRun;
          const needsEngineRebuild=row.latestRun?.standard_version==="solpient-v2"&&Boolean(row.draft?.published_run_id)&&row.draft?.generation_version!==BASELINE_FACTORY_VERSION;
          if (needsInitialBuild||needsEngineRebuild) {
            return <form className={styles.queueRowV2} action={buildCompanyReviewAction} key={row.company.id}>
              <input type="hidden" name="company_id" value={row.company.id} />
              {content}
              <button className={styles.buildDraftButton} type="submit">{needsEngineRebuild?"Rebuild →":"Build →"}</button>
            </form>;
          }
          const href=row.draft?"/review/"+row.draft.id:row.latestRun?"/research/"+row.company.ticker:"/research";
          return <div className={styles.queueRowV2} key={row.company.id}>
            {content}
            <Link className={styles.openDraftButton} href={href}>{row.draft&&!row.draft.published_run_id?"Open →":"View →"}</Link>
          </div>;
        })}
      </section>

      {backfill?<section className={styles.notePanel}>
        <strong>Next pipeline gap: ADBE and DECK V2 backfill.</strong>
        <span>They are preserved as complete V1 research and intentionally excluded from bulk preparation until fresh V2 factory drafts exist.</span>
      </section>:null}
    </main>
  </>;
}
