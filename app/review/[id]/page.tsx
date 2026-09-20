import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";
import { getAdminSupabase } from "@/lib/admin-supabase";
import { requireReviewAccess } from "@/lib/review-auth";
// @ts-expect-error Node ESM research helper
import { applyReviewPatch, defaultReviewTemplate, validatePromotionReadiness } from "@/lib/review-workbench.mjs";
import { applyEnrichmentAction, promoteReviewAction, saveReviewAction } from "../actions";
import styles from "../review.module.css";

export const dynamic="force-dynamic";
export const runtime="nodejs";

function metricValue(row:any) {
  if (row.status!=="available") return "Missing";
  if (row.value_text) return row.value_text;
  const n=Number(row.value_numeric);
  if (!Number.isFinite(n)) return "—";
  if (row.unit==="percent") return n.toFixed(1)+"%";
  if (row.unit==="x") return n.toFixed(1)+"×";
  if (row.unit==="USD/share") return "$"+n.toFixed(2);
  if (row.unit==="USD") return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:1}).format(n);
  if (row.unit==="shares") return new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1}).format(n);
  return n.toLocaleString("en-US",{maximumFractionDigits:2});
}

export default async function ReviewDraft({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{saved?:string;error?:string;promotion?:string;enriched?:string}>}) {
  await requireReviewAccess();
  const {id}=await params;
  const messages=await searchParams;
  const supabase=getAdminSupabase();
  if (!supabase) return null;
  const [draftResult,reviewResult,enrichmentRunResult]=await Promise.all([
    supabase.from("baseline_drafts").select("*").eq("id",id).single(),
    supabase.from("baseline_reviews").select("*").eq("draft_id",id).maybeSingle(),
    supabase.from("baseline_enrichment_runs").select("*").eq("draft_id",id).order("generated_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  const draft=draftResult.data, review=reviewResult.data, enrichmentRun=enrichmentRunResult.data;
  if (draftResult.error || !draft) throw draftResult.error ?? new Error("Draft not found.");
  const {data:company}=await supabase.from("companies").select("ticker,company_name").eq("id",draft.company_id).single();

  let enrichmentItems:any[]=[];
  if (enrichmentRun) {
    const result=await supabase.from("baseline_enrichment_items").select("*").eq("run_id",enrichmentRun.id).order("created_at");
    if (result.error) throw result.error;
    enrichmentItems=result.data ?? [];
  }

  const patch=review?.review_payload ?? defaultReviewTemplate(draft.draft_payload);
  const merged=applyReviewPatch(draft.draft_payload,review?.review_payload ?? {});
  const readiness=validatePromotionReadiness(merged);
  const metrics=Array.isArray(merged.metric_observations)?merged.metric_observations:[];
  const sources=Array.isArray(merged.sources)?merged.sources:[];
  const factoryGaps=Array.isArray(draft.draft_payload?.factory?.evidence_gaps)?draft.draft_payload.factory.evidence_gaps:[];
  const metricMap=new Map(metrics.map((row:any)=>[(row.module ?? "universal")+":"+row.metric_key,row]));
  const gaps=factoryGaps.filter((gap:any)=>metricMap.get((gap.module ?? "universal")+":"+gap.metric_key)?.status!=="available");
  const proposedEnrichment=enrichmentItems.filter((item:any)=>item.status==="proposed");
  const highConfidence=enrichmentItems.filter((item:any)=>item.confidence==="high").length;

  return <>
    <header className={styles.header}><SolpientBrand subtitle="Review workbench" /><div><Link href="/review">← Queue</Link><Link href={"/research/"+company?.ticker}>Published page</Link></div></header>
    <main className={styles.shell}>
      <section className={styles.detailHero}>
        <div><span className={styles.kicker}>FACTORY DRAFT · {draft.generation_version}</span><h1>{company?.ticker} · {company?.company_name}</h1>
          <p>Evidence cutoff {new Date(draft.source_cutoff_at).toLocaleString("en-US")}. Drafts do not affect rankings until promotion succeeds.</p>
        </div>
        <div className={styles.readinessCard}><span>Promotion readiness</span><strong className={readiness.ready?styles.readyText:styles.pendingText}>{readiness.ready?"READY":"BLOCKED"}</strong><small>{readiness.standard.completenessPct ?? 0}% Standard completeness</small></div>
      </section>

      {messages.saved?<div className={styles.successBanner}>Review saved and revalidated.</div>:null}
      {messages.enriched?<div className={styles.successBanner}>Verified primary-source enrichment applied to the private review package.</div>:null}
      {messages.error==="invalid-json"?<div className={styles.errorBanner}>Review JSON is invalid. Nothing was saved.</div>:null}
      {messages.error==="save-review-first"?<div className={styles.errorBanner}>Save the review before attempting promotion.</div>:null}
      {messages.promotion==="blocked"?<div className={styles.errorBanner}>Promotion remains blocked. Resolve the items below and save again.</div>:null}

      <div className={styles.detailGrid}>
        <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.kicker}>READINESS GATES</span><h2>What still blocks publication</h2></div><strong>{readiness.blockers.length}</strong></div>
          {readiness.blockers.length?<div className={styles.blockerList}>{readiness.blockers.map((item:string)=><div key={item}>• {item}</div>)}</div>:<div className={styles.readyBox}>All promotion gates passed. Save once more if needed, then publish.</div>}
        </section>
        <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.kicker}>FACTORY GAPS</span><h2>Evidence still requiring enrichment</h2></div><strong>{gaps.length}</strong></div>
          <div className={styles.gapList}>{gaps.map((gap:any)=><div key={(gap.module ?? "")+gap.metric_key}><strong>{gap.label}</strong><span>{gap.module?.replaceAll("_"," ")} · {gap.reason}</span></div>)}{!gaps.length?<span>No required evidence gaps were recorded by the factory.</span>:null}</div>
        </section>
      </div>

      {enrichmentRun?<section className={styles.panel}>
        <div className={styles.panelHeader}><div><span className={styles.kicker}>EVIDENCE ENRICHMENT · {enrichmentRun.engine_version}</span><h2>Primary-source enrichment</h2><p>Facts stay separate from analyst judgment. Applying enrichment updates the private review only.</p></div><strong>{highConfidence} high-confidence</strong></div>
        <div className={styles.gapList}>{enrichmentItems.map((item:any)=><div key={item.id}><strong>{item.label} · {item.confidence}</strong><span>{item.fact_text ?? "No fact text."}</span>{item.interpretation?<span>Interpretation: {item.interpretation}</span>:null}<a href={item.source_url} target="_blank" rel="noreferrer">{item.source_title} ↗</a></div>)}</div>
        <form action={applyEnrichmentAction} className={styles.formActions}><input type="hidden" name="draft_id" value={id}/><input type="hidden" name="run_id" value={enrichmentRun.id}/><button type="submit" disabled={!proposedEnrichment.length}>Apply verified enrichment</button><span>{proposedEnrichment.length} proposed item(s). Low-confidence assessment items are never auto-applied.</span></form>
      </section>:null}

      <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.kicker}>AUDITABLE EVIDENCE</span><h2>Metric ledger</h2></div><strong>{metrics.length} observations</strong></div>
        <div className={styles.metricGrid}>{metrics.map((row:any)=><div className={row.status==="available"?styles.metric:styles.metricMissing} key={(row.module ?? "universal")+row.metric_key}><span>{row.module?.replaceAll("_"," ")}</span><strong>{row.label}</strong><b>{metricValue(row)}</b><small>{row.basis} · {row.period_type ?? "period pending"}</small></div>)}</div>
      </section>

      <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.kicker}>SOURCE AUDIT</span><h2>Evidence provenance</h2></div><strong>{sources.length} sources</strong></div>
        <div className={styles.sourceList}>{sources.map((source:any,index:number)=><a href={source.url ?? "#"} target="_blank" rel="noreferrer" key={(source.url ?? "")+index}><span>{source.source_type}</span><strong>{source.title}</strong><small>{source.filing_date ?? "date pending"}</small></a>)}</div>
      </section>

      <section className={styles.editorPanel}><div className={styles.panelHeader}><div><span className={styles.kicker}>REVIEW PACKAGE</span><h2>Analyst overrides and judgments</h2><p>Only include reviewed overrides here. Metric rows merge by module + metric key; risks, thesis conditions and return scenarios replace the factory placeholders.</p></div></div>
        <form action={saveReviewAction} className={styles.reviewForm}>
          <input type="hidden" name="draft_id" value={id}/>
          <label htmlFor="review_payload">Review JSON</label>
          <textarea id="review_payload" name="review_payload" defaultValue={JSON.stringify(patch,null,2)} spellCheck={false}/>
          <label htmlFor="review_notes">Review notes</label>
          <textarea id="review_notes" name="review_notes" className={styles.notesArea} defaultValue={review?.review_notes ?? ""} placeholder="Why assumptions changed, what sources were verified, and what still deserves attention."/>
          <div className={styles.formActions}><button type="submit">Save & validate review</button><span>Saving never publishes the company.</span></div>
        </form>
      </section>

      <section className={styles.publishPanel}><div><span className={styles.kicker}>IMMUTABLE PROMOTION</span><h2>Publish reviewed research</h2><p>Promotion creates the next research version, writes the evidence/valuation/thesis tables, records material changes, and permanently links this draft to the published run.</p></div>
        {draft.status==="promoted"?<Link className={styles.publishedLink} href={"/research/"+company?.ticker}>Already promoted →</Link>:<form action={promoteReviewAction}><input type="hidden" name="draft_id" value={id}/><button type="submit" disabled={!readiness.ready}>Publish research version</button></form>}
      </section>
    </main>
  </>;
}
