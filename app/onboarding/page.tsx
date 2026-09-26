import Link from "next/link";
import { redirect } from "next/navigation";
import { ConsumerHeader } from "@/components/ConsumerHeader";
import { createConsumerServerClient } from "@/lib/supabase/server-client";
import {
  addOnboardingPositionAction,
  finishOnboardingAction,
  skipOnboardingAction,
} from "./actions";
import styles from "./onboarding.module.css";

export const dynamic="force-dynamic";
export const revalidate=0;

export default async function OnboardingPage({
  searchParams,
}:{searchParams:Promise<{error?:string}>}){
  const query=await searchParams;
  const supabase=await createConsumerServerClient();
  const {data:claims}=await supabase.auth.getClaims();
  const userId=claims?.claims?.sub?String(claims.claims.sub):null;
  if(!userId) redirect("/login");

  const [profileR,companiesR,positionsR]=await Promise.all([
    supabase
      .from("profiles")
      .select("display_name,onboarding_completed")
      .eq("user_id",userId)
      .maybeSingle(),
    supabase
      .from("companies")
      .select("id,ticker,company_name")
      .order("ticker"),
    supabase
      .from("portfolio_positions")
      .select("id,company_id,quantity,average_cost")
      .eq("user_id",userId)
      .order("created_at",{ascending:true}),
  ]);

  const positions=positionsR.data??[];
  const companies=companiesR.data??[];
  const companyById=new Map(companies.map((row:any)=>[row.id,row]));
  const positionIds=positions.map((row:any)=>row.id);

  const factorsR=positionIds.length
    ? await supabase
        .from("position_thesis_factors")
        .select("id,position_id")
        .in("position_id",positionIds)
    : {data:[] as any[]};

  const factors=factorsR.data??[];
  const personalizedPositions=new Set(factors.map((row:any)=>row.position_id));
  const firstPosition=positions[0];
  const displayName=profileR.data?.display_name?.trim()||"Investor";

  const error=query.error
    ? query.error==="ticker"
      ? "Choose a company currently covered by Solpient."
      : query.error==="need-position"
        ? "Add at least one holding before finishing onboarding."
        : "That onboarding step could not be saved."
    : "";

  const step1Done=positions.length>0;
  const step2Done=personalizedPositions.size>0;
  const progress=step2Done?100:step1Done?66:33;

  return(
    <div className={styles.page}>
      <ConsumerHeader active="portfolio" subtitle="Getting Started"/>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div>
            <span>WELCOME TO SOLPIENT</span>
            <h1>{displayName}, connect research to what you actually own.</h1>
            <p>
              Add one holding, personalize the thesis factors that matter to you, then let What Matters filter company changes against your position.
            </p>
          </div>
          <div className={styles.progressBox}>
            <span>SETUP PROGRESS</span>
            <strong>{progress}%</strong>
            <div><i style={{width:progress+"%"}}/></div>
          </div>
        </section>

        {error?<div className={styles.error}>{error}</div>:null}

        <section className={styles.steps}>
          <article className={step1Done?styles.done:styles.active}>
            <div className={styles.stepNumber}>1</div>
            <div className={styles.stepBody}>
              <span>FIRST HOLDING</span>
              <h2>{step1Done?"Holding added":"Add a company you own"}</h2>
              <p>
                This creates the position Solpient will use to connect research, thesis factors, material changes, and alerts.
              </p>

              {!step1Done?(
                <form action={addOnboardingPositionAction} className={styles.positionForm}>
                  <label>
                    <span>Company</span>
                    <select name="ticker" required defaultValue="">
                      <option value="" disabled>Select ticker</option>
                      {companies.map((company:any)=>(
                        <option value={company.ticker} key={company.id}>
                          {company.ticker} — {company.company_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Shares</span>
                    <input name="quantity" type="number" min="0.00000001" step="0.00000001" required placeholder="10"/>
                  </label>
                  <label>
                    <span>Average cost</span>
                    <input name="average_cost" type="number" min="0" step="0.01" placeholder="250.00"/>
                  </label>
                  <button type="submit">Add holding</button>
                </form>
              ):(
                <div className={styles.positionList}>
                  {positions.map((position:any)=>{
                    const company=companyById.get(position.company_id) as any;
                    return(
                      <div key={position.id}>
                        <strong>{company?.ticker??"Company"}</strong>
                        <span>{company?.company_name??"Unknown"} · {position.quantity} shares</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </article>

          <article className={step2Done?styles.done:step1Done?styles.active:styles.locked}>
            <div className={styles.stepNumber}>2</div>
            <div className={styles.stepBody}>
              <span>YOUR THESIS</span>
              <h2>{step2Done?"Thesis personalized":"Choose what matters"}</h2>
              <p>
                Tell Solpient which canonical thesis variables matter most to your position, or add a private custom factor.
              </p>
              {firstPosition?(
                <Link className={styles.primaryLink} href={"/portfolio/"+firstPosition.id+"/thesis"}>
                  {step2Done?"Review thesis":"Personalize thesis"} →
                </Link>
              ):(
                <span className={styles.muted}>Add a holding first.</span>
              )}
            </div>
          </article>

          <article className={step1Done?styles.active:styles.locked}>
            <div className={styles.stepNumber}>3</div>
            <div className={styles.stepBody}>
              <span>WHAT MATTERS</span>
              <h2>Turn changes into attention</h2>
              <p>
                Finish setup and open your personalized change feed. You can refine thesis factors later at any time.
              </p>
              {step1Done?(
                <form action={finishOnboardingAction}>
                  <button type="submit" className={styles.finish}>Finish and open What Matters</button>
                </form>
              ):(
                <span className={styles.muted}>Add a holding first.</span>
              )}
            </div>
          </article>
        </section>

        <form action={skipOnboardingAction} className={styles.skip}>
          <button type="submit">Skip guided setup and open Portfolio</button>
        </form>
      </main>
    </div>
  );
}
