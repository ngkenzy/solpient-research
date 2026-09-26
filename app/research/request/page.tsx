import Link from "next/link";
import { redirect } from "next/navigation";
import { ConsumerHeader } from "@/components/ConsumerHeader";
import { createConsumerServerClient } from "@/lib/supabase/server-client";
import { deleteResearchDemandAction, saveResearchDemandAction } from "./actions";
import styles from "./request.module.css";

export const dynamic="force-dynamic";
export const revalidate=0;

const labels:Record<string,string>={
  coverage:"Start / expand coverage",
  refresh:"Refresh existing research",
  deep_dive:"Deep dive",
  question:"Answer a specific question",
};

export default async function ResearchRequestPage({
  searchParams,
}:{searchParams:Promise<{error?:string}>}){
  const query=await searchParams;
  const supabase=await createConsumerServerClient();
  const {data:claims}=await supabase.auth.getClaims();
  const userId=claims?.claims?.sub?String(claims.claims.sub):null;
  if(!userId) redirect("/login");

  const [companiesR,requestsR,quotaR]=await Promise.all([
    supabase.from("companies").select("id,ticker,company_name").order("ticker"),
    supabase.from("research_demand_requests")
      .select("id,company_id,request_type,priority,question,reason,active,updated_at")
      .order("updated_at",{ascending:false}),
    supabase.rpc("get_my_research_request_quota_v1"),
  ]);

  const companies=companiesR.data??[];
  const companyById=new Map(companies.map((row:any)=>[row.id,row]));
  const requests=requestsR.data??[];
  const quota:any=quotaR.data??null;

  // Queue positions for active deep-dive requests only; never for other users' rows.
  const queuePositions=new Map<string,any>();
  await Promise.all(requests
    .filter((request:any)=>request.request_type==="deep_dive")
    .map(async (request:any)=>{
      const {data}=await supabase.rpc("get_my_request_queue_position_v1",{p_request_id:request.id});
      if(data) queuePositions.set(String(request.id),data);
    }));

  const error=query.error
    ? query.error==="company"
      ? "That company is not available."
      : query.error==="quota"
        ? "Deep-dive quota reached for this window. Choose coverage or refresh research instead, or remove an existing deep-dive request."
        : "Your research request could not be saved."
    : "";

  return(
    <div className={styles.page}>
      <ConsumerHeader active="research" subtitle="Research Demand"/>

      <main className={styles.main}>
        <section className={styles.hero}>
          <span>HELP SOLPIENT PRIORITIZE RESEARCH</span>
          <h1>Request deeper coverage.</h1>
          <p>
            Requesting research is not the same as monitoring a company — to monitor a company you own or follow, add it on your Portfolio page. Deep-dive requests are expensive canonical thesis and valuation research: they are quota-limited and queued by priority, and they show up here when new runs are published.
          </p>
          <p>
            Your request is private, and we don&apos;t promise dates. Solpient aggregates demand for internal research triage, but requests never change rankings, readiness, or Solpient 100 eligibility automatically.
          </p>
        </section>

        {error?<div className={styles.error}>{error}</div>:null}

        {quota?(
          <section className={styles.quotaCard}>
            <div>
              <span className={styles.cardLabel}>DEEP-DIVE QUOTA</span>
              <strong>{Number(quota.used)||0} of {Number(quota.quota)||0} used this {Number(quota.window_days)||30}-day window</strong>
            </div>
            <p>Coverage, refresh, and question requests are not quota-limited. We don&apos;t promise dates — queued requests are worked in priority order.</p>
          </section>
        ):null}

        <section className={styles.panel}>
          <form action={saveResearchDemandAction} className={styles.form}>
            <label>
              <span>Company</span>
              <select name="company_id" required defaultValue="">
                <option value="" disabled>Select a company</option>
                {companies.map((company:any)=>(
                  <option value={company.id} key={company.id}>
                    {company.ticker} — {company.company_name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Request</span>
              <select name="request_type" defaultValue="deep_dive">
                <option value="coverage">Start / expand coverage</option>
                <option value="refresh">Refresh existing research</option>
                <option value="deep_dive">Deep dive</option>
                <option value="question">Answer a specific question</option>
              </select>
            </label>

            <label>
              <span>Priority to you</span>
              <select name="priority" defaultValue="3">
                <option value="5">5 — Critical</option>
                <option value="4">4 — High</option>
                <option value="3">3 — Medium</option>
                <option value="2">2 — Low</option>
                <option value="1">1 — Background</option>
              </select>
            </label>

            <label className={styles.wide}>
              <span>Question you want answered</span>
              <textarea name="question" maxLength={2000} placeholder="What do you want the research to resolve?"/>
            </label>

            <label className={styles.wide}>
              <span>Why it matters to you</span>
              <textarea name="reason" maxLength={2000} placeholder="Optional context"/>
            </label>

            <button type="submit">Submit research request</button>
          </form>
        </section>

        <section className={styles.requests}>
          <div className={styles.heading}>
            <div>
              <span>MY REQUESTS</span>
              <h2>{requests.length} active</h2>
            </div>
          </div>

          {requests.length?requests.map((request:any)=>{
            const company=companyById.get(request.company_id) as any;
            const queue=queuePositions.get(String(request.id));
            return(
              <article key={request.id}>
                <div>
                  <span>{labels[request.request_type]??request.request_type} · Priority {request.priority}/5</span>
                  <h3>{company?.ticker??"Company"} · {company?.company_name??"Unknown"}</h3>
                  {queue&&queue.queued?(
                    <p><b>Queue:</b> #{queue.queue_position} of {queue.queue_total} active deep-dive requests</p>
                  ):null}
                  {request.question?<p><b>Question:</b> {request.question}</p>:null}
                  {request.reason?<p><b>Why:</b> {request.reason}</p>:null}
                </div>
                <form action={deleteResearchDemandAction}>
                  <input type="hidden" name="request_id" value={request.id}/>
                  <button type="submit">Remove</button>
                </form>
              </article>
            );
          }):(
            <div className={styles.empty}>No research requests yet.</div>
          )}
        </section>
      </main>
    </div>
  );
}
