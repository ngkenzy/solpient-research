import Link from "next/link";
import { redirect } from "next/navigation";
import { ConsumerHeader } from "@/components/ConsumerHeader";
import { createConsumerServerClient } from "@/lib/supabase/server-client";
import styles from "./audit.module.css";

export const dynamic="force-dynamic";
export const revalidate=0;

function when(value:string|null|undefined){
  if(!value)return "—";
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return "—";
  return d.toLocaleString("en-US",{
    month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",
    timeZone:"UTC",
  });
}

function label(value:string|null|undefined){
  return String(value??"").replaceAll("_"," ").replace(/\b\w/g,(c)=>c.toUpperCase());
}

function scoreClass(score:number){
  if(score>=90)return styles.priority;
  if(score>=70)return styles.important;
  if(score>=50)return styles.monitor;
  return styles.background;
}

export default async function ThesisAuditPage({
  params,
}:{params:Promise<{positionId:string}>}){
  const {positionId}=await params;
  const supabase=await createConsumerServerClient();
  const {data:claims}=await supabase.auth.getClaims();
  if(!claims?.claims?.sub)redirect("/login");

  const {data,error}=await supabase.rpc("get_my_position_thesis_audit_v1",{
    p_position_id:positionId,
    p_since:new Date(Date.now()-180*24*60*60*1000).toISOString().slice(0,10),
    p_limit:250,
  });

  if(error||!data)redirect("/portfolio?error=portfolio-access");

  const contract=data as any;
  const position=contract.position??{};
  const timeline=Array.isArray(contract.timeline)?contract.timeline:[];

  const materialCount=timeline.filter((row:any)=>row.audit_kind==="material_event").length;
  const factorCount=timeline.filter((row:any)=>row.audit_kind==="thesis_factor_change").length;
  const highestScore=Math.max(
    0,
    ...timeline
      .filter((row:any)=>row.audit_kind==="material_event")
      .map((row:any)=>Number(row.details?.user_materiality?.score??0))
  );

  return(
    <div className={styles.page}>
      <ConsumerHeader
        active="portfolio"
        subtitle="Thesis Audit"
        action={<Link href={"/portfolio/"+positionId+"/thesis"}>Edit thesis</Link>}
      />

      <main className={styles.main}>
        <Link href={"/portfolio/"+positionId+"/thesis"} className={styles.back}>
          ← Back to thesis
        </Link>

        <section className={styles.hero}>
          <div>
            <span>THESIS AUDIT TRAIL</span>
            <h1>{position.ticker??"Company"} · {position.company_name??"Position"}</h1>
            <p>
              A chronological record of material company changes and your own thesis edits.
              Published Research remains immutable; this trail shows how new evidence interacted with your position thesis.
            </p>
          </div>
          <div className={styles.stats}>
            <div><span>Timeline events</span><strong>{timeline.length}</strong></div>
            <div><span>Material events</span><strong>{materialCount}</strong></div>
            <div><span>Thesis edits</span><strong>{factorCount}</strong></div>
            <div><span>Highest score</span><strong>{highestScore||"—"}</strong></div>
          </div>
        </section>

        <section className={styles.timeline}>
          {timeline.length?timeline.map((row:any)=>{
            const material=row.audit_kind==="material_event";
            const details=row.details??{};
            const userMateriality=details.user_materiality??{};
            const event=details.event??{};
            const evidence=event.evidence??{};
            const alert=details.alert??null;
            const feedback=details.feedback??null;
            const score=Number(userMateriality.score??0);

            return(
              <article className={styles.item} key={row.audit_kind+":"+row.audit_id}>
                <div className={styles.rail}>
                  <span className={material?styles.dotMaterial:styles.dotFactor}/>
                  <i/>
                </div>

                <div className={styles.card}>
                  <div className={styles.cardTop}>
                    <div>
                      <span className={styles.kind}>
                        {material?"MATERIAL COMPANY EVENT":"THESIS PERSONALIZATION"}
                      </span>
                      <h2>{row.title??"Thesis change"}</h2>
                      <small>{when(row.occurred_at)}</small>
                    </div>

                    {material?(
                      <div className={[styles.score,scoreClass(score)].join(" ")}>
                        <strong>{score}</strong>
                        <span>{label(userMateriality.level)}</span>
                      </div>
                    ):(
                      <div className={styles.factorEvent}>
                        {label(details.event_type)}
                      </div>
                    )}
                  </div>

                  {row.summary?<p className={styles.summary}>{row.summary}</p>:null}

                  {material?(
                    <>
                      <div className={styles.metaGrid}>
                        <div>
                          <span>Metric</span>
                          <strong>{row.metric_key??"—"}</strong>
                        </div>
                        <div>
                          <span>Matched thesis factor</span>
                          <strong>{userMateriality.matched_factor_label??"No personalized match"}</strong>
                        </div>
                        <div>
                          <span>Importance</span>
                          <strong>{userMateriality.importance?userMateriality.importance+"/5":"—"}</strong>
                        </div>
                        <div>
                          <span>Source freshness</span>
                          <strong>{label(details.source_freshness?.status??"unknown")}</strong>
                        </div>
                      </div>

                      {(userMateriality.personal_expectation||userMateriality.personal_breaker_condition)?(
                        <div className={styles.thesisContext}>
                          {userMateriality.personal_expectation?(
                            <div><span>My expectation</span><p>{userMateriality.personal_expectation}</p></div>
                          ):null}
                          {userMateriality.personal_breaker_condition?(
                            <div><span>My breaker</span><p>{userMateriality.personal_breaker_condition}</p></div>
                          ):null}
                        </div>
                      ):null}

                      {(evidence.old_value!=null||evidence.new_value!=null||evidence.old_text||evidence.new_text)?(
                        <div className={styles.evidence}>
                          <span>EVIDENCE CHANGE</span>
                          <div>
                            <p><b>Before:</b> {evidence.old_text??evidence.old_value??"—"}</p>
                            <p><b>After:</b> {evidence.new_text??evidence.new_value??"—"}</p>
                          </div>
                          {evidence.source_url?(
                            <a href={evidence.source_url} target="_blank" rel="noreferrer">Open source ↗</a>
                          ):null}
                        </div>
                      ):null}

                      {(alert||feedback)?(
                        <div className={styles.disposition}>
                          {alert?<span>Alert: {label(alert.state)} · {label(alert.level)}</span>:null}
                          {feedback?<span>Feedback: {label(feedback.feedback_type)}</span>:null}
                        </div>
                      ):null}
                    </>
                  ):(
                    <div className={styles.changeGrid}>
                      <div>
                        <span>Importance</span>
                        <strong>{details.importance_before??"—"} → {details.importance_after??"—"}</strong>
                      </div>
                      <div>
                        <span>Enabled</span>
                        <strong>{String(details.enabled_before??"—")} → {String(details.enabled_after??"—")}</strong>
                      </div>
                      <div className={styles.wide}>
                        <span>Expectation</span>
                        <p>{details.personal_expectation_before??"—"} → {details.personal_expectation_after??"—"}</p>
                      </div>
                      <div className={styles.wide}>
                        <span>Breaker</span>
                        <p>{details.personal_breaker_before??"—"} → {details.personal_breaker_after??"—"}</p>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          }):(
            <div className={styles.empty}>
              <strong>No thesis history yet.</strong>
              <span>Personalize a thesis factor or wait for a material company event to create the first audit entry.</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
