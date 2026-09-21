import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";
import { getAdminSupabase } from "@/lib/admin-supabase";
import { requireReviewAccess } from "@/lib/review-auth";
import { assessActivationReadiness, deriveLifecycle } from "@/lib/methodology-governance.mjs";
import styles from "../review.module.css";

export const dynamic="force-dynamic";
export const runtime="nodejs";

const label=(v:string)=>String(v??"").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());

export default async function MethodologiesPage(){
  await requireReviewAccess();
  const supabase=getAdminSupabase();
  if(!supabase)return null;

  const [defsR,eventsR,validationsR]=await Promise.all([
    supabase.from("methodology_definitions").select("*").order("registered_at",{ascending:false}),
    supabase.from("methodology_lifecycle_events").select("*").order("effective_at",{ascending:true}).order("created_at",{ascending:true}),
    supabase.from("methodology_validation_runs").select("*").order("validated_at",{ascending:true}),
  ]);
  for(const r of [defsR,eventsR,validationsR])if(r.error)throw r.error;

  const definitions=defsR.data??[];
  const eventsByDef=new Map<string,any[]>();
  const validationsByDef=new Map<string,any[]>();
  for(const e of eventsR.data??[]){
    const rows=eventsByDef.get(e.methodology_definition_id)??[];
    rows.push(e);eventsByDef.set(e.methodology_definition_id,rows);
  }
  for(const v of validationsR.data??[]){
    const rows=validationsByDef.get(v.methodology_definition_id)??[];
    rows.push(v);validationsByDef.set(v.methodology_definition_id,rows);
  }

  const rows=definitions.map((d:any)=>{
    const events=eventsByDef.get(d.id)??[];
    const validations=validationsByDef.get(d.id)??[];
    return{
      ...d,
      lifecycle:deriveLifecycle(events),
      readiness:assessActivationReadiness(d.manifest??d,validations),
      lifecycleEvents:events,
      validations,
    };
  }).sort((a:any,b:any)=>{
    const order:any={active:0,validated:1,candidate:2,blocked:3,deprecated:4,superseded:5,registered:6,retired:7};
    return (order[a.lifecycle]??99)-(order[b.lifecycle]??99)||
      String(a.methodology_key).localeCompare(String(b.methodology_key))||
      String(b.version).localeCompare(String(a.version));
  });

  const active=rows.filter((r:any)=>r.lifecycle==="active").length;
  const legacy=rows.filter((r:any)=>r.lifecycle==="active"&&r.legacy_bootstrap).length;
  const candidates=rows.filter((r:any)=>["candidate","validated"].includes(r.lifecycle)).length;
  const blocked=rows.filter((r:any)=>r.lifecycle==="blocked").length;

  return <>
    <header className={styles.header}>
      <SolpientBrand subtitle="Methodology Governance" />
      <div>
        <Link href="/review">Research Review</Link>
        <Link href="/review/readiness-repair">Readiness Repair</Link>
        <Link href="/review/track-record">Track Record</Link>
      </div>
    </header>

    <main className={styles.shell}>
      <section className={styles.hero}>
        <div>
          <span className={styles.kicker}>MODEL GOVERNANCE</span>
          <h1>Know exactly which methodology produced every decision.</h1>
          <p>
            Methodology definitions are immutable. Lifecycle changes and validation evidence are
            append-only events. Material changes to weights, thresholds, assumptions, contracts or
            dependencies require a new version instead of silently changing historical meaning.
          </p>
        </div>
        <div className={styles.heroProgress}>
          <span>Registered versions</span>
          <strong>{rows.length}</strong>
          <small>{active} active · {candidates} candidate</small>
        </div>
      </section>

      <section className={styles.opsGrid}>
        <div className={styles.opsCard}><span>Active</span><strong>{active}</strong><small>current methodology versions</small></div>
        <div className={styles.opsCard}><span>Legacy-active</span><strong>{legacy}</strong><small>imported baselines, not retroactively certified</small></div>
        <div className={styles.opsCard}><span>Candidate / validated</span><strong>{candidates}</strong><small>not active yet</small></div>
        <div className={styles.opsCard}><span>Blocked</span><strong>{blocked}</strong><small>failed or unresolved governance gate</small></div>
      </section>

      <section className={styles.preparePanel}>
        <div>
          <span className={styles.kicker}>ACTIVATION RULE</span>
          <h2>New versions do not become active because code merged.</h2>
          <p>
            Unit tests and a production build are always required. Database-changing methods also
            require DB invariants. Historical/publication methods require integrity validation.
            Capital-decision or critical-risk methods require explicit manual review. Existing live
            methodologies are marked legacy-active only to establish the governance baseline.
          </p>
        </div>
      </section>

      <section className={styles.queueHeader}>
        <div><span className={styles.kicker}>METHODOLOGY CATALOG</span><h2>{rows.length} immutable versions</h2></div>
        <span>Current lifecycle state derived from events</span>
      </section>

      <section className={styles.queue}>
        {rows.map((row:any)=>{
          const missing=row.readiness?.missing??[];
          const failed=row.readiness?.failed??[];
          const latestValidation=new Map<string,any>();
          for(const v of row.validations??[])latestValidation.set(v.validation_type,v);
          return <div className={styles.panel} key={row.id}>
            <div className={styles.panelHeader}>
              <div>
                <span className={styles.kicker}>{label(row.lifecycle)} · {label(row.risk_class)} risk</span>
                <h2>{row.name} · {row.version}</h2>
                <p>{row.methodology_key} · {label(row.category)}</p>
              </div>
              <strong>{row.legacy_bootstrap?"Legacy baseline":row.readiness?.ready?"Activation ready":"Gated"}</strong>
            </div>

            <p>{row.purpose}</p>

            <div className={styles.opsGrid}>
              <div className={styles.opsCard}><span>Required validations</span><strong>{row.readiness?.required?.length??0}</strong><small>{(row.readiness?.required??[]).join(" · ")||"none"}</small></div>
              <div className={styles.opsCard}><span>Passed</span><strong>{row.readiness?.passed?.length??0}</strong><small>{(row.readiness?.passed??[]).join(" · ")||"none recorded"}</small></div>
              <div className={styles.opsCard}><span>Missing</span><strong>{missing.length}</strong><small>{missing.join(" · ")||"none"}</small></div>
              <div className={styles.opsCard}><span>Failed</span><strong>{failed.length}</strong><small>{failed.join(" · ")||"none"}</small></div>
            </div>

            <div className={styles.detailGrid}>
              <section className={styles.panel}>
                <div className={styles.panelHeader}><div><span className={styles.kicker}>WEIGHTS & THRESHOLDS</span><h2>Decision rules</h2></div></div>
                <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify({weights:row.weights,thresholds:row.thresholds,assumptions:row.assumptions},null,2)}</pre>
              </section>
              <section className={styles.panel}>
                <div className={styles.panelHeader}><div><span className={styles.kicker}>KNOWN LIMITATIONS</span><h2>What this version does not prove</h2></div></div>
                <div className={styles.gapList}>
                  {(row.known_limitations??[]).map((x:string,i:number)=><div key={i}><strong>{x}</strong></div>)}
                </div>
              </section>
            </div>

            <div className={styles.detailGrid}>
              <section className={styles.panel}>
                <div className={styles.panelHeader}><div><span className={styles.kicker}>DEPENDENCIES</span><h2>Version-pinned inputs</h2></div></div>
                <div className={styles.gapList}>
                  {(row.dependencies??[]).length?(row.dependencies??[]).map((d:any,i:number)=><div key={i}><strong>{d.methodology_key} · {d.version}</strong><span>{d.required===false?"optional":"required"}</span></div>):<span>No methodology dependencies.</span>}
                </div>
              </section>
              <section className={styles.panel}>
                <div className={styles.panelHeader}><div><span className={styles.kicker}>VALIDATION EVIDENCE</span><h2>Latest checks</h2></div></div>
                <div className={styles.gapList}>
                  {latestValidation.size?[...latestValidation.values()].map((v:any)=><div key={v.id}><strong>{label(v.validation_type)} · {label(v.status)}</strong><span>{v.commit_sha??"no commit"}{v.evidence_ref?" · "+v.evidence_ref:""}</span></div>):<span>{row.legacy_bootstrap?"Legacy baseline; no retroactive Registry V1 certification is implied.":"No validation evidence recorded yet."}</span>}
                </div>
              </section>
            </div>
          </div>;
        })}
      </section>
    </main>
  </>;
}
