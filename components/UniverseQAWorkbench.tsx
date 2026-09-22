"use client";

import { useState } from "react";
import { buildUniverseQAReport } from "@/lib/universe-qa-engine.mjs";
import styles from "./UniverseQAWorkbench.module.css";

const pct=(v:unknown)=>v!==null&&v!==undefined&&Number.isFinite(Number(v))?Number(v).toFixed(1)+"%":"—";
const num=(v:unknown)=>v!==null&&v!==undefined&&Number.isFinite(Number(v))?Number(v).toFixed(1):"—";
const label=(v:unknown)=>String(v??"").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());

function parseUniverseText(text:string,fileName:string){
  if(fileName.endsWith(".jsonl")||fileName.endsWith(".ndjson")){
    return text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((line,i)=>{
      try{return JSON.parse(line);}catch{throw new Error("Invalid JSONL at line "+(i+1));}
    });
  }
  const parsed=JSON.parse(text);
  if(Array.isArray(parsed))return parsed;
  if(Array.isArray(parsed?.securities))return parsed.securities;
  throw new Error("File must be a JSON array, JSONL/NDJSON, or an object with a securities array.");
}

function MiniBar({value}:{value:number}){
  return <div className={styles.barTrack}><span style={{width:Math.max(0,Math.min(100,value))+"%"}} /></div>;
}

export function UniverseQAWorkbench(){
  const [report,setReport]=useState<any>(null);
  const [fileName,setFileName]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);

  async function load(file:File|null){
    if(!file)return;
    setBusy(true);setError("");setReport(null);setFileName(file.name);
    try{
      const text=await file.text();
      const rows=parseUniverseText(text,file.name.toLowerCase());
      const result=buildUniverseQAReport(rows,{limit:100});
      setReport(result);
    }catch(cause){
      setError(cause instanceof Error?cause.message:String(cause));
    }finally{
      setBusy(false);
    }
  }

  return <div className={styles.workbench}>
    <section className={styles.upload}>
      <div>
        <span className={styles.kicker}>LOCAL QA INPUT</span>
        <h2>Audit the normalized universe before materialization.</h2>
        <p>Select the SEC-first universe JSON generated on your machine. The file is parsed and screened in your browser; it is not uploaded or written to Supabase.</p>
      </div>
      <label className={styles.fileButton}>
        <span>{busy?"Auditing…":"Choose universe file"}</span>
        <input type="file" accept=".json,.jsonl,.ndjson,application/json" disabled={busy} onChange={e=>load(e.target.files?.[0]??null)} />
      </label>
      {fileName?<small>{fileName}</small>:null}
    </section>

    {error?<div className={styles.error}>{error}</div>:null}

    {report?<>

      <section className={report.status==="pass"?styles.passBanner:styles.reviewBanner}>
        <div>
          <span className={styles.kicker}>UNIVERSE QA V1</span>
          <h2>{report.status==="pass"?"QA PASS":"REVIEW REQUIRED"}</h2>
          <p>{report.blockers} blocker{report.blockers===1?"":"s"} · {report.review_items} review item{report.review_items===1?"":"s"} · {report.screening_methodology_version}</p>
        </div>
        <strong>{report.funnel.input_count.toLocaleString()}</strong>
        <small>input securities</small>
      </section>

      <section className={styles.metrics}>
        {[
          ["Unique tickers",report.funnel.unique_ticker_count],
          ["Excluded",report.funnel.excluded],
          ["Watch",report.funnel.watch],
          ["Research candidates",report.funnel.research_candidate],
          ["S100 candidates",report.funnel.solpient_100_candidate],
          ["Deep research",report.funnel.proposed_deep_research],
        ].map(([name,value])=><div className={styles.metricCard} key={String(name)}><span>{name}</span><strong>{Number(value).toLocaleString()}</strong></div>)}
      </section>

      <section className={styles.gridTwo}>
        <div className={styles.panel}>
          <div className={styles.panelHead}><div><span className={styles.kicker}>COVERAGE AUDIT</span><h2>Raw vs effective evidence</h2></div></div>
          <div className={styles.coverageGrid}>
            <div><span>Raw median</span><strong>{pct(report.coverage.raw_median_pct)}</strong></div>
            <div><span>Effective median</span><strong>{pct(report.coverage.effective_median_pct)}</strong></div>
            <div><span>Shortlist median</span><strong>{pct(report.coverage.shortlist_effective_median_pct)}</strong></div>
            <div><span>Ceiling applied</span><strong>{report.coverage.ceiling_applied_count}</strong></div>
            <div><span>Sector-sensitive</span><strong>{report.coverage.sector_sensitive_count}</strong></div>
            <div><span>Critical evidence avg</span><strong>{pct(report.coverage.critical_sector_evidence_average_pct)}</strong></div>
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHead}><div><span className={styles.kicker}>DATA QUALITY</span><h2>Feed health</h2></div></div>
          <div className={styles.coverageGrid}>
            <div><span>Unknown sector</span><strong>{pct(report.quality.missingClassificationPct)}</strong></div>
            <div><span>Missing liquidity</span><strong>{pct(report.quality.sparseLiquidityPct)}</strong></div>
            <div><span>Missing market cap</span><strong>{pct(report.quality.missingMarketCapPct)}</strong></div>
            <div><span>Missing price</span><strong>{pct(report.quality.missingPricePct)}</strong></div>
            <div><span>Duplicate tickers</span><strong>{report.duplicates.duplicateTickers.length}</strong></div>
            <div><span>Duplicate issuers</span><strong>{report.duplicates.duplicateIssuers.length}</strong></div>
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><span className={styles.kicker}>QA FINDINGS</span><h2>What needs human review</h2></div><small>{report.findings.length} findings</small></div>
        <div className={styles.findings}>
          {report.findings.length?report.findings.map((f:any)=><div key={f.key} className={f.severity==="blocker"?styles.blocker:styles.review}>
            <strong>{f.severity.toUpperCase()} · {label(f.key)}</strong>
            <span>{f.message}</span>
          </div>):<div className={styles.clean}>No QA blockers or review conditions detected.</div>}
        </div>
      </section>

      <section className={styles.gridTwo}>
        <div className={styles.panel}>
          <div className={styles.panelHead}><div><span className={styles.kicker}>SHORTLIST PROFILE MIX</span><h2>Concentration check</h2></div></div>
          <div className={styles.list}>
            {report.distribution.shortlistProfiles.slice(0,12).map((r:any)=><div key={r.key}>
              <span>{label(r.key)}</span><MiniBar value={r.pct}/><strong>{pct(r.pct)}</strong>
            </div>)}
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHead}><div><span className={styles.kicker}>EXCLUSION REASONS</span><h2>Failed investability gates</h2></div></div>
          <div className={styles.list}>
            {report.gate_failures.slice(0,12).map((r:any)=><div key={r.gate}>
              <span>{label(r.gate)}</span><MiniBar value={r.input_pct}/><strong>{pct(r.input_pct)}</strong>
            </div>)}
          </div>
        </div>
      </section>

      <section className={styles.gridTwo}>
        <div className={styles.panel}>
          <div className={styles.panelHead}><div><span className={styles.kicker}>MISSING EVIDENCE</span><h2>Most common research gaps</h2></div></div>
          <div className={styles.list}>
            {report.missing_metrics.slice(0,15).map((r:any)=><div key={r.metric}>
              <span>{r.label??label(r.metric)}</span><MiniBar value={r.eligible_pct}/><strong>{pct(r.eligible_pct)}</strong>
            </div>)}
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHead}><div><span className={styles.kicker}>OUTLIER WATCH</span><h2>Scores that deserve inspection</h2></div></div>
          <div className={styles.outlierGrid}>
            <div><span>High score / low evidence</span><strong>{report.outliers.highScoreLowCoverage.length}</strong></div>
            <div><span>Extreme score / thin raw data</span><strong>{report.outliers.extremeScoreThinEvidence.length}</strong></div>
            <div><span>Evidence ceiling compression</span><strong>{report.outliers.evidenceCompressed.length}</strong></div>
            <div><span>Potential value traps</span><strong>{report.outliers.valueTraps.length}</strong></div>
            <div><span>Expensive compounders</span><strong>{report.outliers.expensiveCompounders.length}</strong></div>
            <div><span>Sector evidence gaps</span><strong>{report.outliers.sectorEvidenceBlocked.length}</strong></div>
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><span className={styles.kicker}>TOP 100 AUDIT</span><h2>Deep-research shortlist</h2></div><small>Screening output only · not investment recommendations</small></div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>#</th><th>Ticker</th><th>Profile</th><th>State</th><th>Score</th><th>Quality</th><th>Valuation</th><th>Raw cov.</th><th>Effective</th><th>Ceiling</th><th>Critical sector</th></tr></thead>
            <tbody>
              {report.top_shortlist.map((r:any)=><tr key={r.ticker}>
                <td>{r.rank}</td><td><strong>{r.ticker}</strong><small>{r.company_name??""}</small></td>
                <td>{label(r.profile)}</td><td>{label(r.state)}</td>
                <td>{num(r.screen_score)}</td><td>{num(r.quality_core_score)}</td><td>{num(r.valuation_score)}</td>
                <td>{pct(r.raw_coverage_pct)}</td><td>{pct(r.effective_coverage_pct)}</td>
                <td>{pct(r.evidence_ceiling_pct)}</td><td>{pct(r.critical_sector_evidence_pct)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.disclaimer}>
        <strong>Audit only.</strong>
        <span>Universe QA V1 does not change screening scores, readiness states, evidence ceilings, or candidate membership. It only evaluates the existing V2.1 outputs before an immutable universe run is written.</span>
      </section>
    </>:null}
  </div>;
}
