import { getSupabase } from "@/lib/supabase";
import { databaseConfigured, dbQuery } from "@/lib/db";

function n(value:unknown){const x=Number(value);return Number.isFinite(x)?x:null;}
function labelGap(item:any){
  const labels:Record<string,string>={
    complete_fiscal_years:"Complete fiscal-year history",
    trading_days:"Market-price history",
    monthly_valuation_history:"Point-in-time valuation history",
    industry_module_coverage:"Industry-specific evidence",
    peer_data_coverage:"Normalized peer comparison",
    point_in_time_snapshots:"Consensus revision history",
    published_v2_research:"Published v2 research",
    formula_components_not_persisted:"Persisted valuation formula",
  };
  return labels[item?.field]??String(item?.field??"Coverage gap").replaceAll("_"," ");
}

export async function ResearchCoveragePanel({companyId,asOf=null}:{companyId:string;asOf?:string|null}) {
  let data:any[]=[];
  if(databaseConfigured()){
    data=await dbQuery<any>(
      asOf
        ? `
            select *
            from public.data_coverage_reports
            where company_id=$1
              and as_of_date <= $2::date
              and generated_at <= $3::timestamptz
            order by as_of_date desc, generated_at desc
            limit 10
          `
        : `
            select *
            from public.data_coverage_reports
            where company_id=$1
            order by as_of_date desc, generated_at desc
            limit 10
          `,
      asOf?[companyId,asOf.slice(0,10),asOf]:[companyId],
    );
  }else{
    const supabase=getSupabase();
    if(!supabase)return null;
    let coverageQuery=supabase
      .from("data_coverage_reports")
      .select("*")
      .eq("company_id",companyId);
    if(asOf){
      coverageQuery=coverageQuery
        .lte("as_of_date",asOf.slice(0,10))
        .lte("generated_at",asOf);
    }
    const result=await coverageQuery
      .order("as_of_date",{ascending:false})
      .order("generated_at",{ascending:false})
      .limit(10);
    data=result.data??[];
  }

  const report=(data??[]).find((row:any)=>row.engine_version==="coverage-v2")??data?.[0];
  if(!report)return null;

  const layers=[
    ["Fundamentals",report.fundamentals_pct],
    ["Balance sheet",report.balance_sheet_pct],
    ["Financial history",report.history_pct],
    ["Market history",report.market_history_pct],
    ["Valuation history",report.valuation_history_pct],
    ["Capital allocation",report.capital_allocation_pct],
    ["Peers",report.peer_pct],
    ["Industry evidence",report.industry_pct],
    ["Consensus",report.consensus_pct],
  ] as const;
  const readiness=n(report.decision_readiness_pct)??n(report.overall_pct);
  const gaps=Array.isArray(report.missing_fields)?report.missing_fields:[];

  return (
    <section className="coveragePanelSection">
      <div className="coveragePanelHeader">
        <div>
          <span className="panelKicker">RESEARCH COVERAGE</span>
          <h2>Can we trust the full analysis?</h2>
          <p>Coverage v2 scores the evidence required to support charts, peer comparisons, valuation, and the final decision.</p>
        </div>
        <div className={"coverageScore "+(readiness!=null&&readiness>=85?"good":readiness!=null&&readiness>=70?"warn":"bad")}>
          <strong>{readiness==null?"—":readiness.toFixed(0)+"%"}</strong>
          <span>decision readiness</span>
        </div>
      </div>

      <div className="coverageLayerGrid">
        {layers.map(([label,value])=>{
          const score=n(value);
          return (
            <div className="coverageLayer" key={label}>
              <div><span>{label}</span><strong>{score==null?"—":score.toFixed(0)+"%"}</strong></div>
              <i><b style={{width:(score??0)+"%"}} /></i>
            </div>
          );
        })}
      </div>

      <div className="coverageBottomGrid">
        <div>
          <span className="panelKicker">OPEN DATA GAPS</span>
          {gaps.length?(
            <div className="coverageGapList">
              {gaps.slice(0,8).map((gap:any,index:number)=>(
                <div key={String(gap.layer)+String(gap.field)+index}>
                  <strong>{labelGap(gap)}</strong>
                  <span>{String(gap.layer??"research").replaceAll("_"," ")}</span>
                </div>
              ))}
            </div>
          ):<p className="coverageComplete">No material coverage gaps detected.</p>}
        </div>
        <div className="coverageDetails">
          <span className="panelKicker">COVERAGE FACTS</span>
          <div><span>Valuation observations</span><strong>{report.coverage_details?.valuation_observations??"—"}</strong></div>
          <div><span>Capital years</span><strong>{report.coverage_details?.capital_complete_years??"—"}/5</strong></div>
          <div><span>Peer companies</span><strong>{report.coverage_details?.peer_metric_tickers??"—"}</strong></div>
          <div><span>Consensus snapshots</span><strong>{report.coverage_details?.consensus_snapshots??"—"}</strong></div>
          <div><span>As of</span><strong>{report.as_of_date??"—"}</strong></div>
        </div>
      </div>
    </section>
  );
}
