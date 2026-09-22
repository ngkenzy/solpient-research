import { sanitizeSourceUrl } from "./baseline-factory.mjs";
import { industryModuleForTicker } from "./industry-modules.mjs";
import { peerSetForTicker } from "./peer-sets.mjs";
import { canonicalSha256 } from "./integrity-hash.mjs";

export const CONTEXT_ENGINE_VERSION="context-v2-provenance";
const PROVIDER_PRIORITY={sec_companyfacts:0,fmp:1,yahoo_fundamentals:2,alpha_vantage:3,unknown:9};

function n(v){if(v===null||v===undefined||(typeof v==="string"&&v.trim()===""))return null;const x=Number(v);return Number.isFinite(x)?x:null;}
function abs(v){const x=n(v);return x==null?null:Math.abs(x);}
function ratio(a,b,scale=1){const x=n(a),y=n(b);return x==null||y==null||y===0?null:(x/y)*scale;}
function pctChange(a,b){const x=n(a),y=n(b);return x==null||y==null||y===0?null:(x/y-1)*100;}
function rawIncome(row){return row?.raw_payload?.income??{};}
function rawCash(row){return row?.raw_payload?.cash_flow??{};}
function raw(row,section,key){return n((section==="income"?rawIncome(row):rawCash(row))?.[key]);}
function latestByDate(rows=[]){return [...rows].sort((a,b)=>String(b.period_end??"").localeCompare(String(a.period_end??"")));}
function selectFundamentals(rows=[]){const sorted=[...rows].sort((a,b)=>{const d=String(b.period_end??"").localeCompare(String(a.period_end??""));if(d)return d;const aa=String(a.fiscal_period??"").toUpperCase()==="FY"?1:0,ab=String(b.fiscal_period??"").toUpperCase()==="FY"?1:0;if(aa!==ab)return aa-ab;return(PROVIDER_PRIORITY[a.provider]??8)-(PROVIDER_PRIORITY[b.provider]??8);});const seen=new Set(),out=[];for(const row of sorted){const kind=String(row.fiscal_period??"").toUpperCase()==="FY"?"annual":"quarter",key=kind+"|"+String(row.period_end??"");if(seen.has(key))continue;seen.add(key);out.push(row);}return out;}
function metricRow(companyId,row,metricKey,label,value,unit,basis="reported",periodType=null){
  return {
    company_id:companyId,module:"universal",metric_key:metricKey,label,
    period_end:row.period_end,fiscal_year:row.fiscal_year??null,period_type:periodType??String(row.fiscal_period??"quarter").toLowerCase(),
    value_numeric:value,value_text:null,unit,basis,
    source_type:row.form??"Fundamental provider",source_title:[String(row.provider??"provider").toUpperCase(),row.fiscal_period,row.fiscal_year].filter(Boolean).join(" · "),
    source_url:sanitizeSourceUrl(row.source_url),observed_at:row.observed_at??new Date().toISOString()
  };
}

function quarterlyMetrics(companyId,row){
  const revenue=n(row.revenue),net=n(row.net_income),ocf=n(row.operating_cash_flow),fcf=n(row.free_cash_flow),shares=n(row.shares_outstanding),eps=n(row.eps_diluted);
  const gross=raw(row,"income","grossProfit"),op=raw(row,"income","operatingIncome"),capex=abs(row.capital_expenditure),sbc=raw(row,"cash","stockBasedCompensation");
  return [
    metricRow(companyId,row,"revenue","Revenue",revenue,"USD"),
    metricRow(companyId,row,"eps_diluted","Diluted EPS",eps,"USD/share"),
    metricRow(companyId,row,"net_income","Net income",net,"USD"),
    metricRow(companyId,row,"gross_margin","Gross margin",ratio(gross,revenue,100),"percent","derived"),
    metricRow(companyId,row,"operating_margin","Operating margin",ratio(op,revenue,100),"percent","derived"),
    metricRow(companyId,row,"net_margin","Net margin",ratio(net,revenue,100),"percent","derived"),
    metricRow(companyId,row,"operating_cash_flow","Operating cash flow",ocf,"USD"),
    metricRow(companyId,row,"free_cash_flow","Free cash flow",fcf,"USD"),
    metricRow(companyId,row,"fcf_margin","FCF margin",ratio(fcf,revenue,100),"percent","derived"),
    metricRow(companyId,row,"fcf_per_share","FCF per share",ratio(fcf,shares),"USD/share","derived"),
    metricRow(companyId,row,"shares_outstanding","Diluted shares",shares,"shares"),
    metricRow(companyId,row,"capital_expenditure","Capital expenditure",capex,"USD","derived"),
    metricRow(companyId,row,"capex_to_revenue","Capex / revenue",ratio(capex,revenue,100),"percent","derived"),
    metricRow(companyId,row,"stock_based_compensation","Stock-based compensation",sbc,"USD"),
    metricRow(companyId,row,"sbc_to_revenue","SBC / revenue",ratio(sbc,revenue,100),"percent","derived"),
    metricRow(companyId,row,"dividends_paid","Dividends paid",abs(raw(row,"cash","commonDividendsPaid")),"USD","derived"),
    metricRow(companyId,row,"buybacks","Share repurchases",abs(raw(row,"cash","commonStockRepurchased")),"USD","derived"),
    metricRow(companyId,row,"acquisitions","Acquisitions",abs(raw(row,"cash","acquisitionsNet")),"USD","derived"),
  ].filter(x=>x.value_numeric!==null);
}

function aggregateYear(companyId,yearRows){
  const rows=latestByDate(yearRows),annual=rows.find(r=>String(r.fiscal_period??"").toUpperCase()==="FY");
  if(annual){const revenue=n(annual.revenue),net=n(annual.net_income),ocf=n(annual.operating_cash_flow),fcf=n(annual.free_cash_flow),shares=n(annual.shares_outstanding),eps=n(annual.eps_diluted),gross=raw(annual,"income","grossProfit"),op=raw(annual,"income","operatingIncome"),capex=abs(annual.capital_expenditure),sbc=raw(annual,"cash","stockBasedCompensation");return [metricRow(companyId,annual,"revenue","Revenue",revenue,"USD","reported","fiscal_year"),metricRow(companyId,annual,"eps_diluted","Diluted EPS",eps,"USD/share","reported","fiscal_year"),metricRow(companyId,annual,"net_income","Net income",net,"USD","reported","fiscal_year"),metricRow(companyId,annual,"gross_margin","Gross margin",ratio(gross,revenue,100),"percent","derived","fiscal_year"),metricRow(companyId,annual,"operating_margin","Operating margin",ratio(op,revenue,100),"percent","derived","fiscal_year"),metricRow(companyId,annual,"net_margin","Net margin",ratio(net,revenue,100),"percent","derived","fiscal_year"),metricRow(companyId,annual,"operating_cash_flow","Operating cash flow",ocf,"USD","reported","fiscal_year"),metricRow(companyId,annual,"free_cash_flow","Free cash flow",fcf,"USD","reported","fiscal_year"),metricRow(companyId,annual,"fcf_margin","FCF margin",ratio(fcf,revenue,100),"percent","derived","fiscal_year"),metricRow(companyId,annual,"fcf_per_share","FCF per share",ratio(fcf,shares),"USD/share","derived","fiscal_year"),metricRow(companyId,annual,"shares_outstanding","Diluted shares",shares,"shares","reported","fiscal_year"),metricRow(companyId,annual,"capital_expenditure","Capital expenditure",capex,"USD","derived","fiscal_year"),metricRow(companyId,annual,"capex_to_revenue","Capex / revenue",ratio(capex,revenue,100),"percent","derived","fiscal_year"),metricRow(companyId,annual,"stock_based_compensation","Stock-based compensation",sbc,"USD","reported","fiscal_year"),metricRow(companyId,annual,"sbc_to_revenue","SBC / revenue",ratio(sbc,revenue,100),"percent","derived","fiscal_year")].filter(x=>x.value_numeric!==null);}
  const quarterRows=rows.filter(r=>String(r.fiscal_period??"").toUpperCase()!=="FY");if(quarterRows.length<4)return [];
  const q=quarterRows.slice(0,4);
  const sum=(getter)=>{
    const values=q.map(getter);
    return values.some((value)=>value==null) ? null : values.reduce((a,value)=>a+value,0);
  };
  const revenue=sum(r=>n(r.revenue)),net=sum(r=>n(r.net_income)),ocf=sum(r=>n(r.operating_cash_flow)),fcf=sum(r=>n(r.free_cash_flow));
  const gross=sum(r=>raw(r,"income","grossProfit")),op=sum(r=>raw(r,"income","operatingIncome")),eps=sum(r=>n(r.eps_diluted));
  const capex=sum(r=>abs(r.capital_expenditure)),sbc=sum(r=>raw(r,"cash","stockBasedCompensation"));
  const dividends=sum(r=>abs(raw(r,"cash","commonDividendsPaid"))),buybacks=sum(r=>abs(raw(r,"cash","commonStockRepurchased"))),acq=sum(r=>abs(raw(r,"cash","acquisitionsNet")));
  const latest=rows[0],shares=n(latest.shares_outstanding);
  const base={...latest,period_end:latest.period_end,fiscal_year:latest.fiscal_year,fiscal_period:"FY"};
  return [
    metricRow(companyId,base,"revenue","Revenue",revenue,"USD","derived","fiscal_year"),
    metricRow(companyId,base,"eps_diluted","Diluted EPS",eps,"USD/share","derived","fiscal_year"),
    metricRow(companyId,base,"net_income","Net income",net,"USD","derived","fiscal_year"),
    metricRow(companyId,base,"gross_margin","Gross margin",ratio(gross,revenue,100),"percent","derived","fiscal_year"),
    metricRow(companyId,base,"operating_margin","Operating margin",ratio(op,revenue,100),"percent","derived","fiscal_year"),
    metricRow(companyId,base,"net_margin","Net margin",ratio(net,revenue,100),"percent","derived","fiscal_year"),
    metricRow(companyId,base,"operating_cash_flow","Operating cash flow",ocf,"USD","derived","fiscal_year"),
    metricRow(companyId,base,"free_cash_flow","Free cash flow",fcf,"USD","derived","fiscal_year"),
    metricRow(companyId,base,"fcf_margin","FCF margin",ratio(fcf,revenue,100),"percent","derived","fiscal_year"),
    metricRow(companyId,base,"fcf_per_share","FCF per share",ratio(fcf,shares),"USD/share","derived","fiscal_year"),
    metricRow(companyId,base,"shares_outstanding","Diluted shares",shares,"shares","reported","fiscal_year"),
    metricRow(companyId,base,"capital_expenditure","Capital expenditure",capex,"USD","derived","fiscal_year"),
    metricRow(companyId,base,"capex_to_revenue","Capex / revenue",ratio(capex,revenue,100),"percent","derived","fiscal_year"),
    metricRow(companyId,base,"stock_based_compensation","Stock-based compensation",sbc,"USD","derived","fiscal_year"),
    metricRow(companyId,base,"sbc_to_revenue","SBC / revenue",ratio(sbc,revenue,100),"percent","derived","fiscal_year"),
    metricRow(companyId,base,"dividends_paid","Dividends paid",dividends,"USD","derived","fiscal_year"),
    metricRow(companyId,base,"buybacks","Share repurchases",buybacks,"USD","derived","fiscal_year"),
    metricRow(companyId,base,"acquisitions","Acquisitions",acq,"USD","derived","fiscal_year"),
  ].filter(x=>x.value_numeric!==null);
}

function addGrowthRows(rows){
  const byMetric=new Map();
  for(const row of rows.filter(r=>r.period_type==="fiscal_year")){
    if(!byMetric.has(row.metric_key))byMetric.set(row.metric_key,[]);
    byMetric.get(row.metric_key).push(row);
  }
  const out=[];
  for(const [metric,items] of byMetric){
    const sorted=[...items].sort((a,b)=>String(a.period_end).localeCompare(String(b.period_end)));
    for(let i=1;i<sorted.length;i++){
      const curr=sorted[i],prev=sorted[i-1],growth=pctChange(curr.value_numeric,prev.value_numeric);
      if(growth==null)continue;
      out.push({...curr,metric_key:metric+"_growth_yoy",label:curr.label+" growth YoY",value_numeric:growth,unit:"percent",basis:"derived"});
    }
  }
  return out;
}

function cagr(first,last,years){
  const a=n(first),b=n(last);if(a==null||b==null||a<=0||b<=0||years<=0)return null;
  return (Math.pow(b/a,1/years)-1)*100;
}

function historySummary(historyRows){
  const annual=historyRows.filter(r=>r.period_type==="fiscal_year");
  const years=[...new Set(annual.map(r=>r.fiscal_year).filter(Boolean))].sort((a,b)=>a-b);
  const metric=(key)=>annual.filter(r=>r.metric_key===key).sort((a,b)=>String(a.period_end).localeCompare(String(b.period_end)));
  const trend=(key)=>{const items=metric(key);if(items.length<2)return null;const first=items[0],last=items.at(-1),yrs=Math.max(1,Number(last.fiscal_year)-Number(first.fiscal_year));return cagr(first.value_numeric,last.value_numeric,yrs);};
  const latest={};
  for(const row of [...annual].sort((a,b)=>String(a.period_end).localeCompare(String(b.period_end)))){
    latest[row.metric_key]=row.value_numeric??row.value_text;
  }
  return {
    coverage:{annual_years:years,full_year_count:years.length,first_year:years[0]??null,latest_year:years.at(-1)??null},
    trends:{revenue_cagr:trend("revenue"),eps_cagr:trend("eps_diluted"),fcf_cagr:trend("free_cash_flow"),fcf_per_share_cagr:trend("fcf_per_share"),share_count_cagr:trend("shares_outstanding")},
    latest_metrics:latest
  };
}

function capitalRows(companyId,fundamentals){
  return fundamentals.map(row=>{
    const netDebt=raw(row,"cash","netDebtIssuance");
    return {
      company_id:companyId,period_end:row.period_end,fiscal_year:row.fiscal_year??null,
      dividends_paid:abs(raw(row,"cash","commonDividendsPaid")),buybacks:abs(raw(row,"cash","commonStockRepurchased")),
      stock_based_compensation:raw(row,"cash","stockBasedCompensation"),acquisitions:abs(raw(row,"cash","acquisitionsNet")),
      debt_issued:netDebt!=null&&netDebt>0?netDebt:null,debt_repaid:netDebt!=null&&netDebt<0?Math.abs(netDebt):null,
      ending_share_count:n(row.shares_outstanding),retained_earnings:null,
      source_title:[String(row.provider??"provider").toUpperCase(),row.fiscal_period,row.fiscal_year].filter(Boolean).join(" · "),
      source_url:sanitizeSourceUrl(row.source_url),observed_at:row.observed_at??new Date().toISOString()
    };
  });
}

function evidenceAvailableDate(row){
  const filed=row?.filed_at?new Date(String(row.filed_at)+"T00:00:00Z"):null;
  if(filed&&Number.isFinite(filed.getTime()))return filed;
  const period=new Date(String(row?.period_end)+"T00:00:00Z");
  if(!Number.isFinite(period.getTime()))return null;
  const isAnnual=String(row?.fiscal_period??"").toUpperCase()==="FY"||String(row?.form??"").toUpperCase()==="10-K";
  period.setUTCDate(period.getUTCDate()+(isAnnual?90:50));
  return period;
}

function ttmAt(fundamentals,dateValue){
  const asOf=new Date(String(dateValue)+"T23:59:59Z");
  if(!Number.isFinite(asOf.getTime()))return null;
  const eligible=fundamentals.filter((r)=>{
    const available=evidenceAvailableDate(r);
    return available&&available<=asOf;
  });
  const quarters=latestByDate(eligible.filter(r=>String(r.fiscal_period??"").toUpperCase()!=="FY"&&String(r.form??"").toUpperCase()!=="10-K")).slice(0,4);
  if(quarters.length>=4){
    const sum=k=>{
      const values=quarters.map((r)=>n(r[k]));
      return values.some((value)=>value==null) ? null : values.reduce((a,value)=>a+value,0);
    };
    const quarterly={fcf:sum("free_cash_flow"),netIncome:sum("net_income"),revenue:sum("revenue"),basis:"ttm_quarters"};
    if(Object.values(quarterly).slice(0,3).some((value)=>value!=null))return quarterly;
  }
  const annual=latestByDate(eligible.filter(r=>String(r.fiscal_period??"").toUpperCase()==="FY"||String(r.form??"").toUpperCase()==="10-K"))[0];
  if(!annual)return null;
  return{fcf:n(annual.free_cash_flow),netIncome:n(annual.net_income),revenue:n(annual.revenue),basis:"latest_available_fiscal_year"};
}

function valuationRows(company,module,fundamentals,markets){
  return markets.map(m=>{
    const t=ttmAt(fundamentals,m.trading_date),mc=n(m.market_cap);
    if(!t||mc==null)return null;
    const bank=module==="financial_bank";
    return {
      company_id:company.id,trading_date:m.trading_date,
      pe:ratio(mc,t.netIncome),forward_pe:null,ev_to_ebitda:null,
      price_to_fcf:bank?null:ratio(mc,t.fcf),fcf_yield:bank?null:ratio(t.fcf,mc,100),
      market_cap:mc,enterprise_value:null,provider:m.provider??null,source_url:sanitizeSourceUrl(m.source_url),observed_at:m.observed_at??new Date().toISOString()
    };
  }).filter(Boolean);
}

function ttmCapital(capital){
  const q=latestByDate(capital).slice(0,4),sum=k=>{
    const values=q.map((r)=>n(r[k]));
    return values.some((value)=>value==null) ? null : values.reduce((a,value)=>a+value,0);
  };
  if(!q.length)return {};
  const latest=q[0],prior=[...capital].sort((a,b)=>String(b.period_end).localeCompare(String(a.period_end)))[4];
  return {
    dividends_ttm:sum("dividends_paid"),buybacks_ttm:sum("buybacks"),stock_based_compensation_ttm:sum("stock_based_compensation"),
    acquisitions_ttm:sum("acquisitions"),share_count_change_yoy:pctChange(latest.ending_share_count,prior?.ending_share_count)
  };
}

export function buildCompanyHistory({company,fundamentals=[],markets=[],industryModuleOverride=null}){
  const module=industryModuleOverride??industryModuleForTicker(company.ticker),ordered=selectFundamentals(fundamentals);
  const quarterRows=ordered.filter(row=>String(row.fiscal_period??"").toUpperCase()!=="FY");
  const quarterly=quarterRows.flatMap(row=>quarterlyMetrics(company.id,row));
  const byYear=new Map();
  for(const row of ordered){const y=row.fiscal_year;if(!y)continue;if(!byYear.has(y))byYear.set(y,[]);byYear.get(y).push(row);}
  const annual=[...byYear.values()].flatMap(rows=>aggregateYear(company.id,rows));
  const history=[...quarterly,...annual];history.push(...addGrowthRows(history));
  const capital=capitalRows(company.id,quarterRows);
  const valuations=valuationRows(company,module,ordered,markets);
  const summary=historySummary(history);
  const limitations=[];
  if(summary.coverage.full_year_count<5)limitations.push("Stored normalized fundamentals currently cover fewer than five complete fiscal years.");
  if(valuations.length<252)limitations.push("Stored market history is not yet deep enough for a full multi-year valuation distribution.");
  if(module==="financial_bank")limitations.push("Free-cash-flow valuation ratios are not used for the bank module.");
  return {module,history,capital,valuations,...summary,capital_allocation:ttmCapital(capital),limitations};
}

export function buildPeerContext({company,trackedCompanies,latestByTicker,asOfDate,knowledgeCutoffAt=new Date().toISOString()}){
  const configured=peerSetForTicker(company.ticker);
  const peerSet=configured.map(p=>({...p,tracked:trackedCompanies.has(p.ticker)}));
  const peerComparison=[];
  const snapshotRows=[];
  for(const peer of peerSet){
    const metrics=latestByTicker.get(peer.ticker);
    if(!metrics){peerComparison.push({...peer,data_status:"not_ingested",metrics:{}});continue;}
    const selected={};
    for(const key of ["revenue_growth_yoy","gross_margin","operating_margin","net_margin","fcf_margin","fcf_per_share_growth_yoy","share_count_growth_yoy","pe","price_to_fcf","fcf_yield"]){
      if(metrics[key]==null)continue;selected[key]=metrics[key];
      snapshotRows.push({company_id:company.id,peer_ticker:peer.ticker,metric_key:key,as_of_date:asOfDate,value_numeric:metrics[key],value_text:null,unit:key.includes("margin")||key.includes("growth")||key==="fcf_yield"?"percent":key==="pe"||key==="price_to_fcf"?"x":null,provider:CONTEXT_ENGINE_VERSION,source_url:null,observed_at:knowledgeCutoffAt});
    }
    peerComparison.push({...peer,data_status:"available",metrics:selected});
  }
  return {peerSet,peerComparison,snapshotRows};
}

export function latestMetricMap(result){
  const out={};
  const annual=result.history.filter(r=>r.period_type==="fiscal_year").sort((a,b)=>String(a.period_end).localeCompare(String(b.period_end)));
  for(const r of annual)out[r.metric_key]=r.value_numeric;
  const val=[...result.valuations].sort((a,b)=>String(a.trading_date).localeCompare(String(b.trading_date))).at(-1);
  if(val)for(const key of ["pe","price_to_fcf","fcf_yield"])if(val[key]!=null)out[key]=n(val[key]);
  return out;
}

export function buildContextPack({company,result,peerContext,asOfDate,knowledgeCutoffAt=new Date().toISOString()}){
  const generatedAt=new Date().toISOString();
  const content={
    company_id:company.id,context_version:CONTEXT_ENGINE_VERSION,as_of_date:asOfDate,knowledge_cutoff_at:knowledgeCutoffAt,industry_module:result.module,
    history_coverage:result.coverage,trends:result.trends,latest_metrics:result.latest_metrics,
    peer_set:peerContext.peerSet,peer_comparison:peerContext.peerComparison,
    capital_allocation:result.capital_allocation,limitations:result.limitations,
    summary:{
      historical_metric_rows:result.history.length,
      valuation_history_rows:result.valuations.length,
      capital_allocation_rows:result.capital.length,
      configured_peers:peerContext.peerSet.length,
      peers_with_local_data:peerContext.peerComparison.filter(p=>p.data_status==="available").length,
      full_fiscal_years:result.coverage.full_year_count
    }
  };
  return {
    ...content,
    generated_at:generatedAt,
    input_hash:canonicalSha256(content),
    provenance_status:"complete",
  };
}
