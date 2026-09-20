export const SEC_PROVIDER="sec_companyfacts";
export const SEC_BACKFILL_QUARTERS=44;

export const SEC_CONCEPTS={
  revenue:["RevenueFromContractWithCustomerExcludingAssessedTax","Revenues","SalesRevenueNet","SalesRevenueGoodsNet"],
  netIncome:["NetIncomeLoss","ProfitLoss"],
  operatingCashFlow:["NetCashProvidedByUsedInOperatingActivities","NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex:["PaymentsToAcquirePropertyPlantAndEquipment","PaymentsForAdditionsToPropertyPlantAndEquipment","PaymentsToAcquireProductiveAssets"],
  dilutedShares:["WeightedAverageNumberOfDilutedSharesOutstanding"],
  dilutedEps:["EarningsPerShareDiluted"],
  grossProfit:["GrossProfit"],
  operatingIncome:["OperatingIncomeLoss"],
  interestExpense:["InterestExpenseNonOperating","InterestExpense"],
  researchAndDevelopment:["ResearchAndDevelopmentExpense"],
  stockBasedCompensation:["ShareBasedCompensation"],
  dividendsPaid:["PaymentsOfDividends","PaymentsOfDividendsCommonStock","PaymentsOfOrdinaryDividends"],
  shareRepurchases:["PaymentsForRepurchaseOfCommonStock","PaymentsForRepurchaseOfEquity"],
  acquisitions:["PaymentsToAcquireBusinessesNetOfCashAcquired","PaymentsToAcquireBusinessesGross"],
  debtIssued:["ProceedsFromIssuanceOfLongTermDebt","ProceedsFromIssuanceOfDebt"],
  debtRepaid:["RepaymentsOfLongTermDebt","RepaymentsOfDebt"],
  cash:["CashAndCashEquivalentsAtCarryingValue"],
  currentAssets:["AssetsCurrent"],
  currentLiabilities:["LiabilitiesCurrent"],
  inventory:["InventoryNet"],
  equity:["StockholdersEquity","StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  retainedEarnings:["RetainedEarningsAccumulatedDeficit"],
  totalAssets:["Assets"],
  totalLiabilities:["Liabilities"],
  totalDebt:["LongTermDebtAndFinanceLeaseObligations","LongTermDebtAndCapitalLeaseObligations","LongTermDebt"],
  currentDebt:["LongTermDebtCurrent","LongTermDebtAndFinanceLeaseObligationsCurrent","LongTermDebtAndCapitalLeaseObligationsCurrent","DebtCurrent"],
  noncurrentDebt:["LongTermDebtNoncurrent","LongTermDebtAndFinanceLeaseObligationsNoncurrent","LongTermDebtAndCapitalLeaseObligationsNoncurrent"],
  shortTermBorrowings:["ShortTermBorrowings","ShortTermDebt"],
};

function n(value){const x=Number(value);return Number.isFinite(x)?x:null;}
function iso(value){return value?String(value).slice(0,10):null;}
function durationDays(row){
  if(!row?.start||!row?.end)return null;
  const a=new Date(row.start+"T00:00:00Z"),b=new Date(row.end+"T00:00:00Z");
  const days=Math.round((b-a)/86400000)+1;
  return Number.isFinite(days)?days:null;
}
function unitRows(companyFacts,tag,preferredUnits=[]){
  const node=companyFacts?.facts?.["us-gaap"]?.[tag]?.units;
  if(!node)return[];
  for(const unit of preferredUnits){if(Array.isArray(node[unit]))return node[unit].map(x=>({...x,_tag:tag,_unit:unit}));}
  const first=Object.entries(node).find(([,rows])=>Array.isArray(rows));
  return first?first[1].map(x=>({...x,_tag:tag,_unit:first[0]})):[];
}
function factsFor(companyFacts,aliases,units){
  return aliases.flatMap(tag=>unitRows(companyFacts,tag,units));
}
function formBase(form){return String(form??"").toUpperCase().replace(/\/A$/,"");}
function filedTime(row){return Date.parse((row?.filed??"1900-01-01")+"T00:00:00Z")||0;}
function chooseLatest(rows){return [...rows].sort((a,b)=>filedTime(b)-filedTime(a))[0]??null;}
function fpIndex(fp){return {Q1:1,Q2:2,Q3:3,Q4:4,FY:4}[String(fp??"").toUpperCase()]??null;}

function matchingDurationRows(companyFacts,aliases,units,fy,fp,end){
  return factsFor(companyFacts,aliases,units).filter(row=>
    Number(row.fy)===Number(fy)&&
    String(row.fp??"").toUpperCase()===fp&&
    iso(row.end)===iso(end)&&
    ["10-Q","10-K"].includes(formBase(row.form))&&
    row.start
  );
}
function bestDirect(rows){
  const direct=rows.filter(row=>{const d=durationDays(row);return d!=null&&d>=45&&d<=130;});
  if(!direct.length)return null;
  return [...direct].sort((a,b)=>{
    const dd=(durationDays(a)??999)-(durationDays(b)??999);
    return dd||filedTime(b)-filedTime(a);
  })[0];
}
function bestCumulative(rows,quarter){
  const max=quarter===1?130:quarter===2?220:quarter===3?315:410;
  const min=quarter===1?45:quarter===2?130:quarter===3?220:300;
  const candidates=rows.filter(row=>{const d=durationDays(row);return d!=null&&d>=min&&d<=max;});
  if(!candidates.length)return null;
  return [...candidates].sort((a,b)=>(durationDays(b)??0)-(durationDays(a)??0)||filedTime(b)-filedTime(a))[0];
}
function periodEndFor(companyFacts,alias,units,fy,fp){
  const rows=unitRows(companyFacts,alias,units).filter(row=>
    Number(row.fy)===Number(fy)&&String(row.fp??"").toUpperCase()===fp&&["10-Q","10-K"].includes(formBase(row.form))
  );
  return chooseLatest(rows)?.end??null;
}

function quarterForAlias(companyFacts,alias,units,fy,fp,end,seen=new Set()){
  const key=[alias,fy,fp,end].join("|");if(seen.has(key))return null;seen.add(key);
  const q=fpIndex(fp);if(!q)return null;
  const rows=matchingDurationRows(companyFacts,[alias],units,fy,fp,end);
  const direct=bestDirect(rows);
  if(direct)return{value:n(direct.val),fact:direct,basis:"reported"};

  if(q<=3){
    const cumulative=bestCumulative(rows,q);
    if(!cumulative)return null;
    if(q===1)return{value:n(cumulative.val),fact:cumulative,basis:"reported"};
    const prevFp="Q"+(q-1);
    const prevEnd=periodEndFor(companyFacts,alias,units,fy,prevFp);
    if(!prevEnd)return null;
    const prevRows=matchingDurationRows(companyFacts,[alias],units,fy,prevFp,prevEnd);
    const prevCum=bestCumulative(prevRows,q-1)??bestDirect(prevRows);
    const current=n(cumulative.val),previous=n(prevCum?.val);
    if(current==null||previous==null)return null;
    return{value:current-previous,fact:cumulative,basis:"derived_ytd"};
  }

  const annualRows=factsFor(companyFacts,[alias],units).filter(row=>
    Number(row.fy)===Number(fy)&&String(row.fp??"").toUpperCase()==="FY"&&
    iso(row.end)===iso(end)&&formBase(row.form)==="10-K"&&row.start
  );
  const annual=bestCumulative(annualRows,4)??chooseLatest(annualRows);
  if(!annual)return null;
  let firstNine=0;
  for(const priorFp of["Q1","Q2","Q3"]){
    const priorEnd=periodEndFor(companyFacts,alias,units,fy,priorFp);
    if(!priorEnd)return null;
    const quarter=quarterForAlias(companyFacts,alias,units,fy,priorFp,priorEnd,new Set(seen));
    if(quarter?.value==null)return null;
    firstNine+=quarter.value;
  }
  const value=n(annual.val);if(value==null)return null;
  return{value:value-firstNine,fact:annual,basis:"derived_q4"};
}

export function quarterMetric(companyFacts,aliases,units,period,{additive=true}={}){
  for(const alias of aliases){
    if(!additive&&period.fp==="Q4"){
      const annualRows=factsFor(companyFacts,[alias],units).filter(row=>
        Number(row.fy)===Number(period.fy)&&String(row.fp??"").toUpperCase()==="FY"&&
        iso(row.end)===iso(period.end)&&formBase(row.form)==="10-K"&&row.start
      );
      const direct=bestDirect(annualRows);
      if(direct&&n(direct.val)!=null)return{value:n(direct.val),fact:direct,basis:"reported_q4",tag:alias};
      continue;
    }
    const result=quarterForAlias(companyFacts,alias,units,period.fy,period.fp,period.end);
    if(result?.value!=null)return{...result,tag:alias};
  }
  return null;
}

export function instantMetric(companyFacts,aliases,units,end){
  for(const alias of aliases){
    const rows=unitRows(companyFacts,alias,units).filter(row=>
      iso(row.end)===iso(end)&&["10-Q","10-K"].includes(formBase(row.form))
    );
    const fact=chooseLatest(rows);
    if(fact&&n(fact.val)!=null)return{value:n(fact.val),fact,tag:alias,basis:"reported"};
  }
  return null;
}

export function totalDebtAt(companyFacts,end){
  const direct=instantMetric(companyFacts,SEC_CONCEPTS.totalDebt,["USD"],end);
  if(direct)return direct;
  const current=instantMetric(companyFacts,SEC_CONCEPTS.currentDebt,["USD"],end);
  const noncurrent=instantMetric(companyFacts,SEC_CONCEPTS.noncurrentDebt,["USD"],end);
  let shortTerm=null;
  if(current?.tag!=="DebtCurrent")shortTerm=instantMetric(companyFacts,SEC_CONCEPTS.shortTermBorrowings,["USD"],end);
  const parts=[current,noncurrent,shortTerm].filter(x=>x?.value!=null);
  if(!parts.length)return null;
  return{
    value:parts.reduce((sum,x)=>sum+x.value,0),
    fact:parts.sort((a,b)=>filedTime(b.fact)-filedTime(a.fact))[0].fact,
    tag:parts.map(x=>x.tag).join("+"),
    basis:"derived_components"
  };
}

export function extractFiscalPeriods(companyFacts){
  const sourceAliases=[...SEC_CONCEPTS.revenue,...SEC_CONCEPTS.netIncome,...SEC_CONCEPTS.dilutedEps];
  const rows=factsFor(companyFacts,sourceAliases,["USD","USD/shares"]).filter(row=>
    ["10-Q","10-K"].includes(formBase(row.form))&&row.fy&&row.fp&&row.end
  );
  const map=new Map();
  for(const row of rows){
    const fp=String(row.fp).toUpperCase();
    if(!["Q1","Q2","Q3","FY"].includes(fp))continue;
    const key=[row.fy,fp,iso(row.end)].join("|");
    const prior=map.get(key);
    if(!prior||filedTime(row)>filedTime(prior))map.set(key,row);
  }
  const byFy=new Map();
  for(const row of map.values()){
    const fy=Number(row.fy);if(!byFy.has(fy))byFy.set(fy,{});
    byFy.get(fy)[String(row.fp).toUpperCase()]=iso(row.end);
  }
  const periods=[];
  for(const [fy,p] of byFy){
    for(const fp of["Q1","Q2","Q3"]){if(p[fp])periods.push({fy,fp,end:p[fp],form:"10-Q"});}
    if(p.FY)periods.push({fy,fp:"Q4",end:p.FY,form:"10-K"});
  }
  return periods.sort((a,b)=>String(b.end).localeCompare(String(a.end))).slice(0,SEC_BACKFILL_QUARTERS);
}

function latestFiled(results){return results.map(x=>x?.fact?.filed).filter(Boolean).sort().at(-1)??null;}
function signedOutflow(result){return result?.value==null?null:-Math.abs(result.value);}
function rawValue(result){return result?.value??null;}

export function normalizeCompanyFacts(companyFacts,{companyId,ticker,cik,observedAt=new Date().toISOString(),maxQuarters=SEC_BACKFILL_QUARTERS}={}){
  const periods=extractFiscalPeriods(companyFacts).slice(0,maxQuarters);
  const sourceUrl="https://data.sec.gov/api/xbrl/companyfacts/CIK"+String(cik??companyFacts?.cik??"").replace(/\D/g,"").padStart(10,"0")+".json";
  const rows=[];
  for(const period of periods){
    const revenue=quarterMetric(companyFacts,SEC_CONCEPTS.revenue,["USD"],period);
    const netIncome=quarterMetric(companyFacts,SEC_CONCEPTS.netIncome,["USD"],period);
    const ocf=quarterMetric(companyFacts,SEC_CONCEPTS.operatingCashFlow,["USD"],period);
    const capex=quarterMetric(companyFacts,SEC_CONCEPTS.capex,["USD"],period);
    const shares=quarterMetric(companyFacts,SEC_CONCEPTS.dilutedShares,["shares"],period,{additive:false});
    const eps=quarterMetric(companyFacts,SEC_CONCEPTS.dilutedEps,["USD/shares"],period,{additive:false});
    const gross=quarterMetric(companyFacts,SEC_CONCEPTS.grossProfit,["USD"],period);
    const operatingIncome=quarterMetric(companyFacts,SEC_CONCEPTS.operatingIncome,["USD"],period);
    const interest=quarterMetric(companyFacts,SEC_CONCEPTS.interestExpense,["USD"],period);
    const rd=quarterMetric(companyFacts,SEC_CONCEPTS.researchAndDevelopment,["USD"],period);
    const sbc=quarterMetric(companyFacts,SEC_CONCEPTS.stockBasedCompensation,["USD"],period);
    const dividends=quarterMetric(companyFacts,SEC_CONCEPTS.dividendsPaid,["USD"],period);
    const buybacks=quarterMetric(companyFacts,SEC_CONCEPTS.shareRepurchases,["USD"],period);
    const acquisitions=quarterMetric(companyFacts,SEC_CONCEPTS.acquisitions,["USD"],period);
    const debtIssued=quarterMetric(companyFacts,SEC_CONCEPTS.debtIssued,["USD"],period);
    const debtRepaid=quarterMetric(companyFacts,SEC_CONCEPTS.debtRepaid,["USD"],period);
    const cash=instantMetric(companyFacts,SEC_CONCEPTS.cash,["USD"],period.end);
    const currentAssets=instantMetric(companyFacts,SEC_CONCEPTS.currentAssets,["USD"],period.end);
    const currentLiabilities=instantMetric(companyFacts,SEC_CONCEPTS.currentLiabilities,["USD"],period.end);
    const inventory=instantMetric(companyFacts,SEC_CONCEPTS.inventory,["USD"],period.end);
    const equity=instantMetric(companyFacts,SEC_CONCEPTS.equity,["USD"],period.end);
    const retained=instantMetric(companyFacts,SEC_CONCEPTS.retainedEarnings,["USD"],period.end);
    const assets=instantMetric(companyFacts,SEC_CONCEPTS.totalAssets,["USD"],period.end);
    const liabilities=instantMetric(companyFacts,SEC_CONCEPTS.totalLiabilities,["USD"],period.end);
    const debt=totalDebtAt(companyFacts,period.end);
    const capexValue=rawValue(capex);
    const ocfValue=rawValue(ocf);
    const fcf=ocfValue!=null&&capexValue!=null?ocfValue-Math.abs(capexValue):null;
    const evidence=[revenue,netIncome,ocf,capex,shares,eps,gross,operatingIncome,interest,rd,sbc,dividends,buybacks,acquisitions,cash,debt,currentAssets,currentLiabilities,equity];
    const accessions=[...new Set(evidence.map(x=>x?.fact?.accn).filter(Boolean))];
    const tags=Object.fromEntries(evidence.filter(x=>x?.tag).map(x=>[x.tag,x.value]));
    if([revenue,netIncome,ocf,shares,eps,cash,debt].every(x=>x?.value==null))continue;
    rows.push({
      company_id:companyId,
      provider:SEC_PROVIDER,
      observed_at:observedAt,
      period_end:period.end,
      fiscal_year:period.fy,
      fiscal_period:period.fp,
      form:period.form,
      filed_at:latestFiled(evidence),
      revenue:rawValue(revenue),
      net_income:rawValue(netIncome),
      operating_cash_flow:ocfValue,
      capital_expenditure:capexValue==null?null:-Math.abs(capexValue),
      free_cash_flow:fcf,
      shares_outstanding:rawValue(shares),
      eps_diluted:rawValue(eps),
      source_url:sourceUrl,
      raw_payload:{
        provider:SEC_PROVIDER,
        ticker,
        cik:String(cik??companyFacts?.cik??"").replace(/\D/g,"").padStart(10,"0"),
        income:{
          grossProfit:rawValue(gross),
          operatingIncome:rawValue(operatingIncome),
          interestExpense:rawValue(interest),
          researchAndDevelopmentExpenses:rawValue(rd),
        },
        cash_flow:{
          stockBasedCompensation:rawValue(sbc),
          cashAtEndOfPeriod:rawValue(cash),
          commonDividendsPaid:signedOutflow(dividends),
          commonStockRepurchased:signedOutflow(buybacks),
          acquisitionsNet:signedOutflow(acquisitions),
          debtIssued:rawValue(debtIssued),
          debtRepaid:rawValue(debtRepaid),
          netDebtIssuance:(rawValue(debtIssued)??0)-(rawValue(debtRepaid)??0),
        },
        balance_sheet:{
          cashAndCashEquivalents:rawValue(cash),
          currentAssets:rawValue(currentAssets),
          currentLiabilities:rawValue(currentLiabilities),
          inventory:rawValue(inventory),
          stockholdersEquity:rawValue(equity),
          retainedEarnings:rawValue(retained),
          totalAssets:rawValue(assets),
          totalLiabilities:rawValue(liabilities),
          totalDebt:rawValue(debt),
        },
        sec:{
          source_url:sourceUrl,
          accessions,
          selected_tags:tags,
          derivations:{
            revenue:revenue?.basis??null,net_income:netIncome?.basis??null,
            operating_cash_flow:ocf?.basis??null,capital_expenditure:capex?.basis??null,
            shares_outstanding:shares?.basis??null,eps_diluted:eps?.basis??null,
            total_debt:debt?.basis??null,
          }
        }
      }
    });
  }
  return rows;
}
