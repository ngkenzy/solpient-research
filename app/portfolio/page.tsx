import Link from "next/link";
import { redirect } from "next/navigation";
import { SolpientBrand } from "@/components/SolpientBrand";
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
    supabase.from("profiles").select("display_name").eq("user_id",userId).maybeSingle(),
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
        .select("id,portfolio_id,company_id,quantity,average_cost,opened_at,notes,created_at")
        .in("portfolio_id",portfolioIds)
        .order("created_at",{ascending:true})
    : {data:[] as any[]};

  const positions=positionsR.data??[];
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
  for(const row of positions){
    const company=companyById.get(row.company_id);
    const qty=n(row.quantity);
    const price=n(marketByTicker.get(company?.ticker)?.price);
    const avg=row.average_cost==null?null:n(row.average_cost);
    totalMarketValue+=qty*price;
    if(avg!=null) totalCostBasis+=qty*avg;
  }

  const displayName=profileR.data?.display_name?.trim()||"Investor";
  const error=params.error?errors[params.error]:"";

  return(
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          <SolpientBrand subtitle="Portfolio" />
        </Link>
        <nav>
          <Link href="/research">Research</Link>
          <Link href="/portfolio" className={styles.active}>Portfolio</Link>
          <Link href="/alerts">Alerts</Link>
        </nav>
        <form action={signOutAction}>
          <button className={styles.signOut} type="submit">Sign out</button>
        </form>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div>
            <span className={styles.kicker}>YOUR PORTFOLIO</span>
            <h1>{displayName}, know what changed in what you own.</h1>
            <p>
              B1 connects your account to manual holdings. The next Group B layers will attach thesis factors, material changes, and evidence to these positions.
            </p>
          </div>
          <div className={styles.heroStats}>
            <div><span>Portfolios</span><strong>{portfolios.length}</strong></div>
            <div><span>Positions</span><strong>{positions.length}</strong></div>
            <div><span>Market value</span><strong>{money(totalMarketValue)}</strong></div>
            <div><span>Cost basis</span><strong>{totalCostBasis>0?money(totalCostBasis):"—"}</strong></div>
          </div>
        </section>

        {error?<div className={styles.error}>{error}</div>:null}

        <section className={styles.controls}>
          <form action={upsertPositionAction} className={styles.positionForm}>
            <div>
              <span className={styles.sectionLabel}>ADD OR UPDATE POSITION</span>
              <strong>Track a company you own</strong>
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
              portfolioValue+=n(row.quantity)*n(marketByTicker.get(company?.ticker)?.price);
            }

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
                      <span>Shares</span>
                      <span>Avg. cost</span>
                      <span>Price</span>
                      <span>Market value</span>
                      <span></span>
                    </div>
                    {rows.map((row:any)=>{
                      const company=companyById.get(row.company_id);
                      const market=marketByTicker.get(company?.ticker);
                      const qty=n(row.quantity);
                      const price=market?.price==null?null:n(market.price);
                      const value=price==null?null:qty*price;
                      return(
                        <div className={styles.positionRow} key={row.id}>
                          <Link href={"/research/"+company?.ticker} className={styles.companyCell}>
                            <span className={styles.monogram}>{String(company?.ticker??"?").slice(0,2)}</span>
                            <span>
                              <strong>{company?.ticker??"Unknown"}</strong>
                              <small>{company?.company_name??"Company"}</small>
                            </span>
                          </Link>
                          <span>{quantity(qty)}</span>
                          <span>{row.average_cost==null?"—":money(n(row.average_cost))}</span>
                          <span>{price==null?"—":money(price)}</span>
                          <strong>{value==null?"—":money(value)}</strong>
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
                    <span>Add the first company above. ADBE is a good test of the full research link.</span>
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
