import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { SolpientBrand } from "@/components/SolpientBrand";
import { ResearchHealthDashboard } from "@/components/ResearchHealthDashboard";
import styles from "./research-health.module.css";

export const dynamic = "force-dynamic";

export default async function ResearchHealthPage() {
  const supabase=getSupabase();

  if(!supabase){
    return(
      <main className={styles.offline}>
        <strong>SOLPIENT</strong>
        <h1>Research Health & Repair Center</h1>
        <p>Supabase is not configured for this deployment.</p>
        <Link href="/">Return home →</Link>
      </main>
    );
  }

  const [companiesR,coverageR,jobsR,automationR]=await Promise.all([
    supabase.from("companies").select("id,ticker,company_name,sector").order("ticker"),
    supabase.from("data_coverage_reports").select("*").eq("engine_version","coverage-v2").order("as_of_date",{ascending:false}).order("generated_at",{ascending:false}),
    supabase.from("research_repair_jobs").select("id,company_id,layer,field,repair_type,automation_mode,status,priority,reason,attempt_count,last_error,updated_at").order("priority",{ascending:false}),
    supabase.from("automation_runs").select("pipeline,completed_at,status,records_written").eq("pipeline","research_repair_center").order("started_at",{ascending:false}).limit(1).maybeSingle(),
  ]);

  const companies=companiesR.data??[];
  const latestCoverage=new Map<string,any>();
  for(const row of coverageR.data??[])if(!latestCoverage.has(row.company_id))latestCoverage.set(row.company_id,row);
  const jobsByCompany=new Map<string,any[]>();
  for(const job of jobsR.data??[]){
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
          latestRepairRun={automationR.data??null}
        />
      </main>

      <footer className={styles.footer}>
        <div><strong>SOLPIENT</strong><span>See clearly. Repair evidence gaps deliberately.</span></div>
        <span>Coverage v2 · automated repair queue · review guardrails</span>
      </footer>
    </div>
  );
}
