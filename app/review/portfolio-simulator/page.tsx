import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";
import { getAdminSupabase } from "@/lib/admin-supabase";
import { requireReviewAccess } from "@/lib/review-auth";
import { PortfolioSimulatorWorkbench } from "./PortfolioSimulatorWorkbench";
import reviewStyles from "../review.module.css";

export const dynamic="force-dynamic";
export const runtime="nodejs";

export default async function PortfolioSimulatorPage(){
  await requireReviewAccess();
  const supabase=getAdminSupabase();
  if(!supabase)return null;

  const [companiesR,rankingsR,draftsR]=await Promise.all([
    supabase.from("companies").select("id,ticker,company_name").order("ticker"),
    supabase.from("ranking_history")
      .select("company_id,research_run_id,ranked_at,rank,decision_score,business_quality_score,investment_opportunity_score,evidence_confidence_score,readiness_state,price,base_fair_value,methodology_version")
      .order("ranked_at",{ascending:false})
      .order("rank",{ascending:true})
      .limit(3000),
    supabase.from("baseline_drafts")
      .select("company_id,industry_module,generated_at")
      .order("generated_at",{ascending:false})
      .limit(3000),
  ]);
  for(const r of [companiesR,rankingsR,draftsR])if(r.error)throw r.error;

  const latestRankedAt=rankingsR.data?.[0]?.ranked_at??null;
  const rankingRows=(rankingsR.data??[]).filter((row:any)=>row.ranked_at===latestRankedAt);
  const runIds=[...new Set(rankingRows.map((row:any)=>row.research_run_id).filter(Boolean))];

  const [valuationsR,returnsR]=runIds.length
    ? await Promise.all([
        supabase.from("valuations")
          .select("research_run_id,bear_value,base_value,bull_value")
          .in("research_run_id",runIds),
        supabase.from("expected_return_scenarios")
          .select("research_run_id,scenario,horizon_years,expected_cagr,created_at")
          .in("research_run_id",runIds)
          .eq("scenario","base")
          .eq("horizon_years",5)
          .order("created_at",{ascending:false}),
      ])
    : [{data:[],error:null},{data:[],error:null}];

  for(const r of [valuationsR,returnsR])if(r.error)throw r.error;

  const companies=new Map((companiesR.data??[]).map((row:any)=>[row.id,row]));
  const drafts=new Map<string,any>();
  for(const row of draftsR.data??[])if(!drafts.has(row.company_id))drafts.set(row.company_id,row);
  const valuations=new Map((valuationsR.data??[]).map((row:any)=>[row.research_run_id,row]));
  const returns=new Map<string,any>();
  for(const row of returnsR.data??[])if(!returns.has(row.research_run_id))returns.set(row.research_run_id,row);

  const candidates=rankingRows.map((row:any)=>{
    const company:any=companies.get(row.company_id);
    const valuation:any=valuations.get(row.research_run_id)??{};
    const expected:any=returns.get(row.research_run_id)??{};
    const draft:any=drafts.get(row.company_id);
    return{
      rank:Number(row.rank)||null,
      ticker:company?.ticker??row.company_id,
      company_name:company?.company_name??null,
      group:draft?.industry_module??"Unclassified",
      readiness_state:row.readiness_state??"building",
      decision_score:row.decision_score==null?null:Number(row.decision_score),
      business_quality_score:row.business_quality_score==null?null:Number(row.business_quality_score),
      investment_opportunity_score:row.investment_opportunity_score==null?null:Number(row.investment_opportunity_score),
      evidence_confidence_score:row.evidence_confidence_score==null?null:Number(row.evidence_confidence_score),
      base_5y_cagr:expected.expected_cagr==null?null:Number(expected.expected_cagr),
      current_price:row.price==null?null:Number(row.price),
      bear_value:valuation.bear_value==null?null:Number(valuation.bear_value),
      base_value:valuation.base_value==null
        ?(row.base_fair_value==null?null:Number(row.base_fair_value))
        :Number(valuation.base_value),
      bull_value:valuation.bull_value==null?null:Number(valuation.bull_value),
    };
  }).filter((row:any)=>row.ticker).sort((a:any,b:any)=>(a.rank??9999)-(b.rank??9999)||a.ticker.localeCompare(b.ticker));

  return <>
    <header className={reviewStyles.header}>
      <SolpientBrand subtitle="Portfolio / Capital Allocation Simulator" />
      <div>
        <Link href="/review">Research Review</Link>
        <Link href="/research">Public Research</Link>
      </div>
    </header>

    <main className={reviewStyles.shell}>
      <section className={reviewStyles.hero}>
        <div>
          <span className={reviewStyles.kicker}>WHAT-IF CAPITAL ALLOCATION</span>
          <h1>See what a trade changes before capital moves.</h1>
          <p>
            Combine user-entered holdings with Solpient's latest ranking, evidence confidence,
            readiness, valuation scenarios, and expected-return assumptions. The simulator never
            executes trades and never writes portfolio scenarios back into research history.
          </p>
        </div>
        <div className={reviewStyles.heroProgress}>
          <span>Research candidates</span>
          <strong>{candidates.length}</strong>
          <small>{latestRankedAt?"Latest ranking snapshot loaded":"No ranking snapshot found"}</small>
        </div>
      </section>

      {!candidates.length?<section className={reviewStyles.preparePanel}>
        <div>
          <span className={reviewStyles.kicker}>WAITING FOR RANKINGS</span>
          <h2>No portfolio candidates are available yet.</h2>
          <p>The simulator requires at least one Decision Ranking snapshot. It does not fabricate research metadata for unranked tickers.</p>
        </div>
      </section>:<PortfolioSimulatorWorkbench candidates={candidates} rankedAt={latestRankedAt} />}
    </main>
  </>;
}
