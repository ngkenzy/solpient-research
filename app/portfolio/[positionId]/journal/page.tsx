import Link from "next/link";
import { redirect } from "next/navigation";
import { ConsumerHeader } from "@/components/ConsumerHeader";
import { createConsumerServerClient } from "@/lib/supabase/server-client";
import { recordDecisionAction } from "./actions";
import styles from "./journal.module.css";

export const dynamic="force-dynamic";
export const revalidate=0;

function when(value:string){
  return new Date(value).toLocaleString("en-US",{
    month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZone:"UTC"
  });
}

export default async function DecisionJournalPage({
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

  const [companyR,decisionsR]=await Promise.all([
    supabase.from("companies").select("ticker,company_name").eq("id",position.company_id).maybeSingle(),
    supabase.from("position_decision_journal")
      .select("id,decision_type,conviction,rationale,trigger_item_id,research_run_id,supersedes_decision_id,decision_snapshot,decided_at")
      .eq("position_id",positionId)
      .order("decided_at",{ascending:false}),
  ]);

  const decisions=decisionsR.data??[];
  const company=companyR.data;
  const latestDecision=decisions[0];

  return(
    <div className={styles.page}>
      <ConsumerHeader
        active="portfolio"
        subtitle="Decision Journal"
        action={<Link href={"/portfolio/"+positionId+"/thesis"}>Open thesis</Link>}
      />

      <main className={styles.main}>
        <Link href="/portfolio" className={styles.back}>← Back to Portfolio</Link>

        <section className={styles.hero}>
          <div>
            <span>APPEND-ONLY DECISION JOURNAL</span>
            <h1>{company?.ticker??"Company"} · {company?.company_name??"Company"}</h1>
            <p>
              Record your own decision and reasoning. Solpient captures the current research contract and your personalized thesis at that moment. Historical entries cannot be rewritten.
            </p>
          </div>
          <div className={styles.stat}>
            <span>Entries</span>
            <strong>{decisions.length}</strong>
            <small>{latestDecision?"Latest: "+String(latestDecision.decision_type).toUpperCase():"No decision recorded yet"}</small>
          </div>
        </section>

        {query.error?<div className={styles.error}>That decision could not be recorded.</div>:null}

        <section className={styles.panel}>
          <div className={styles.heading}>
            <span>RECORD A DECISION</span>
            <strong>This is your decision, not a Solpient recommendation.</strong>
          </div>

          <form action={recordDecisionAction} className={styles.form}>
            <input type="hidden" name="position_id" value={positionId}/>
            <label>
              <span>Decision</span>
              <select name="decision_type" defaultValue="hold">
                <option value="watch">Watch</option>
                <option value="hold">Hold</option>
                <option value="add">Add</option>
                <option value="trim">Trim</option>
                <option value="exit">Exit</option>
              </select>
            </label>
            <label>
              <span>Conviction</span>
              <select name="conviction" defaultValue="3">
                <option value="5">5 — Very high</option>
                <option value="4">4 — High</option>
                <option value="3">3 — Medium</option>
                <option value="2">2 — Low</option>
                <option value="1">1 — Very low</option>
              </select>
            </label>
            <label className={styles.wide}>
              <span>Rationale</span>
              <textarea name="rationale" required minLength={3} maxLength={5000} placeholder="What changed, what still holds, and why are you making this decision?"/>
            </label>
            {latestDecision?(
              <label className={styles.check}>
                <input type="checkbox" name="supersede_toggle" disabled/>
                <span>To correct history, record a new entry rather than editing the old one.</span>
              </label>
            ):null}
            <button type="submit">Record decision snapshot</button>
          </form>
        </section>

        <section className={styles.timeline}>
          <div className={styles.heading}>
            <span>DECISION HISTORY</span>
            <strong>{decisions.length} immutable entr{decisions.length===1?"y":"ies"}</strong>
          </div>

          {decisions.length?decisions.map((decision:any)=>{
            const snapshot=decision.decision_snapshot??{};
            const research=snapshot.portfolio_research_state?.research_contract?.current_research;
            const factorCount=Array.isArray(snapshot.personal_thesis_factors)
              ? snapshot.personal_thesis_factors.length
              : 0;

            return(
              <article key={decision.id}>
                <div className={styles.marker}/>
                <div className={styles.card}>
                  <div className={styles.cardTop}>
                    <div>
                      <span>{when(decision.decided_at)}</span>
                      <h2>{String(decision.decision_type).toUpperCase()} · Conviction {decision.conviction}/5</h2>
                    </div>
                    <div className={styles.snapshot}>
                      <span>Research</span>
                      <strong>{research?.version?"v"+research.version:"No published version"}</strong>
                    </div>
                  </div>
                  <p>{decision.rationale}</p>
                  <footer>
                    <span>{factorCount} personal thesis factor{factorCount===1?"":"s"} captured</span>
                    {decision.supersedes_decision_id?<span>Correction of prior entry</span>:null}
                    <Link href={"/portfolio/"+positionId+"/journal/"+decision.id}>View outcome attribution →</Link>
                  </footer>
                </div>
              </article>
            );
          }):(
            <div className={styles.empty}>No decisions recorded yet.</div>
          )}
        </section>
      </main>
    </div>
  );
}
