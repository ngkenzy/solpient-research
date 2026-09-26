import Link from "next/link";
import { redirect } from "next/navigation";
import { createConsumerServerClient } from "@/lib/supabase/server-client";
import { ConsumerHeader } from "@/components/ConsumerHeader";
import { addCustomFactorAction, deleteThesisFactorAction, saveCanonicalFactorAction } from "./actions";
import styles from "./thesis.module.css";

export const dynamic="force-dynamic";
export const revalidate=0;

export default async function ThesisPage({
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
    .select("id,portfolio_id,company_id")
    .eq("id",positionId)
    .maybeSingle();
  if(!position) redirect("/portfolio?error=portfolio-access");

  const [companyR,factorsR,researchR]=await Promise.all([
    supabase.from("companies").select("ticker,company_name").eq("id",position.company_id).maybeSingle(),
    supabase.from("position_thesis_factors")
      .select("id,source_type,canonical_thesis_variable_id,factor_label,importance,personal_expectation,personal_breaker_condition,enabled")
      .eq("position_id",positionId)
      .order("importance",{ascending:false}),
    supabase.rpc("get_my_portfolio_research_state_v1"),
  ]);

  const item=((researchR.data as any)?.positions??[]).find((row:any)=>row.position_id===positionId);
  const contract=item?.research_contract??{};
  const canonical=contract.canonical_thesis_variables??[];
  const factors=factorsR.data??[];
  const byCanonical=new Map(
    factors
      .filter((row:any)=>row.source_type==="canonical")
      .map((row:any)=>[row.canonical_thesis_variable_id,row])
  );
  const custom=factors.filter((row:any)=>row.source_type==="custom");
  const ticker=companyR.data?.ticker??"Company";

  return(
    <div className={styles.page}>
      <ConsumerHeader
        active="portfolio"
        subtitle="Thesis"
        action={<Link href={"/portfolio/"+positionId+"/thesis/audit"}>Audit trail</Link>}
      />

      <main className={styles.main}>
        <Link href="/portfolio" className={styles.back}>← Back to Portfolio</Link>
        <section className={styles.hero}>
          <span>POSITION THESIS</span>
          <h1>{ticker} · {companyR.data?.company_name??"Company"}</h1>
          <p>Choose which published Solpient thesis factors matter to you. Your layer is private and never changes canonical Research.</p>
        </section>

        {query.error?<div className={styles.error}>That thesis change could not be saved.</div>:null}

        <section className={styles.section}>
          <div className={styles.heading}>
            <div><span>CANONICAL FACTORS</span><h2>What matters to my thesis</h2></div>
            <strong>{factors.length} personalized</strong>
          </div>

          <div className={styles.grid}>
            {canonical.map((variable:any)=>{
              const saved=byCanonical.get(variable.id) as any;
              return(
                <article className={styles.card} key={variable.id}>
                  <div className={styles.cardHead}>
                    <div><small>{variable.metric_key??"THESIS FACTOR"}</small><h3>{variable.variable_name}</h3></div>
                    <b>{String(variable.status??"unknown").replaceAll("_"," ")}</b>
                  </div>

                  <dl>
                    <div><dt>Solpient expectation</dt><dd>{variable.expectation??"—"}</dd></div>
                    <div><dt>Observed</dt><dd>{variable.observed_value??"—"}</dd></div>
                    <div><dt>Canonical breaker</dt><dd>{variable.breaker_condition??"—"}</dd></div>
                  </dl>

                  <form action={saveCanonicalFactorAction} className={styles.form}>
                    <input type="hidden" name="position_id" value={positionId}/>
                    <input type="hidden" name="canonical_thesis_variable_id" value={variable.id}/>
                    <label>
                      <span>Importance</span>
                      <select name="importance" defaultValue={String(saved?.importance??3)}>
                        <option value="5">5 — Critical</option>
                        <option value="4">4 — High</option>
                        <option value="3">3 — Medium</option>
                        <option value="2">2 — Low</option>
                        <option value="1">1 — Background</option>
                      </select>
                    </label>
                    <label>
                      <span>My expectation</span>
                      <textarea name="personal_expectation" maxLength={2000} defaultValue={saved?.personal_expectation??""}/>
                    </label>
                    <label>
                      <span>My breaker</span>
                      <textarea name="personal_breaker_condition" maxLength={2000} defaultValue={saved?.personal_breaker_condition??""}/>
                    </label>
                    <label className={styles.check}>
                      <input type="checkbox" name="enabled" defaultChecked={saved?Boolean(saved.enabled):true}/>
                      <span>Use this factor</span>
                    </label>
                    <button type="submit">{saved?"Save":"Track factor"}</button>
                  </form>

                  {saved?(
                    <form action={deleteThesisFactorAction} className={styles.remove}>
                      <input type="hidden" name="position_id" value={positionId}/>
                      <input type="hidden" name="factor_id" value={saved.id}/>
                      <button type="submit">Remove personalization</button>
                    </form>
                  ):null}
                </article>
              );
            })}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.heading}>
            <div><span>PRIVATE FACTORS</span><h2>Add my own factor</h2></div>
          </div>
          <form action={addCustomFactorAction} className={styles.customForm}>
            <input type="hidden" name="position_id" value={positionId}/>
            <input name="factor_label" required maxLength={240} placeholder="Management execution"/>
            <select name="importance" defaultValue="3">
              <option value="5">5 — Critical</option>
              <option value="4">4 — High</option>
              <option value="3">3 — Medium</option>
              <option value="2">2 — Low</option>
              <option value="1">1 — Background</option>
            </select>
            <textarea name="personal_expectation" maxLength={2000} placeholder="What must remain true?"/>
            <textarea name="personal_breaker_condition" maxLength={2000} placeholder="What would break the thesis?"/>
            <button type="submit">Add factor</button>
          </form>

          <div className={styles.customList}>
            {custom.map((factor:any)=>(
              <article key={factor.id}>
                <div>
                  <small>IMPORTANCE {factor.importance}</small>
                  <h3>{factor.factor_label}</h3>
                  {factor.personal_expectation?<p>{factor.personal_expectation}</p>:null}
                </div>
                <form action={deleteThesisFactorAction}>
                  <input type="hidden" name="position_id" value={positionId}/>
                  <input type="hidden" name="factor_id" value={factor.id}/>
                  <button type="submit">Remove</button>
                </form>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
