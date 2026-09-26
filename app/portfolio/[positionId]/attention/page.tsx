import Link from "next/link";
import { redirect } from "next/navigation";
import { ConsumerHeader } from "@/components/ConsumerHeader";
import { createConsumerServerClient } from "@/lib/supabase/server-client";
import { savePositionAttentionAction } from "./actions";
import styles from "./attention.module.css";

export const dynamic="force-dynamic";
export const revalidate=0;

export default async function PositionAttentionPage({
  params,
  searchParams,
}:{
  params:Promise<{positionId:string}>;
  searchParams:Promise<{error?:string}>;
}){
  const {positionId}=await params;
  const query=await searchParams;
  const supabase=await createConsumerServerClient();
  const {data:claims}=await supabase.auth.getClaims();
  if(!claims?.claims?.sub) redirect("/login");

  const {data:position}=await supabase
    .from("portfolio_positions")
    .select("id,company_id")
    .eq("id",positionId)
    .maybeSingle();

  if(!position) redirect("/portfolio?error=portfolio-access");

  const [companyR,prefR]=await Promise.all([
    supabase
      .from("companies")
      .select("ticker,company_name")
      .eq("id",position.company_id)
      .maybeSingle(),
    supabase
      .from("position_attention_preferences")
      .select("attention_enabled,minimum_level,digest_enabled")
      .eq("position_id",positionId)
      .maybeSingle(),
  ]);

  const pref=prefR.data??{
    attention_enabled:true,
    minimum_level:"important",
    digest_enabled:true,
  };

  const ticker=companyR.data?.ticker??"Company";

  return(
    <div className={styles.page}>
      <ConsumerHeader active="portfolio" subtitle="Attention"/>

      <main className={styles.main}>
        <Link href="/portfolio" className={styles.back}>← Back to Portfolio</Link>

        <section className={styles.hero}>
          <span>POSITION ATTENTION</span>
          <h1>{ticker} · {companyR.data?.company_name??"Company"}</h1>
          <p>
            Control how much attention this holding receives without changing your global alert settings or the underlying Solpient Research.
          </p>
        </section>

        {query.error?<div className={styles.error}>Attention settings could not be saved.</div>:null}

        <section className={styles.panel}>
          <form action={savePositionAttentionAction} className={styles.form}>
            <input type="hidden" name="position_id" value={positionId}/>

            <label className={styles.toggle}>
              <input
                type="checkbox"
                name="attention_enabled"
                defaultChecked={Boolean(pref.attention_enabled)}
              />
              <span>
                <strong>Enable attention for this position</strong>
                <small>When disabled, automatic alerts and digest items for this holding are suppressed.</small>
              </span>
            </label>

            <label>
              <span>Minimum attention level</span>
              <select name="minimum_level" defaultValue={pref.minimum_level}>
                <option value="thesis_priority">Thesis priority only</option>
                <option value="important">Important and above</option>
                <option value="monitor">Monitor and above</option>
                <option value="background">Everything</option>
              </select>
              <small>
                Position-level thresholds can narrow your global setting. They never make a muted global alert stream noisier.
              </small>
            </label>

            <label className={styles.toggle}>
              <input
                type="checkbox"
                name="digest_enabled"
                defaultChecked={Boolean(pref.digest_enabled)}
              />
              <span>
                <strong>Include this position in the daily digest</strong>
                <small>Digest inclusion still requires your global daily digest preference to be enabled.</small>
              </span>
            </label>

            <button type="submit">Save attention settings</button>
          </form>
        </section>

        <section className={styles.links}>
          <Link href={"/portfolio/"+positionId+"/thesis"}>Open thesis</Link>
          <Link href="/inbox">Open alert inbox</Link>
          <Link href="/digest">Open daily digest</Link>
        </section>
      </main>
    </div>
  );
}
