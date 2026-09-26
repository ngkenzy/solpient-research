import Link from "next/link";
import { redirect } from "next/navigation";
import { ConsumerHeader } from "@/components/ConsumerHeader";
import { createConsumerServerClient } from "@/lib/supabase/server-client";
import { refreshDailyDigestAction } from "./actions";
import styles from "./digest.module.css";

export const dynamic="force-dynamic";
export const revalidate=0;

function dateLabel(value:string|null|undefined){
  if(!value)return "—";
  const d=new Date(value+"T00:00:00Z");
  return d.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric",timeZone:"UTC"});
}

function when(value:string|null|undefined){
  if(!value)return "—";
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return "—";
  return d.toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:"UTC"});
}

export default async function DigestPage({
  searchParams,
}:{searchParams:Promise<{error?:string}>}){
  const query=await searchParams;
  const supabase=await createConsumerServerClient();
  const {data:claims}=await supabase.auth.getClaims();
  const userId=claims?.claims?.sub?String(claims.claims.sub):null;
  if(!userId)redirect("/login");

  const [prefsR,digestR]=await Promise.all([
    supabase
      .from("user_alert_preferences")
      .select("daily_digest_enabled,minimum_level")
      .eq("user_id",userId)
      .maybeSingle(),
    supabase
      .from("thesis_digest_snapshots")
      .select("id,digest_date,alert_count,highest_score,thesis_priority_count,important_count,monitor_count,background_count,digest_payload,generated_at")
      .order("digest_date",{ascending:false})
      .limit(1)
      .maybeSingle(),
  ]);

  const digest=digestR.data as any;
  const payload=digest?.digest_payload??{};
  const items=Array.isArray(payload.items)?payload.items:[];
  const companyIds=[...new Set(items.map((item:any)=>item.company_id).filter(Boolean))] as string[];
  const companiesR=companyIds.length
    ? await supabase.from("companies").select("id,ticker,company_name").in("id",companyIds)
    : {data:[] as any[]};
  const companyById=new Map((companiesR.data??[]).map((row:any)=>[row.id,row]));

  const digestEnabled=Boolean(prefsR.data?.daily_digest_enabled);
  const error=query.error?"Digest could not be refreshed.":"";

  return(
    <div className={styles.page}>
      <ConsumerHeader
        active="what-matters"
        subtitle="Daily Digest"
        action={<Link href="/inbox">Alerts</Link>}
      />

      <main className={styles.main}>
        <section className={styles.hero}>
          <div>
            <span>DAILY THESIS DIGEST</span>
            <h1>One briefing for what changed.</h1>
            <p>
              The digest summarizes your system-generated thesis alerts for one day. It preserves the underlying scores and evidence without turning them into buy or sell advice.
            </p>
          </div>
          <div className={styles.heroAction}>
            <form action={refreshDailyDigestAction}>
              <button type="submit" disabled={!digestEnabled}>Generate today&apos;s digest</button>
            </form>
            <small>{digestEnabled?"Daily digest is enabled.":"Enable Daily digest in Alerts settings first."}</small>
          </div>
        </section>

        {error?<div className={styles.error}>{error}</div>:null}

        {digest?(
          <>
            <section className={styles.summary}>
              <div><span>Digest date</span><strong>{dateLabel(digest.digest_date)}</strong></div>
              <div><span>Alerts</span><strong>{digest.alert_count}</strong></div>
              <div><span>Highest score</span><strong>{digest.highest_score??"—"}</strong></div>
              <div><span>Thesis priority</span><strong>{digest.thesis_priority_count}</strong></div>
              <div><span>Important</span><strong>{digest.important_count}</strong></div>
              <div><span>Monitor</span><strong>{digest.monitor_count}</strong></div>
            </section>

            <section className={styles.list}>
              <div className={styles.heading}>
                <div>
                  <span>TOP ITEMS</span>
                  <h2>{items.length} included</h2>
                </div>
                <small>Generated {when(digest.generated_at)}</small>
              </div>

              {items.length?items.map((item:any)=>{
                const company=companyById.get(item.company_id) as any;
                return(
                  <article key={item.alert_id}>
                    <div className={styles.score}>
                      <strong>{item.score}</strong>
                      <span>{String(item.level??"monitor").replaceAll("_"," ")}</span>
                    </div>
                    <div className={styles.itemBody}>
                      <span>{company?.ticker??"—"} · {when(item.occurred_at)}</span>
                      <h3>{item.title}</h3>
                      <p>{item.summary??"No summary available."}</p>
                      <div>
                        {company?.ticker?<Link href={"/research/"+company.ticker}>Research</Link>:null}
                        <Link href={"/portfolio/"+item.position_id+"/thesis"}>Thesis</Link>
                      </div>
                    </div>
                  </article>
                );
              }):(
                <div className={styles.empty}>No qualifying alerts were materialized for this digest date.</div>
              )}
            </section>
          </>
        ):(
          <section className={styles.emptyState}>
            <strong>No digest generated yet.</strong>
            <span>Enable the daily digest preference in Alerts, refresh thesis alerts, then generate today&apos;s digest.</span>
            <Link href="/inbox">Open Alerts</Link>
          </section>
        )}
      </main>
    </div>
  );
}
