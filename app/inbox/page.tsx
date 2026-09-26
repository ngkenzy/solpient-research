import Link from "next/link";
import { redirect } from "next/navigation";
import { ConsumerHeader } from "@/components/ConsumerHeader";
import { createConsumerServerClient } from "@/lib/supabase/server-client";
import {
  refreshThesisAlertsAction,
  saveAlertPreferencesAction,
  setThesisAlertStateAction,
} from "./actions";
import styles from "./inbox.module.css";

export const dynamic="force-dynamic";
export const revalidate=0;

function when(value:string|null|undefined){
  if(!value) return "—";
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US",{
    month:"short",
    day:"numeric",
    hour:"numeric",
    minute:"2-digit",
    timeZone:"UTC",
  });
}

function levelLabel(value:string){
  return value.replaceAll("_"," ").replace(/\b\w/g,(c)=>c.toUpperCase());
}

export default async function InboxPage({
  searchParams,
}:{searchParams:Promise<{error?:string}>}){
  const query=await searchParams;
  const supabase=await createConsumerServerClient();
  const {data:claims}=await supabase.auth.getClaims();
  const userId=claims?.claims?.sub?String(claims.claims.sub):null;
  if(!userId) redirect("/login");

  const [preferencesR,alertsR]=await Promise.all([
    supabase
      .from("user_alert_preferences")
      .select("minimum_level,in_app_enabled,daily_digest_enabled")
      .eq("user_id",userId)
      .maybeSingle(),
    supabase
      .from("thesis_alerts")
      .select("id,position_id,company_id,item_id,event_id,level,score,title,summary,occurred_at,source_as_of,state,created_at")
      .order("score",{ascending:false})
      .order("occurred_at",{ascending:false,nullsFirst:false})
      .limit(200),
  ]);

  const alerts=alertsR.data??[];
  const companyIds=[...new Set(alerts.map((row:any)=>row.company_id))];
  const companiesR=companyIds.length
    ? await supabase.from("companies").select("id,ticker,company_name").in("id",companyIds)
    : {data:[] as any[]};
  const companyById=new Map((companiesR.data??[]).map((row:any)=>[row.id,row]));

  const preferences=preferencesR.data??{
    minimum_level:"important",
    in_app_enabled:true,
    daily_digest_enabled:false,
  };

  const unread=alerts.filter((row:any)=>row.state==="unread").length;
  const important=alerts.filter((row:any)=>Number(row.score)>=70&&row.state!=="dismissed").length;
  const visible=alerts.filter((row:any)=>row.state!=="dismissed");

  const error=query.error
    ? query.error==="refresh"
      ? "Alerts could not be refreshed from What Matters."
      : "Your alert settings could not be saved."
    : "";

  return(
    <div className={styles.page}>
      <ConsumerHeader active="what-matters" subtitle="Alerts"/>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div>
            <span>THESIS ALERTS</span>
            <h1>Changes worth your attention.</h1>
            <p>
              Alerts are materialized from your private What Matters feed using the same thesis-personalized scores. They are research attention signals, not trading recommendations.
            </p>
          </div>
          <div className={styles.stats}>
            <div><span>Unread</span><strong>{unread}</strong></div>
            <div><span>Important+</span><strong>{important}</strong></div>
            <div><span>Inbox</span><strong>{visible.length}</strong></div>
          </div>
        </section>

        {error?<div className={styles.error}>{error}</div>:null}

        <section className={styles.toolbar}>
          <form action={refreshThesisAlertsAction}>
            <div>
              <span>SYNC FROM WHAT MATTERS</span>
              <strong>Materialize the latest thesis alerts</strong>
            </div>
            <button type="submit">Refresh alerts</button>
          </form>

          <form action={saveAlertPreferencesAction} className={styles.preferences}>
            <label>
              <span>Minimum level</span>
              <select name="minimum_level" defaultValue={preferences.minimum_level}>
                <option value="thesis_priority">Thesis priority only</option>
                <option value="important">Important and above</option>
                <option value="monitor">Monitor and above</option>
                <option value="background">Everything</option>
              </select>
            </label>

            <label className={styles.check}>
              <input
                type="checkbox"
                name="in_app_enabled"
                defaultChecked={Boolean(preferences.in_app_enabled)}
              />
              <span>In-app alerts</span>
            </label>

            <label className={styles.check}>
              <input
                type="checkbox"
                name="daily_digest_enabled"
                defaultChecked={Boolean(preferences.daily_digest_enabled)}
              />
              <span>Daily digest preference</span>
            </label>

            <button type="submit">Save settings</button>
          </form>
        </section>

        <section className={styles.list}>
          {visible.length?visible.map((alert:any)=>{
            const company=companyById.get(alert.company_id) as any;
            return(
              <article
                className={[
                  styles.card,
                  alert.state==="unread"?styles.unread:"",
                ].join(" ")}
                key={alert.id}
              >
                <div className={styles.topline}>
                  <Link href={"/research/"+(company?.ticker??"")} className={styles.company}>
                    <strong>{company?.ticker??"—"}</strong>
                    <span>{company?.company_name??"Company"}</span>
                  </Link>
                  <div className={styles.score}>
                    <span>{levelLabel(alert.level)}</span>
                    <strong>{alert.score}</strong>
                  </div>
                </div>

                <div className={styles.body}>
                  <span>{when(alert.occurred_at??alert.created_at)}</span>
                  <h2>{alert.title}</h2>
                  <p>{alert.summary??"No summary available."}</p>
                  <small>Source as of {when(alert.source_as_of)}</small>
                </div>

                <footer>
                  <div>
                    <Link href={"/portfolio/"+alert.position_id+"/thesis"}>Open thesis</Link>
                    {company?.ticker?<Link href={"/research/"+company.ticker}>Open research</Link>:null}
                  </div>
                  <form action={setThesisAlertStateAction}>
                    <input type="hidden" name="alert_id" value={alert.id}/>
                    {alert.state!=="read"?(
                      <button type="submit" name="state" value="read">Mark read</button>
                    ):(
                      <button type="submit" name="state" value="unread">Mark unread</button>
                    )}
                    <button type="submit" name="state" value="dismissed">Dismiss</button>
                  </form>
                </footer>
              </article>
            );
          }):(
            <div className={styles.empty}>
              <strong>No thesis alerts yet.</strong>
              <span>Refresh alerts after What Matters has material changes for your positions.</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
