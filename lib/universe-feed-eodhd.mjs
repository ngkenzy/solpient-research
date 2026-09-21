const asNumber=(value)=>{
  if(value===null||value===undefined||value==="")return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
};

const pct=(value)=>{
  const n=asNumber(value);
  if(n===null)return null;
  return Math.abs(n)<=1.5?n*100:n;
};

const valueAt=(obj,paths)=>{
  for(const path of paths){
    let cur=obj;
    let ok=true;
    for(const key of path.split(".")){
      if(cur===null||cur===undefined||!(key in Object(cur))){ok=false;break;}
      cur=cur[key];
    }
    if(ok&&cur!==null&&cur!==undefined&&cur!=="")return cur;
  }
  return null;
};

const rowsFromStatement=(fundamental,statement,period="yearly")=>{
  const raw=valueAt(fundamental,[
    `Financials.${statement}.${period}`,
    `Financials.${statement}.${period==="yearly"?"annual":"quarterly"}`,
  ]);
  if(!raw)return[];
  const rows=Array.isArray(raw)?raw:Object.values(raw);
  return rows.filter(Boolean).sort((a,b)=>String(b.date??b.filing_date??"").localeCompare(String(a.date??a.filing_date??"")));
};

const field=(row,names)=>valueAt(row,names);

const capexValue=(row)=>{
  const raw=asNumber(field(row,["capitalExpenditures","capital_expenditures","CapitalExpenditures"]));
  if(raw===null)return null;
  return Math.abs(raw);
};

const ocfValue=(row)=>asNumber(field(row,[
  "totalCashFromOperatingActivities","operatingCashFlow","cashFromOperatingActivities","TotalCashFromOperatingActivities",
]));

const fcfValue=(row)=>{
  const ocf=ocfValue(row),capex=capexValue(row);
  return ocf===null||capex===null?null:ocf-capex;
};

const revenueValue=(row)=>asNumber(field(row,["totalRevenue","revenue","TotalRevenue"]));
const netIncomeValue=(row)=>asNumber(field(row,["netIncome","net_income","NetIncome"]));
const operatingIncomeValue=(row)=>asNumber(field(row,["operatingIncome","operating_income","OperatingIncome"]));
const ebitValue=(row)=>asNumber(field(row,["ebit","EBIT","operatingIncome","operating_income"]));
const interestExpenseValue=(row)=>asNumber(field(row,["interestExpense","interest_expense","InterestExpense"]));
const epsValue=(row)=>asNumber(field(row,["dilutedEPS","dilutedEps","epsDiluted","eps","DilutedEPS"]));
const sharesValue=(row)=>asNumber(field(row,["commonStockSharesOutstanding","common_stock_shares_outstanding","sharesOutstanding","SharesOutstanding"]));

const sumLast=(rows,getter,count=4)=>{
  const vals=rows.slice(0,count).map(getter);
  if(vals.length<count||vals.some(v=>v===null))return null;
  return vals.reduce((a,b)=>a+b,0);
};

const cagr=(newer,older,years)=>{
  const a=asNumber(newer),b=asNumber(older);
  if(a===null||b===null||a<=0||b<=0||years<=0)return null;
  return (Math.pow(a/b,1/years)-1)*100;
};

const stddev=(values)=>{
  const xs=values.filter(v=>v!==null&&Number.isFinite(v));
  if(xs.length<2)return null;
  const mean=xs.reduce((a,b)=>a+b,0)/xs.length;
  return Math.sqrt(xs.reduce((s,x)=>s+(x-mean)**2,0)/xs.length);
};

const latestBalance=(fundamental)=>rowsFromStatement(fundamental,"Balance_Sheet","yearly")[0]??null;

const totalDebt=(row)=>{
  if(!row)return null;
  const direct=asNumber(field(row,["shortLongTermDebtTotal","totalDebt","TotalDebt"]));
  if(direct!==null)return direct;
  const long=asNumber(field(row,["longTermDebt","long_term_debt","LongTermDebt"]))??0;
  const short=asNumber(field(row,["shortTermDebt","short_term_debt","ShortTermDebt"]))??0;
  return long+short||null;
};

const cashValue=(row)=>asNumber(field(row,["cash","cashAndEquivalents","cashAndShortTermInvestments","Cash"]));
const equityValue=(row)=>asNumber(field(row,["totalStockholderEquity","totalStockholdersEquity","stockholdersEquity","TotalStockholderEquity"]));
const currentAssetsValue=(row)=>asNumber(field(row,["totalCurrentAssets","currentAssets","TotalCurrentAssets"]));
const currentLiabilitiesValue=(row)=>asNumber(field(row,["totalCurrentLiabilities","currentLiabilities","TotalCurrentLiabilities"]));

function positiveYears(values){
  return values.slice(0,5).filter(v=>v!==null&&v>0).length;
}

function positiveGrowthYears(values){
  const xs=values.slice(0,6);
  let count=0;
  for(let i=0;i<Math.min(5,xs.length-1);i++){
    if(xs[i]!==null&&xs[i+1]!==null&&xs[i]>xs[i+1])count++;
  }
  return count;
}

export function normalizeEodhdSecurity({quote,fundamental={},liquidity30d=null}={}){
  const ticker=String(quote?.code??valueAt(fundamental,["General.Code"])??"").trim().toUpperCase();
  if(!ticker)return null;

  const annualIncome=rowsFromStatement(fundamental,"Income_Statement","yearly");
  const annualCash=rowsFromStatement(fundamental,"Cash_Flow","yearly");
  const quarterlyIncome=rowsFromStatement(fundamental,"Income_Statement","quarterly");
  const quarterlyCash=rowsFromStatement(fundamental,"Cash_Flow","quarterly");
  const annualBalance=rowsFromStatement(fundamental,"Balance_Sheet","yearly");
  const balance=annualBalance[0]??null;

  const annualRevenue=annualIncome.map(revenueValue);
  const annualNetIncome=annualIncome.map(netIncomeValue);
  const annualEps=annualIncome.map(epsValue);
  const annualFcf=annualCash.map(fcfValue);
  const annualMargins=annualIncome.map(row=>{
    const revenue=revenueValue(row),op=operatingIncomeValue(row);
    return revenue&&op!==null?op/revenue*100:null;
  });

  const revenueTtm=asNumber(valueAt(fundamental,["Highlights.RevenueTTM"]))
    ??sumLast(quarterlyIncome,revenueValue,4)
    ??annualRevenue[0]
    ??null;
  const netIncomeTtm=sumLast(quarterlyIncome,netIncomeValue,4)??annualNetIncome[0]??null;
  const ocfTtm=sumLast(quarterlyCash,ocfValue,4)??ocfValue(annualCash[0]??{})??null;
  const fcfTtm=sumLast(quarterlyCash,fcfValue,4)??annualFcf[0]??null;
  const ebitTtm=sumLast(quarterlyIncome,ebitValue,4)??ebitValue(annualIncome[0]??{})??null;
  const interestTtm=sumLast(quarterlyIncome,interestExpenseValue,4)??interestExpenseValue(annualIncome[0]??{})??null;

  const marketCap=asNumber(quote?.MarketCapitalization)
    ??asNumber(valueAt(fundamental,["Highlights.MarketCapitalization"]));
  const price=asNumber(quote?.adjusted_close??quote?.close);
  const ebitda=asNumber(valueAt(fundamental,["Highlights.EBITDA"]));
  const debt=totalDebt(balance);
  const cash=cashValue(balance);
  const equity=equityValue(balance);
  const currentAssets=currentAssetsValue(balance);
  const currentLiabilities=currentLiabilitiesValue(balance);

  const sharesNow=asNumber(valueAt(fundamental,["SharesStats.SharesOutstanding"]))
    ??sharesValue(balance);
  const shares3y=sharesValue(annualBalance[3]??null);

  const fcfMargin=revenueTtm&&fcfTtm!==null?fcfTtm/revenueTtm*100:null;
  const cashConversion=netIncomeTtm&&ocfTtm!==null?ocfTtm/netIncomeTtm*100:null;
  const priceToFcf=marketCap&&fcfTtm&&fcfTtm>0?marketCap/fcfTtm:null;

  const latestRevenue=annualRevenue[0]??revenueTtm;
  const revenue3y=annualRevenue[3]??null;
  const latestEps=annualEps[0]??asNumber(valueAt(fundamental,["Highlights.DilutedEpsTTM"]));
  const eps3y=annualEps[3]??null;
  const latestFcf=annualFcf[0]??fcfTtm;
  const fcf3y=annualFcf[3]??null;

  const row={
    ticker,
    company_name:quote?.name??valueAt(fundamental,["General.Name"])??ticker,
    sector:valueAt(fundamental,["General.Sector"])??null,
    industry:valueAt(fundamental,["General.Industry"])??null,
    market_cap:marketCap,
    avg_dollar_volume_30d:liquidity30d?.observationCount>=20?liquidity30d.averageDollarVolume:null,
    price,
    revenue_ttm:revenueTtm,
    roic:pct(valueAt(fundamental,["Highlights.ReturnOnInvestmentTTM","Highlights.ReturnOnInvestedCapitalTTM"])),
    roe:pct(valueAt(fundamental,["Highlights.ReturnOnEquityTTM"])),
    fcf_margin:fcfMargin,
    cash_conversion_pct:cashConversion,
    operating_margin:pct(valueAt(fundamental,["Highlights.OperatingMarginTTM"]))
      ??(revenueTtm&&ebitTtm!==null?ebitTtm/revenueTtm*100:null),
    positive_fcf_years:positiveYears(annualFcf),
    positive_eps_years:positiveYears(annualEps),
    positive_revenue_growth_years:positiveGrowthYears(annualRevenue),
    operating_margin_volatility_pct:stddev(annualMargins.slice(0,5)),
    share_dilution_3y_pct:sharesNow&&shares3y&&shares3y>0?(sharesNow/shares3y-1)*100:null,
    net_debt_to_ebitda:ebitda&&ebitda>0&&debt!==null?(debt-(cash??0))/ebitda:null,
    debt_to_equity:equity&&equity!==0&&debt!==null?debt/equity:null,
    interest_coverage:interestTtm&&interestTtm!==0&&ebitTtm!==null?ebitTtm/Math.abs(interestTtm):null,
    current_ratio:currentLiabilities&&currentLiabilities!==0&&currentAssets!==null?currentAssets/currentLiabilities:null,
    revenue_growth_3y_cagr:cagr(latestRevenue,revenue3y,3),
    eps_growth_3y_cagr:cagr(latestEps,eps3y,3),
    fcf_growth_3y_cagr:cagr(latestFcf,fcf3y,3),
    price_to_fcf:priceToFcf,
    fcf_yield_pct:marketCap&&fcfTtm!==null?fcfTtm/marketCap*100:null,
    forward_pe:asNumber(valueAt(fundamental,["Valuation.ForwardPE","Highlights.ForwardPE"])),
    ev_to_ebitda:asNumber(valueAt(fundamental,["Valuation.EnterpriseValueEbitda","Valuation.EnterpriseValueEBITDA"])),
    peg_ratio:asNumber(valueAt(fundamental,["Highlights.PEGRatio","Valuation.PEGRatio"])),
    bankruptcy_flag:null,
    going_concern_flag:null,
    _feed_metadata:{
      provider:"eodhd",
      quote_date:quote?.date??null,
      liquidity_sessions:liquidity30d?.observationCount??0,
      liquidity_window:"30-trading-session exact average when >=20 observations",
      source_currency:valueAt(fundamental,["General.CurrencyCode"])??"USD",
    },
  };
  return row;
}

export function normalizeEodhdUniverse({quotes=[],fundamentalsByTicker=new Map(),liquidityByTicker=new Map()}={}){
  return quotes
    .filter(row=>{
      const type=String(row?.type??"").toLowerCase();
      return !type||type.includes("common")||type.includes("stock")||type.includes("adr");
    })
    .map(quote=>normalizeEodhdSecurity({
      quote,
      fundamental:fundamentalsByTicker.get(String(quote.code??"").toUpperCase())??{},
      liquidity30d:liquidityByTicker.get(String(quote.code??"").toUpperCase())??null,
    }))
    .filter(Boolean)
    .sort((a,b)=>a.ticker.localeCompare(b.ticker));
}
