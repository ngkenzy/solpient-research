import Link from "next/link";
import { loadResearchHealthData } from "@/lib/repositories/research-health";
import { SolpientBrand } from "@/components/SolpientBrand";
import { ResearchHealthDashboard } from "@/components/ResearchHealthDashboard";
import styles from "./research-health.module.css";

export const dynamic = "force-dynamic";

export default async function ResearchHealthPage() {
  const data=await loadResearchHealthData();

  if(!data){
    return(
      <main className={styles.offline}>
        <strong>SOLPIENT</strong>
        <h1>Research Health & Repair Center</h1>
        <p>No Solpient data source is configured for this deployment.</p>
        <Link href="/">Return home →</Link>
      </main>
    );
  }

  const companies=data.companies;
  const coverage=data.coverage;
  const jobs=data.jobs;
  const latestRepairRun=data.latestRepairRun;

  const latestCoverage=new Map<string,any>();
  for(const row of coverage)if(!latestCoverage.has(row.company_id))latestCoverage.set(row.company_id,row);
  const jobsByCompany=new Map<string,any[]>();
  for(const job of jobs){
    const rows=jobsByCompany.get(job.company_id)??[];
    rows.push(job);
    jobsByCompany.set(job.company_id,rows);
  }

  const rows=companies.map((company:any)=>{
    const report=latestCoverage.get(company.id)??{};
    const details=report.coverage_details??{};
    return{
      id:company.id,
      ticker:company.ticker,
      companyName:company.company_name,
      sector:company.sector??null,
      readiness:report.decision_readiness_pct==null?null:Number(report.decision_readiness_pct),
      overall:report.overall_pct==null?null:Number(report.overall_pct),
      coverageDate:report.as_of_date??null,
      layers:{
        fundamentals:report.fundamentals_pct==null?null:Number(report.fundamentals_pct),
        balanceSheet:report.balance_sheet_pct==null?null:Number(report.balance_sheet_pct),
        history:report.history_pct==null?null:Number(report.history_pct),
        marketHistory:report.market_history_pct==null?null:Number(report.market_history_pct),
        valuationHistory:report.valuation_history_pct==null?null:Number(report.valuation_history_pct),
        capitalAllocation:report.capital_allocation_pct==null?null:Number(report.capital_allocation_pct),
        peers:report.peer_pct==null?null:Number(report.peer_pct),
        industry:report.industry_pct==null?null:Number(report.industry_pct),
        consensus:report.consensus_pct==null?null:Number(report.consensus_pct),
      },
      gaps:Array.isArray(report.missing_fields)?report.missing_fields:[],
      jobs:(jobsByCompany.get(company.id)??[]).map((job:any)=>({
        id:job.id,
        layer:job.layer,
        field:job.field,
        repairType:job.repair_type,
        automationMode:job.automation_mode,
        status:job.status,
        priority:Number(job.priority??0),
        reason:job.reason??null,
        attemptCount:Number(job.attempt_count??0),
        lastError:job.last_error??null,
        updatedAt:job.updated_at??null,
      })),
      facts:{
        valuationObservations:details.valuation_observations??null,
        capitalYears:details.capital_complete_years??null,
        peerCount:details.peer_metric_tickers??null,
        consensusSnapshots:details.consensus_snapshots??null,
      }
    };
  });

  return(
    <div className={styles.page}>
      <header className={styles.topbar}>
        <SolpientBrand className={styles.brand} subtitle="Research" priority />
        <nav>
          <Link href="/">Home</Link>
          <Link href="/research">Research</Link>
          <Link className={styles.active} href="/research-health">Research Health</Link>
          <Link href="/money">Money</Link>
          <Link href="/watchlist">Watchlist</Link>
          <Link href="/alerts">Alerts</Link>
        </nav>
        <Link className={styles.commandLink} href="/research">Open Research →</Link>
      </header>

      <main className={styles.main}>
        <ResearchHealthDashboard
          rows={rows}
          latestRepairRun={latestRepairRun}
        />
      </main>

      <footer className={styles.footer}>
        <div><strong>SOLPIENT</strong><span>See clearly. Repair evidence gaps deliberately.</span></div>
        <span>Coverage v2 · automated repair queue · review guardrails</span>
      </footer>
    </div>
  );
}
