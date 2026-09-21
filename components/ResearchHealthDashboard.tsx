"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./ResearchHealthDashboard.module.css";

type HealthRow = {
  id:string;
  ticker:string;
  companyName:string;
  sector:string|null;
  readiness:number|null;
  overall:number|null;
  coverageDate:string|null;
  layers:{
    fundamentals:number|null;
    balanceSheet:number|null;
    history:number|null;
    marketHistory:number|null;
    valuationHistory:number|null;
    capitalAllocation:number|null;
    peers:number|null;
    industry:number|null;
    consensus:number|null;
  };
  gaps:Array<{layer?:string;field?:string;have?:unknown;target?:unknown}>;
  jobs:Array<{
    id:string;
    layer:string;
    field:string;
    repairType:string;
    automationMode:string;
    status:string;
    priority:number;
    reason:string|null;
    attemptCount:number;
    lastError:string|null;
    updatedAt:string|null;
  }>;
};

function pct(value:number|null){return value==null?"—":Math.round(value)+"%";}
function statusLabel(value:string){
  return value.replaceAll("_"," ").replace(/\b\w/g,(x)=>x.toUpperCase());
}
function gapLabel(gap:{layer?:string;field?:string}){
  const labels:Record<string,string>={
    complete_fiscal_years:"Fiscal-year history",
    trading_days:"Market history",
    monthly_valuation_history:"Valuation history",
    industry_module_coverage:"Industry evidence",
    peer_data_coverage:"Peer data",
    point_in_time_snapshots:"Consensus history",
    published_v2_research:"Published v2 research",
    formula_components_not_persisted:"Valuation formula",
    shares_outstanding:"Share count",
    total_debt:"Debt history",
  };
  return labels[gap.field??""]??String(gap.field??gap.layer??"Coverage gap").replaceAll("_"," ");
}
function nextJob(row:HealthRow){
  const active=row.jobs
    .filter(j=>j.status!=="completed")
    .sort((a,b)=>b.priority-a.priority);
  return active[0]??null;
}
function tone(readiness:number|null){
  if(readiness==null)return styles.neutral;
  if(readiness>=85)return styles.good;
  if(readiness>=70)return styles.warn;
  return styles.bad;
}

export function ResearchHealthDashboard({
  rows,
  latestRepairRun,
}:{
  rows:HealthRow[];
  latestRepairRun:{completed_at?:string|null;status?:string|null;records_written?:number|null}|null;
}) {
  const [filter,setFilter]=useState<"all"|"critical"|"auto"|"review"|"healthy">("all");
  const [query,setQuery]=useState("");

  const stats=useMemo(()=>{
    const activeJobs=rows.flatMap(r=>r.jobs).filter(j=>j.status!=="completed");
    return{
      companies:rows.length,
      healthy:rows.filter(r=>(r.readiness??0)>=85).length,
      critical:rows.filter(r=>(r.readiness??100)<70).length,
      auto:activeJobs.filter(j=>j.automationMode==="auto"&&["pending","running","verifying"].includes(j.status)).length,
      review:activeJobs.filter(j=>j.status==="needs_review").length,
      monitoring:activeJobs.filter(j=>j.status==="monitoring").length,
      avg:rows.length?rows.reduce((sum,r)=>sum+(r.readiness??0),0)/rows.length:0,
    };
  },[rows]);

  const visible=useMemo(()=>{
    const q=query.trim().toUpperCase();
    return rows.filter(row=>{
      const active=row.jobs.filter(j=>j.status!=="completed");
      if(q&&!row.ticker.includes(q)&&!row.companyName.toUpperCase().includes(q))return false;
      if(filter==="critical"&&(row.readiness??100)>=70)return false;
      if(filter==="healthy"&&(row.readiness??0)<85)return false;
      if(filter==="auto"&&!active.some(j=>j.automationMode==="auto"))return false;
      if(filter==="review"&&!active.some(j=>j.status==="needs_review"))return false;
      return true;
    }).sort((a,b)=>(a.readiness??0)-(b.readiness??0)||a.ticker.localeCompare(b.ticker));
  },[rows,filter,query]);

  return(
    <div className={styles.dashboard}>
      <section className={styles.hero}>
        <div>
          <span className={styles.kicker}>SOLPIENT RESEARCH OPERATIONS</span>
          <h1>Research Health & Repair Center</h1>
          <p>
            Coverage v2 turns missing evidence into an explicit repair queue. Safe gaps are repaired automatically;
            evidence-sensitive gaps stay blocked for review rather than being guessed.
          </p>
        </div>
        <div className={styles.heroStatus}>
          <span>System readiness</span>
          <strong>{pct(stats.avg)}</strong>
          <small>
            {latestRepairRun?.completed_at
              ?"Last repair cycle "+new Date(latestRepairRun.completed_at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})
              :"Repair automation initialized"}
          </small>
        </div>
      </section>

      <section className={styles.stats}>
        <div><span>Companies</span><strong>{stats.companies}</strong><small>tracked universe</small></div>
        <div className={styles.statGood}><span>Healthy</span><strong>{stats.healthy}</strong><small>≥85% ready</small></div>
        <div className={styles.statBad}><span>Critical</span><strong>{stats.critical}</strong><small>&lt;70% ready</small></div>
        <div className={styles.statAuto}><span>Auto repair</span><strong>{stats.auto}</strong><small>safe gaps queued</small></div>
        <div className={styles.statReview}><span>Needs review</span><strong>{stats.review}</strong><small>evidence-sensitive</small></div>
        <div><span>Monitoring</span><strong>{stats.monitoring}</strong><small>accumulating history</small></div>
      </section>

      <section className={styles.controls}>
        <div className={styles.filters}>
          {([
            ["all","All"],
            ["critical","Critical"],
            ["auto","Auto repair"],
            ["review","Needs review"],
            ["healthy","Healthy"],
          ] as const).map(([key,label])=>(
            <button key={key} className={filter===key?styles.active:""} onClick={()=>setFilter(key)}>{label}</button>
          ))}
        </div>
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search ticker or company…" />
      </section>

      <section className={styles.queueSummary}>
        <article>
          <span className={styles.kicker}>AUTOPILOT</span>
          <h2>What Solpient fixes automatically</h2>
          <p>Fundamentals, balance-sheet coverage, market history, valuation history, and peer-context refreshes can be retried by the repair worker.</p>
        </article>
        <article>
          <span className={styles.kicker}>GUARDRAIL</span>
          <h2>What Solpient will not invent</h2>
          <p>Capital-allocation backfills, industry evidence, and publication decisions remain review-gated until a verified generic source adapter exists.</p>
        </article>
        <article>
          <span className={styles.kicker}>MONITORING</span>
          <h2>What improves with time</h2>
          <p>Consensus revisions are accumulated point-in-time. Low coverage here is expected early and should rise with scheduled snapshots.</p>
        </article>
      </section>

      <section className={styles.companyList}>
        <div className={styles.listHeader}>
          <div>
            <span className={styles.kicker}>COMPANY QUEUE</span>
            <h2>{visible.length} companies</h2>
          </div>
          <p>Lowest decision readiness first.</p>
        </div>

        {visible.map(row=>{
          const job=nextJob(row);
          const activeJobs=row.jobs.filter(j=>j.status!=="completed");
          const autoCount=activeJobs.filter(j=>j.automationMode==="auto").length;
          const reviewCount=activeJobs.filter(j=>j.status==="needs_review").length;
          return(
            <article className={styles.companyCard} key={row.id}>
              <div className={styles.companyIdentity}>
                <span className={styles.tickerMark}>{row.ticker.slice(0,3)}</span>
                <div>
                  <Link href={"/research/"+row.ticker}>{row.companyName}</Link>
                  <span>{row.ticker}{row.sector?" · "+row.sector:""}</span>
                </div>
              </div>

              <div className={styles.readiness}>
                <div className={styles.readinessTop}>
                  <span>Decision readiness</span>
                  <strong className={tone(row.readiness)}>{pct(row.readiness)}</strong>
                </div>
                <i><b className={tone(row.readiness)} style={{width:(row.readiness??0)+"%"}} /></i>
                <small>Overall coverage {pct(row.overall)} · as of {row.coverageDate??"—"}</small>
              </div>

              <div className={styles.layerStrip}>
                {[
                  ["FUN",row.layers.fundamentals],
                  ["HIST",row.layers.history],
                  ["VAL",row.layers.valuationHistory],
                  ["CAP",row.layers.capitalAllocation],
                  ["PEER",row.layers.peers],
                  ["CONS",row.layers.consensus],
                ].map(([label,value])=>(
                  <div key={String(label)}>
                    <span>{label}</span>
                    <strong className={tone(value as number|null)}>{pct(value as number|null)}</strong>
                  </div>
                ))}
              </div>

              <div className={styles.gaps}>
                <span>Open gaps</span>
                <div>
                  {row.gaps.length
                    ?row.gaps.slice(0,4).map((gap,index)=><b key={String(gap.layer)+String(gap.field)+index}>{gapLabel(gap)}</b>)
                    :<b className={styles.clearGap}>No material gaps</b>}
                  {row.gaps.length>4?<em>+{row.gaps.length-4} more</em>:null}
                </div>
              </div>

              <div className={styles.repair}>
                <div className={styles.repairTop}>
                  <span>Repair status</span>
                  {job?<b className={styles["status_"+job.status]}>{statusLabel(job.status)}</b>:<b className={styles.status_completed}>Clear</b>}
                </div>
                {job?(
                  <>
                    <strong>{statusLabel(job.repairType)}</strong>
                    <p>{job.reason}</p>
                    <small>
                      Priority {job.priority}
                      {autoCount?" · "+autoCount+" auto":""}
                      {reviewCount?" · "+reviewCount+" review":""}
                      {job.attemptCount?" · "+job.attemptCount+" attempt"+(job.attemptCount===1?"":"s"):""}
                    </small>
                    {job.lastError?<em className={styles.error}>{job.lastError}</em>:null}
                  </>
                ):(
                  <p>Coverage v2 has no unresolved repair jobs for this company.</p>
                )}
              </div>

              <div className={styles.actions}>
                <Link href={"/research/"+row.ticker}>Open research →</Link>
              </div>
            </article>
          );
        })}

        {!visible.length?<div className={styles.empty}>No companies match this filter.</div>:null}
      </section>
    </div>
  );
}
