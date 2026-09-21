"use client";

import { useMemo, useState } from "react";
import {
  analyzePortfolio,
  simulateTrades,
  DEFAULT_GUARDRAILS,
  type PortfolioCandidate,
} from "@/lib/portfolio-simulator.mjs";
import styles from "./portfolio-simulator.module.css";

type Candidate = PortfolioCandidate & {
  rank:number|null;
};

const money=(v:unknown)=>Number.isFinite(Number(v))
  ?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(v))
  :"—";
const pct=(v:unknown,d=1)=>Number.isFinite(Number(v))?Number(v).toFixed(d)+"%":"—";
const score=(v:unknown)=>Number.isFinite(Number(v))?Number(v).toFixed(1):"—";
const label=(v:unknown)=>String(v??"").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
const num=(v:string)=>{const x=Number(v.replaceAll(",",""));return Number.isFinite(x)?x:0;};

function MetricCard({name,current,after,format}:{name:string;current:unknown;after?:unknown;format:(v:unknown)=>string}){
  const changed=after!==undefined&&Number.isFinite(Number(current))&&Number.isFinite(Number(after))&&Math.abs(Number(after)-Number(current))>.0001;
  return <div className={styles.metricCard}>
    <span>{name}</span>
    <strong>{format(after===undefined?current:after)}</strong>
    {after!==undefined?<small className={changed?styles.changed:""}>Current {format(current)}</small>:<small>Current scenario</small>}
  </div>;
}

export function PortfolioSimulatorWorkbench({
  candidates,
  rankedAt,
}:{candidates:Candidate[];rankedAt:string|null}){
  const [cash,setCash]=useState("10000");
  const [holdings,setHoldings]=useState<Record<string,string>>({});
  const [trades,setTrades]=useState<Record<string,string>>({});
  const [constraints,setConstraints]=useState<Record<string,number>>({...DEFAULT_GUARDRAILS});

  const portfolio=useMemo(()=>({
    name:"Workbench portfolio",
    cash:num(cash),
    positions:candidates
      .map(c=>({...c,market_value:num(holdings[c.ticker]??"")}))
      .filter(p=>p.market_value>0),
  }),[cash,holdings,candidates]);

  const current=useMemo(()=>analyzePortfolio(portfolio,constraints),[portfolio,constraints]);

  const activeTrades=useMemo(()=>Object.entries(trades)
    .map(([ticker,value])=>({ticker,amount:num(value)}))
    .filter(t=>t.amount!==0),[trades]);

  const simulation=useMemo(()=>{
    if(!activeTrades.length)return{result:null as any,error:null as string|null};
    try{
      return{
        result:simulateTrades({portfolio,candidates,trades:activeTrades,constraints}),
        error:null,
      };
    }catch(error){
      return{result:null,error:error instanceof Error?error.message:String(error)};
    }
  },[portfolio,candidates,activeTrades,constraints]);

  const after=simulation.result?.after??current;
  const holdingsCount=portfolio.positions.length;
  const proposedCount=activeTrades.length;

  const setConstraint=(key:string,value:string)=>{
    const x=Number(value);
    if(Number.isFinite(x))setConstraints(prev=>({...prev,[key]:x}));
  };

  return <div className={styles.workbench}>
    <section className={styles.controls}>
      <div>
        <span className={styles.kicker}>SCENARIO INPUTS</span>
        <h2>Current portfolio</h2>
        <p>Enter market value, not share count. Nothing is saved or sent to a broker.</p>
      </div>
      <label>
        <span>Cash</span>
        <input value={cash} onChange={e=>setCash(e.target.value)} inputMode="decimal" />
      </label>
      <div className={styles.controlSummary}>
        <strong>{holdingsCount}</strong><span>positions</span>
        <strong>{proposedCount}</strong><span>proposed trades</span>
      </div>
    </section>

    <section className={styles.metrics}>
      <MetricCard name="Portfolio value" current={current.total_value} after={simulation.result?after.total_value:undefined} format={money} />
      <MetricCard name="Cash weight" current={current.cash_weight_pct} after={simulation.result?after.cash_weight_pct:undefined} format={pct} />
      <MetricCard name="Decision Ready weight" current={current.readiness.decision_ready.weight_pct} after={simulation.result?after.readiness.decision_ready.weight_pct:undefined} format={pct} />
      <MetricCard name="Weighted decision score" current={current.weighted_metrics.decision_score.value} after={simulation.result?after.weighted_metrics.decision_score.value:undefined} format={score} />
      <MetricCard name="Weighted evidence" current={current.weighted_metrics.evidence_confidence_score.value} after={simulation.result?after.weighted_metrics.evidence_confidence_score.value:undefined} format={score} />
      <MetricCard name="Base 5Y CAGR" current={current.portfolio_base_5y_cagr} after={simulation.result?after.portfolio_base_5y_cagr:undefined} format={pct} />
    </section>

    {simulation.error?<div className={styles.error}>{simulation.error}</div>:null}

    <section className={styles.gridTwo}>
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <div><span className={styles.kicker}>VALUATION MARKS</span><h2>What if prices moved to stored fair values?</h2></div>
          <small>Not a time-based forecast</small>
        </div>
        <div className={styles.markGrid}>
          {(["bear","base","bull"] as const).map(k=><div key={k}>
            <span>{label(k)}</span>
            <strong>{pct(after.fair_value_marks[k].change_pct)}</strong>
            <small>{pct(after.fair_value_marks[k].coverage_pct)} covered</small>
          </div>)}
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <div><span className={styles.kicker}>CONCENTRATION</span><h2>After proposed trades</h2></div>
          <small>{after.position_count} positions</small>
        </div>
        <div className={styles.markGrid}>
          <div><span>Largest position</span><strong>{pct(after.concentration.largest_position_pct)}</strong><small>of total portfolio</small></div>
          <div><span>Top 3</span><strong>{pct(after.concentration.top_3_pct)}</strong><small>of total portfolio</small></div>
          <div><span>Largest group</span><strong>{pct(after.groups[0]?.weight_pct??0)}</strong><small>{after.groups[0]?.group??"—"}</small></div>
        </div>
      </div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <span className={styles.kicker}>CAPITAL ALLOCATION TABLE</span>
          <h2>Current holdings and proposed dollar changes</h2>
        </div>
        <small>{rankedAt?("Decision snapshot "+new Date(rankedAt).toLocaleString()):"No ranking snapshot timestamp"}</small>
      </div>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr>
            <th>Rank</th><th>Company</th><th>Readiness</th><th>Decision</th><th>Evidence</th><th>5Y CAGR</th><th>Current value</th><th>Trade ±$</th>
          </tr></thead>
          <tbody>
            {candidates.map(c=><tr key={c.ticker}>
              <td>{c.rank??"—"}</td>
              <td><strong>{c.ticker}</strong><small>{c.company_name??""}</small></td>
              <td>{label(c.readiness_state)}</td>
              <td>{score(c.decision_score)}</td>
              <td>{score(c.evidence_confidence_score)}</td>
              <td>{pct(c.base_5y_cagr)}</td>
              <td><input aria-label={c.ticker+" current market value"} value={holdings[c.ticker]??""} onChange={e=>setHoldings(prev=>({...prev,[c.ticker]:e.target.value}))} placeholder="0" inputMode="decimal" /></td>
              <td><input aria-label={c.ticker+" proposed trade"} value={trades[c.ticker]??""} onChange={e=>setTrades(prev=>({...prev,[c.ticker]:e.target.value}))} placeholder="+ buy / - sell" inputMode="decimal" /></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>

    <section className={styles.gridTwo}>
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <div><span className={styles.kicker}>GUARDRAILS</span><h2>{after.guardrails.failed} constraint breach{after.guardrails.failed===1?"":"es"}</h2></div>
          <small>{pct(after.guardrails.pass_pct)} passing</small>
        </div>
        <div className={styles.guardrailList}>
          {after.guardrails.checks.map((g:any)=><div className={g.pass?styles.pass:styles.fail} key={g.key}>
            <div><strong>{label(g.key)}</strong><small>{g.detail}</small></div>
            <span>{g.actual==null?"—":score(g.actual)} / {score(g.limit)}</span>
          </div>)}
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <div><span className={styles.kicker}>EDITABLE LIMITS</span><h2>Planning constraints</h2></div>
          <small>Illustrative defaults, not universal rules</small>
        </div>
        <div className={styles.constraintGrid}>
          {Object.entries(constraints).map(([key,value])=><label key={key}>
            <span>{label(key)}</span>
            <input type="number" value={value} min="0" max="100" step="1" onChange={e=>setConstraint(key,e.target.value)} />
          </label>)}
        </div>
      </div>
    </section>

    <section className={styles.gridTwo}>
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <div><span className={styles.kicker}>RESEARCH READINESS</span><h2>After proposed trades</h2></div>
        </div>
        <div className={styles.exposureList}>
          {Object.entries(after.readiness).map(([key,row]:any)=><div key={key}><span>{label(key)}</span><strong>{pct(row.weight_pct)}</strong><small>{money(row.market_value)}</small></div>)}
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <div><span className={styles.kicker}>GROUP EXPOSURE</span><h2>After proposed trades</h2></div>
        </div>
        <div className={styles.exposureList}>
          {after.groups.slice(0,8).map((row:any)=><div key={row.group}><span>{label(row.group)}</span><strong>{pct(row.weight_pct)}</strong><small>{money(row.market_value)}</small></div>)}
          {!after.groups.length?<p className={styles.muted}>No invested positions yet.</p>:null}
        </div>
      </div>
    </section>

    <section className={styles.disclaimer}>
      <strong>Simulation only.</strong>
      <span>
        This workbench compares user-entered allocation scenarios using Solpient research outputs.
        It does not execute trades. Stored bear/base/bull values are displayed as immediate fair-value
        marks, not forecasts of when prices will reach those values. Missing metrics reduce coverage
        rather than being silently estimated.
      </span>
    </section>
  </div>;
}
