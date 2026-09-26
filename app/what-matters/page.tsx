import Link from "next/link";
import { redirect } from "next/navigation";
import { SolpientBrand } from "@/components/SolpientBrand";
import { ConsumerHeader } from "@/components/ConsumerHeader";
import { createConsumerServerClient } from "@/lib/supabase/server-client";
import { reportMissedEventAction, submitWhatMattersFeedbackAction } from "./actions";
import styles from "./what-matters.module.css";

export const dynamic="force-dynamic";
export const revalidate=0;

function when(value:string|null|undefined){
  if(!value) return "—";
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
}

export default async function WhatMattersPage({
  searchParams,
}:{searchParams:Promise<{error?:string}>}){
  const query=await searchParams;
  const supabase=await createConsumerServerClient();
  const {data:claims}=await supabase.auth.getClaims();
  const userId=claims?.claims?.sub?String(claims.claims.sub):null;
  if(!userId) redirect("/login");

  const [{data,error},feedbackR,positionsR]=await Promise.all([
    supabase.rpc("get_my_what_matters_v1"),
    supabase.from("what_matters_feedback").select("item_id,feedback_type,note"),
    supabase.from("portfolio_positions")
      .select("id,company_id")
      .order("created_at",{ascending:true}),
  ]);
  if(error){
    return(
      <main className={styles.errorPage}>
        <SolpientBrand subtitle="What Matters"/>
        <h1>What Matters is unavailable.</h1>
        <p>{error.message}</p>
        <Link href="/portfolio">Back to Portfolio</Link>
      </main>
    );
  }

  const contract=(data as any)??{};
  const items=contract.items??[];
  const stale=contract.source_status==="stale"||contract.source_status==="unavailable";
  const feedbackByItem=new Map(
    (feedbackR.data??[]).map((row:any)=>[row.item_id,row])
  );
  const rawPositions=positionsR.data??[];
  const companyIds=[...new Set(rawPositions.map((row:any)=>row.company_id))];
  const companiesR=companyIds.length
    ? await supabase.from("companies").select("id,ticker,company_name").in("id",companyIds)
    : {data:[] as any[]};
  const companyById=new Map((companiesR.data??[]).map((row:any)=>[row.id,row]));
  const positions=rawPositions.map((row:any)=>({
    ...row,
    company:companyById.get(row.company_id),
  }));
  const formError=query.error==="feedback"
    ? "Feedback could not be saved."
    : query.error==="missed"
      ? "Missed-event report could not be saved."
      : "";

  return(
    <div className={styles.page}>
      <ConsumerHeader
        active="what-matters"
        subtitle="What Matters"
        action={<Link href="/inbox">Alerts</Link>}
      />

      <main className={styles.main}>
        <section className={styles.hero}>
          <span className={styles.kicker}>YOUR THESIS, FILTERED BY CHANGE</span>
          <h1>What matters in what you own.</h1>
          <p>
            Company-level changes are ranked against the thesis factors you chose for each position. This is research triage, not a trading recommendation.
          </p>
          <div className={styles.stats}>
            <div><span>Items</span><strong>{contract.item_count??0}</strong></div>
            <div><span>Source status</span><strong>{String(contract.source_status??"unknown").replaceAll("_"," ")}</strong></div>
            <div><span>Window</span><strong>Since {contract.since??"—"}</strong></div>
          </div>
        </section>

        {formError?<div className={styles.formError}>{formError}</div>:null}

        {stale?(
          <div className={styles.warning}>
            <strong>Some source updates are stale.</strong>
            <span>These items remain valid historical signals, but the underlying research-event feeds have not refreshed recently.</span>
          </div>
        ):null}

        <section className={styles.feed}>
          {items.length?items.map((item:any)=>{
            const position=item.position??{};
            const event=item.event??{};
            const user=item.user_materiality??{};
            const source=item.source_freshness??{};
            const existingFeedback=feedbackByItem.get(item.item_id) as any;
            const eventId=String(event.event_id??event.event_key??item.item_id);
            return(
              <article className={styles.card} key={item.item_id}>
                <div className={styles.topline}>
                  <Link href={"/research/"+position.ticker} className={styles.company}>
                    <strong>{position.ticker}</strong>
                    <span>{position.company_name}</span>
                  </Link>
                  <div className={styles.score}>
                    <span>{String(user.level??"monitor").replaceAll("_"," ")}</span>
                    <strong>{user.score??0}</strong>
                  </div>
                </div>

                <div className={styles.event}>
                  <span className={styles.eventType}>{String(event.source_kind??"event").replaceAll("_"," ")}</span>
                  <h2>{event.label??"Material change"}</h2>
                  <p>{event.summary??"No summary available."}</p>
                </div>

                <div className={styles.meta}>
                  <span>Company materiality: <b>{event.company_materiality?.score??"—"}</b></span>
                  <span>Decision effect: <b>{String(event.decision_effect??"monitor").replaceAll("_"," ")}</b></span>
                  <span>Occurred: <b>{when(event.occurred_at)}</b></span>
                </div>

                {user.personalized?(
                  <div className={styles.match}>
                    <strong>Matches your thesis: {user.matched_factor_label}</strong>
                    <span>Importance {user.importance}/5 · {user.reason}</span>
                    {user.personal_expectation?<p><b>Your expectation:</b> {user.personal_expectation}</p>:null}
                    {user.personal_breaker_condition?<p><b>Your breaker:</b> {user.personal_breaker_condition}</p>:null}
                  </div>
                ):(
                  <div className={styles.unmatched}>
                    <span>{user.reason}</span>
                  </div>
                )}

                <form action={submitWhatMattersFeedbackAction} className={styles.feedback}>
                  <input type="hidden" name="position_id" value={position.id}/>
                  <input type="hidden" name="item_id" value={item.item_id}/>
                  <input type="hidden" name="event_id" value={eventId}/>
                  <span>{existingFeedback?"Your feedback: "+String(existingFeedback.feedback_type).replaceAll("_"," "):"Was this useful?"}</span>
                  <div>
                    <button name="feedback_type" value="useful" type="submit">Useful</button>
                    <button name="feedback_type" value="not_useful" type="submit">Not useful</button>
                    <button name="feedback_type" value="too_late" type="submit">Too late</button>
                    <button name="feedback_type" value="wrong_reason" type="submit">Wrong reason</button>
                  </div>
                </form>

                <footer>
                  <span>Source {source.status??"unknown"} · as of {when(source.source_as_of)}</span>
                  <div>
                    <Link href={"/portfolio/"+position.id+"/thesis"}>Edit thesis</Link>
                    <Link href={"/research/"+position.ticker}>Open research</Link>
                  </div>
                </footer>
              </article>
            );
          }):(
            <div className={styles.empty}>
              <strong>Nothing is in your What Matters feed yet.</strong>
              <span>Add positions and personalize thesis factors to make company changes more relevant to you.</span>
              <Link href="/portfolio">Open Portfolio →</Link>
            </div>
          )}
        </section>

        <section className={styles.missed}>
          <div>
            <span className={styles.kicker}>FEEDBACK LOOP</span>
            <h2>Did Solpient miss something important?</h2>
            <p>Report it privately. This becomes product-quality feedback, not a public post or trading signal.</p>
          </div>
          <form action={reportMissedEventAction}>
            <select name="position_id" required defaultValue="">
              <option value="" disabled>Select a position</option>
              {positions.map((row:any)=>(
                <option value={row.id} key={row.id}>
                  {row.company?.ticker??"Company"} — {row.company?.company_name??"Unknown"}
                </option>
              ))}
            </select>
            <input name="expected_event" required minLength={3} maxLength={1000} placeholder="What important event did we miss?"/>
            <input name="occurred_on" type="date"/>
            <textarea name="note" maxLength={3000} placeholder="Why did it matter to your thesis?"/>
            <button type="submit" disabled={!positions.length}>Report missed event</button>
          </form>
        </section>
      </main>
    </div>
  );
}
