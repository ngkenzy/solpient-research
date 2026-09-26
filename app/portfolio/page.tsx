import Link from "next/link";
import { redirect } from "next/navigation";
import { ConsumerHeader } from "@/components/ConsumerHeader";
import { createConsumerServerClient } from "@/lib/supabase/server-client";
import {
  createPortfolioAction,
  deletePositionAction,
  signOutAction,
  upsertPositionAction,
} from "./actions";
import styles from "./portfolio.module.css";

export const dynamic="force-dynamic";
export const revalidate=0;

function n(value:unknown) {
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:0;
}

function money(value:number|null|undefined) {
  if(value==null||!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US",{
    style:"currency",
    currency:"USD",
    maximumFractionDigits:2,
  }).format(value);
}

function quantity(value:number) {
  return new Intl.NumberFormat("en-US",{maximumFractionDigits:4}).format(value);
}

function pct(share:number) {
  return (share*100).toFixed(1)+"%";
}

// ---- V1: effective position weights (mirrors group-b-user-materiality-v2) ----
// Per portfolio: basis = manual market_value ?? live price value ?? cost basis
// for owned positions; manual target weight overrides the derived share;
// missing dollars everywhere -> equal weighting among owned names.
// Follow positions carry no weight (share null).
function weightShares(
  rows:any[],
  companyById:Map<string,any>,
  marketByTicker:Map<string,any>
){
  const owned=rows.filter((row:any)=>row.relationship!=="follow");
  const bases=new Map<string,number>();
  const livePrices=new Map<string,number>();
  for(const row of owned){
    const company=companyById.get(row.company_id);
    const qty=n(row.quantity);
    const price=n(marketByTicker.get(company?.ticker)?.price);
    livePrices.set(row.id,price);
    const manual=row.market_value==null?null:n(row.market_value);
    const live=price>0?qty*price:null;
    const cost=row.average_cost==null?null:qty*n(row.average_cost);
    bases.set(row.id,manual??live??cost??0);
  }
  const total=[...bases.values()].reduce((a,b)=>a+b,0);
  const raws=new Map<string,number>();
  for(const row of owned){
    const manualPct=row.weight==null?null:n(row.weight)/100;
    const dollarShare=total>0?(bases.get(row.id)??0)/total:1/Math.max(owned.length,1);
    raws.set(row.id,manualPct??dollarShare);
  }
  const rawTotal=[...raws.values()].reduce((a,b)=>a+b,0);
  const fallbackEqual=rawTotal===0;
  const out=new Map<string,{share:number|null;basis:string}>();
  for(const row of rows){
    if(row.relationship==="follow"){
      out.set(row.id,{share:null,basis:"follow"});
      continue;
    }
    const share=fallbackEqual?1/Math.max(owned.length,1):(raws.get(row.id)??0)/rawTotal;
    let basis="equal share";
    if(row.weight!=null) basis="target";
    else if(!fallbackEqual){
      if(row.market_value!=null) basis="market value";
      else if((livePrices.get(row.id)??0)>0) basis="live price";
      else if(row.average_cost!=null) basis="cost basis";
    }
    out.set(row.id,{share,basis});
  }
  return out;
}

// ---- V1 quick wins: per-company freshness block (PRD section 13) ----
// This page reads research state ONLY through the get_my_portfolio_research_state_v1
// RPC, whose `freshness` payload is keyed by component_key and exposes per component:
// status, last_checked_at, latest_evidence_at, last_reviewed_at,
// last_recalculated_at, last_published_at, evidence_since_publication, next_due_at.
// It does NOT expose the research_freshness table columns, so the PRD section 13
// labels are mapped below to the closest field the contract actually exposes:
//   Last evidence check  (market_updated_at)        -> market_data.last_checked_at
//   Last market refresh  (market_updated_at)        -> market_data.latest_evidence_at
//   Last fundamental refresh (fundamentals_updated_at) -> fundamentals.latest_evidence_at
//   Last research review (research_reviewed_at)     -> thesis_review.last_reviewed_at
//                                                    (fallback: published_research.last_reviewed_at)
//   Last thesis change   (thesis_changed_at)        -> thesis_review.latest_evidence_at
//   Next review due      (next_review_due_at)       -> thesis_review.next_due_at
//                                                    (fallback: published_research.next_due_at)
// Skipped because the contract does not expose them: peers_updated_at,
// historical_valuation_updated_at, checklist_updated_at, last_full_refresh_at.
function freshnessAt(contract:any,key:string,field:string) {
  const item=contract?.freshness?.[key];
  const value=item?.[field];
  if(typeof value!=="string"||!value) return null;
  return Number.isNaN(new Date(value).getTime())?null:value;
}

function relAgo(value:string|null) {
  if(!value) return "—";
  const then=new Date(value).getTime();
  if(!Number.isFinite(then)) return "—";
  const diff=Date.now()-then;
  if(diff<0) return "—";
  const minute=60*1000;
  const hour=60*minute;
  const day=24*hour;
  if(diff<minute) return "just now";
  if(diff<hour) return Math.floor(diff/minute)+"m ago";
  if(diff<day) return Math.floor(diff/hour)+"h ago";
  if(diff<30*day) return Math.floor(diff/day)+"d ago";
  if(diff<365*day) return Math.floor(diff/(30*day))+"mo ago";
  return Math.floor(diff/(365*day))+"y ago";
}

function researchState(contract:any) {
  const coverage=contract?.coverage?.coverage_level ?? "MONITORED";
  const currentResearch=contract?.current_research ?? null;
  const freshness=Object.values(contract?.freshness ?? {}) as any[];
  const statuses=freshness.map((item:any)=>String(item?.status??""));

  const count=(status:string)=>statuses.filter((value)=>value===status).length;
  const newEvidence=count("NEW_EVIDENCE");
  const reviewDue=count("REVIEW_DUE");
  const stale=count("STALE");

  let label="Current";
  let tone="current";
  let attention=false;

  if(newEvidence>0){
    label="New evidence";
    tone="newEvidence";
    attention=true;
  }else if(reviewDue>0){
    label="Review due";
    tone="reviewDue";
    attention=true;
  }else if(stale>0){
    label="Stale";
    tone="stale";
    attention=true;
  }else if(!currentResearch){
    label="Monitored";
    tone="monitored";
  }

  const coverageLabel=coverage==="DEEP_COVERAGE"
    ? "Deep coverage"
    : coverage==="RESEARCHED"
      ? "Researched"
      : coverage==="UNSUPPORTED"
        ? "Unsupported"
        : "Monitored";

  // PRD section 12 copy for the UNSUPPORTED coverage level.
  const coverageNote=coverage==="UNSUPPORTED"
    ? "Insufficient data or security type not currently supported"
    : null;

  const version=currentResearch?.version ? "v"+currentResearch.version : null;

  const freshnessRows=[
    {label:"Last evidence check",value:relAgo(freshnessAt(contract,"market_data","last_checked_at"))},
    {label:"Last market refresh",value:relAgo(freshnessAt(contract,"market_data","latest_evidence_at"))},
    {label:"Last fundamental refresh",value:relAgo(freshnessAt(contract,"fundamentals","latest_evidence_at"))},
    {label:"Last research review",value:relAgo(
      freshnessAt(contract,"thesis_review","last_reviewed_at")
      ?? freshnessAt(contract,"published_research","last_reviewed_at")
    )},
    {label:"Last thesis change",value:relAgo(freshnessAt(contract,"thesis_review","latest_evidence_at"))},
    {label:"Next review due",value:relAgo(
      freshnessAt(contract,"thesis_review","next_due_at")
      ?? freshnessAt(contract,"published_research","next_due_at")
    )},
  ];

  return{
    label,
    tone,
    attention,
    coverageLabel,
    version,
    coverageNote,
    freshnessRows,
    lastCheckedAt:freshnessAt(contract,"market_data","last_checked_at"),
    dataCutoffAt:currentResearch?.data_cutoff_at ?? null,
    newEvidence,
    reviewDue,
    stale,
  };
}

function shortDate(value:string|null|undefined) {
  if(!value) return null;
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US",{
    month:"short",
    day:"numeric",
    year:"numeric",
    timeZone:"UTC",
  });
}

const errors:Record<string,string>={
  portfolio:"Portfolio could not be saved.",
  "portfolio-access":"That portfolio is not available to this account.",
  position:"Position could not be saved.",
  ticker:"Choose a company currently covered by Solpient.",
  delete:"Position could not be removed.",
};

export default async function PortfolioPage({
  searchParams,
}:{searchParams:Promise<{error?:string}>}) {
  const params=await searchParams;
  const supabase=await createConsumerServerClient();
  const {data:claimsData}=await supabase.auth.getClaims();
  const userId=claimsData?.claims?.sub ? String(claimsData.claims.sub) : null;
  if(!userId) redirect("/login");

  const [profileR,portfoliosR,companiesR]=await Promise.all([
    supabase.from("profiles").select("display_name,monitored_name_cap").eq("user_id",userId).maybeSingle(),
    supabase
      .from("portfolios")
      .select("id,name,is_default,base_currency,created_at")
      .order("is_default",{ascending:false})
      .order("created_at",{ascending:true}),
    supabase
      .from("companies")
      .select("id,ticker,company_name")
      .order("ticker"),
  ]);

  const portfolios=portfoliosR.data??[];
  const companies=companiesR.data??[];
  const portfolioIds=portfolios.map((row:any)=>row.id);

  const positionsR=portfolioIds.length
    ? await supabase
        .from("portfolio_positions")
        .select("id,portfolio_id,company_id,quantity,average_cost,opened_at,notes,created_at,relationship,market_value,weight")
        .in("portfolio_id",portfolioIds)
        .order("created_at",{ascending:true})
    : {data:[] as any[]};

  const positions=positionsR.data??[];

  const researchStateR=positions.length
    ? await supabase.rpc("get_my_portfolio_research_state_v1")
    : {data:{positions:[] as any[]}};

  const researchPositions=(researchStateR.data as any)?.positions??[];
  const researchByPosition=new Map<string,any>(
    researchPositions.map((item:any)=>[item.position_id,item.research_contract])
  );

  const companyById=new Map(companies.map((company:any)=>[company.id,company]));
  const positionTickers=[...new Set(
    positions
      .map((row:any)=>companyById.get(row.company_id)?.ticker)
      .filter(Boolean)
  )] as string[];

  const marketR=positionTickers.length
    ? await supabase
        .from("market_snapshots")
        .select("symbol,price,trading_date")
        .in("symbol",positionTickers)
        .order("trading_date",{ascending:false})
    : {data:[] as any[]};

  const marketByTicker=new Map<string,any>();
  for(const row of marketR.data??[]){
    if(!marketByTicker.has(row.symbol)) marketByTicker.set(row.symbol,row);
  }

  const positionsByPortfolio=new Map<string,any[]>();
  for(const row of positions){
    const list=positionsByPortfolio.get(row.portfolio_id)??[];
    list.push(row);
    positionsByPortfolio.set(row.portfolio_id,list);
  }

  let totalMarketValue=0;
  let totalCostBasis=0;
  let attentionCount=0;
  for(const row of positions){
    const company=companyById.get(row.company_id);
    const qty=n(row.quantity);
    const price=n(marketByTicker.get(company?.ticker)?.price);
    const avg=row.average_cost==null?null:n(row.average_cost);
    const value=row.market_value==null?qty*price:n(row.market_value);
    totalMarketValue+=value;
    if(avg!=null) totalCostBasis+=qty*avg;
    if(researchState(researchByPosition.get(row.id)).attention) attentionCount+=1;
  }

  const displayName=profileR.data?.display_name?.trim()||"Investor";
  const monitoredNameCap=Number(profileR.data?.monitored_name_cap)||12;
  const monitoredNames=new Set(positions.map((row:any)=>row.company_id)).size;
  const error=params.error==="cap"
    ? "Monitored-name limit reached ("+monitoredNames+" of "+monitoredNameCap+"). Remove a monitored name before adding another."
    : params.error?errors[params.error]:"";

  return(
    <div className={styles.page}>
      <ConsumerHeader
        active="portfolio"
        subtitle="Portfolio"
        action={
          <form action={signOutAction}>
            <button className={styles.signOut} type="submit">Sign out</button>
          </form>
        }
      />

      <main className={styles.main}>
        <section className={styles.hero}>
          <div>
            <span className={styles.kicker}>YOUR PORTFOLIO</span>
            <h1>{displayName}, know what changed in what you own.</h1>
            <p>
              Each holding is linked to Solpient's latest published research and evidence state. See which positions are current, stale, under review, or have new evidence—and jump directly into your thesis.
            </p>
          </div>
          <div className={styles.heroStats}>
            <div><span>Portfolios</span><strong>{portfolios.length}</strong></div>
            <div><span>Positions</span><strong>{positions.length}</strong></div>
            <div><span>Market value</span><strong>{money(totalMarketValue)}</strong></div>
            <div><span>Cost basis</span><strong>{totalCostBasis>0?money(totalCostBasis):"—"}</strong></div>
            <div><span>Needs attention</span><strong>{attentionCount}</strong></div>
            <div><span>Research linked</span><strong>{researchByPosition.size}/{positions.length}</strong></div>
          </div>
        </section>

        {error?<div className={styles.error}>{error}</div>:null}

        <section className={styles.controls}>
          <form action={upsertPositionAction} className={styles.positionForm}>
            <div>
              <span className={styles.sectionLabel}>ADD OR UPDATE POSITION</span>
              <strong>Track a company you own or follow</strong>
              <small className={styles.slotUsage}>Monitored names: {monitoredNames} of {monitoredNameCap} — adding a new company uses one slot; updating a tracked company does not.</small>
            </div>
            <label>
              <span>Portfolio</span>
              <select name="portfolio_id" required defaultValue={portfolios[0]?.id??""}>
                {portfolios.map((portfolio:any)=>(
                  <option value={portfolio.id} key={portfolio.id}>{portfolio.name}</option>
                ))}
              </select>
            </label>
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
              <input name="quantity" type="number" min="0.00000001" step="0.00000001" required placeholder="10" />
            </label>
            <label>
              <span>Average cost</span>
              <input name="average_cost" type="number" min="0" step="0.01" placeholder="250.00" />
            </label>
            <label>
              <span>Relationship</span>
              <select name="relationship" defaultValue="own">
                <option value="own">Own</option>
                <option value="follow">Follow</option>
              </select>
            </label>
            <label>
              <span>Market value ($)</span>
              <input name="market_value" type="number" min="0" step="0.01" placeholder="Optional" />
            </label>
            <label>
              <span>Target weight (%)</span>
              <input name="weight" type="number" min="0" max="100" step="0.01" placeholder="Optional" />
            </label>
            <button type="submit" disabled={!portfolios.length}>Save position</button>
          </form>

          <form action={createPortfolioAction} className={styles.newPortfolio}>
            <div>
              <span className={styles.sectionLabel}>NEW PORTFOLIO</span>
              <strong>Separate holdings by purpose</strong>
            </div>
            <input name="name" type="text" maxLength={120} required placeholder="Long-term portfolio" />
            <button type="submit">Create</button>
          </form>
        </section>

        <section className={styles.portfolioStack}>
          {portfolios.map((portfolio:any)=>{
            const rows=positionsByPortfolio.get(portfolio.id)??[];
            let portfolioValue=0;
            for(const row of rows){
              const company=companyById.get(row.company_id);
              const qty=n(row.quantity);
              const price=n(marketByTicker.get(company?.ticker)?.price);
              portfolioValue+=row.market_value==null?qty*price:n(row.market_value);
            }
            const weights=weightShares(rows,companyById,marketByTicker);

            return(
              <article className={styles.portfolioCard} key={portfolio.id}>
                <div className={styles.portfolioHeading}>
                  <div>
                    <span>{portfolio.is_default?"DEFAULT PORTFOLIO":"PORTFOLIO"}</span>
                    <h2>{portfolio.name}</h2>
                  </div>
                  <div>
                    <span>Market value</span>
                    <strong>{money(portfolioValue)}</strong>
                  </div>
                </div>

                {rows.length?(
                  <div className={styles.tableWrap}>
                    <div className={styles.tableHeader}>
                      <span>Company</span>
                      <span>Position</span>
                      <span>Weight</span>
                      <span>Coverage</span>
                      <span>Thesis health</span>
                      <span>Last checked</span>
                      <span></span>
                    </div>
                    {rows.map((row:any)=>{
                      const company=companyById.get(row.company_id);
                      const market=marketByTicker.get(company?.ticker);
                      const qty=n(row.quantity);
                      const price=market?.price==null?null:n(market.price);
                      const manualValue=row.market_value==null?null:n(row.market_value);
                      const value=manualValue??(price==null?null:qty*price);
                      const avg=row.average_cost==null?null:n(row.average_cost);
                      const state=researchState(researchByPosition.get(row.id));
                      const cutoff=shortDate(state.dataCutoffAt);
                      const weight=weights.get(row.id)??{share:null,basis:"—"};
                      const isFollow=row.relationship==="follow";
                      return(
                        <div className={styles.positionRow} key={row.id}>
                          <div>
                            <Link href={"/research/"+company?.ticker} className={styles.companyCell}>
                              <span className={styles.monogram}>{String(company?.ticker??"?").slice(0,2)}</span>
                              <span>
                                <strong>{company?.ticker??"Unknown"}</strong>
                                <small>{company?.company_name??"Company"}</small>
                              </span>
                            </Link>
                            <span className={`${styles.relBadge} ${isFollow?styles.followTone:""}`}>
                              {isFollow?"Follow":"Own"}
                            </span>
                          </div>
                          <div className={styles.positionCell}>
                            <span>{quantity(qty)} sh</span>
                            <strong>{value==null?"—":money(value)}</strong>
                            {avg!=null?<small>avg {money(avg)}</small>:null}
                          </div>
                          <div className={styles.weightCell} title={"basis: "+weight.basis}>
                            <strong>{weight.share==null?"—":pct(weight.share)}</strong>
                            <small>{weight.basis}</small>
                          </div>
                          <div className={styles.coverageCell}>
                            <strong>{state.coverageLabel}</strong>
                            {state.version?<small>{state.version}</small>:null}
                            {state.coverageNote?<small>{state.coverageNote}</small>:null}
                          </div>
                          <div className={styles.researchState}>
                            <span className={`${styles.researchBadge} ${styles[state.tone]??""}`} title={state.coverageNote??undefined}>
                              {state.label}
                            </span>
                            <Link href={"/portfolio/"+row.id+"/thesis"}>Personalize thesis →</Link>
                            <Link href={"/portfolio/"+row.id+"/attention"}>Attention settings →</Link>
                          </div>
                          <div className={styles.checkedCell}>
                            <span>{relAgo(state.lastCheckedAt)}</span>
                            {cutoff?<small>Data through {cutoff}</small>:null}
                            <details>
                              <summary>Freshness</summary>
                              <div style={{display:"grid",gap:2}}>
                                {state.freshnessRows.map((frow:any)=>(
                                  <small key={frow.label}>{frow.label}: {frow.value}</small>
                                ))}
                              </div>
                            </details>
                          </div>
                          <form action={deletePositionAction}>
                            <input type="hidden" name="position_id" value={row.id} />
                            <button className={styles.remove} type="submit">Remove</button>
                          </form>
                        </div>
                      );
                    })}
                  </div>
                ):(
                  <div className={styles.empty}>
                    <strong>No positions yet.</strong>
                    <span>Add a company above, or use the guided setup to connect your first holding to its thesis.</span>
                    <Link href="/onboarding">Start guided setup →</Link>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}
