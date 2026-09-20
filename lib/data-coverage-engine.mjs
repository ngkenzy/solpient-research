import { industryModuleForTicker, INDUSTRY_MODULES } from "./industry-modules.mjs";

export const COVERAGE_ENGINE_VERSION="coverage-v1";
const PROVIDER_PRIORITY={sec_companyfacts:0,fmp:1,alpha_vantage:2,unknown:9};

function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function clamp(v){return Math.max(0,Math.min(100,Math.round(v*10)/10));}
function rawBalance(row){return row?.raw_payload?.balance_sheet??{};}
function providerScore(name){return PROVIDER_PRIORITY[name]??8;}
function uniqueQuarterRows(rows=[]){
  const sorted=[...rows].sort((a,b)=>{
    const byDate=String(b.period_end??"").localeCompare(String(a.period_end??""));
    if(byDate!==0)return byDate;
    return providerScore(a.provider)-providerScore(b.provider);
  });
  const seen=new Set(),out=[];
  for(const row of sorted){
    const key=String(row.period_end??"");
    if(seen.has(key))continue;
    seen.add(key);out.push(row);
  }
  return out;
}
function fieldCoverage(rows,fields){
  if(!rows.length||!fields.length)return 0;
  let total=0,covered=0;
  for(const row of rows)for(const field of fields){
    total++;
    const value=typeof field==="function"?field(row):row[field];
    if(value!==null&&value!==undefined&&value!=="")covered++;
  }
  return total?covered/total*100:0;
}
function completeYears(rows){
  const byYear=new Map();
  for(const row of rows){
    const year=n(row.fiscal_year),fp=String(row.fiscal_period??"").toUpperCase();
    if(!year||!["Q1","Q2","Q3","Q4"].includes(fp))continue;
    if(!byYear.has(year))byYear.set(year,new Set());
    byYear.get(year).add(fp);
  }
  return [...byYear.values()].filter(set=>set.size===4).length;
}
function latestDraftIndustryCoverage(draft,module){
  if(!module)return 100;
  const required=INDUSTRY_MODULES[module]?.requiredMetricKeys??[];
  if(!required.length)return 100;
  const rows=Array.isArray(draft?.draft_payload?.metric_observations)?draft.draft_payload.metric_observations:[];
  const covered=required.filter(key=>rows.some(row=>row.module===module&&row.metric_key===key&&["available","not_applicable"].includes(row.status))).length;
  return covered/required.length*100;
}

export function buildCoverageReport({company,fundamentals=[],marketDays=0,context=null,draft=null,asOfDate=new Date().toISOString().slice(0,10)}){
  const module=industryModuleForTicker(company.ticker);
  const rows=uniqueQuarterRows(fundamentals).slice(0,44);
  const latest5=rows.slice(0,5);
  const fundamentalFields=module==="financial_bank"
    ? ["revenue","net_income","shares_outstanding","eps_diluted"]
    : ["revenue","net_income","operating_cash_flow","free_cash_flow","shares_outstanding","eps_diluted"];
  const fundamentalsPct=clamp(fieldCoverage(latest5,fundamentalFields));

  const balanceFields=module==="financial_bank"
    ? [
        r=>rawBalance(r).cashAndCashEquivalents,
        r=>rawBalance(r).totalDebt,
        r=>rawBalance(r).stockholdersEquity,
        r=>rawBalance(r).totalAssets,
        r=>rawBalance(r).totalLiabilities,
      ]
    : [
        r=>rawBalance(r).cashAndCashEquivalents,
        r=>rawBalance(r).totalDebt,
        r=>rawBalance(r).currentAssets,
        r=>rawBalance(r).currentLiabilities,
        r=>rawBalance(r).stockholdersEquity,
        r=>rawBalance(r).retainedEarnings,
      ];
  const balanceSheetPct=clamp(fieldCoverage(latest5,balanceFields));
  const years=completeYears(rows);
  const historyPct=clamp(years/5*100);
  const marketHistoryPct=clamp(Number(marketDays??0)/1260*100);
  const industryPct=clamp(latestDraftIndustryCoverage(draft,module));
  const peerSummary=context?.summary??{};
  const configured=Number(peerSummary.configured_peers??0),withData=Number(peerSummary.peers_with_local_data??0);
  const peerPct=clamp(configured?withData/configured*100:0);
  const primarySourceQuarters=rows.filter(r=>r.provider==="sec_companyfacts").length;

  const missing=[];
  for(const field of fundamentalFields){
    if(!latest5.some(r=>r[field]!==null&&r[field]!==undefined))missing.push({layer:"fundamentals",field});
  }
  const balanceNames=module==="financial_bank"
    ? ["cash","total_debt","equity","assets","liabilities"]
    : ["cash","total_debt","current_assets","current_liabilities","equity","retained_earnings"];
  balanceNames.forEach((field,i)=>{
    if(!latest5.some(r=>{const value=balanceFields[i](r);return value!==null&&value!==undefined;}))missing.push({layer:"balance_sheet",field});
  });
  if(years<5)missing.push({layer:"history",field:"complete_fiscal_years",have:years,target:5});
  if(marketDays<756)missing.push({layer:"market_history",field:"trading_days",have:marketDays,target:756});
  if(industryPct<80)missing.push({layer:"industry",field:"industry_module_coverage",have:industryPct,target:80});
  if(peerPct<50)missing.push({layer:"peers",field:"peer_data_coverage",have:peerPct,target:50});

  const providerSummary={};
  for(const row of fundamentals){
    const p=row.provider??"unknown";
    providerSummary[p]=(providerSummary[p]??0)+1;
  }
  const limitations=[];
  if(primarySourceQuarters<20)limitations.push("Primary-source quarterly history covers fewer than five years.");
  if(marketDays<1260)limitations.push("Market history is below the five-year valuation-context target.");
  if(peerPct<100)limitations.push("Some configured peers are not yet locally ingested.");
  if(module==="financial_bank")limitations.push("Bank coverage intentionally excludes generic FCF requirements.");

  const overallPct=clamp(
    fundamentalsPct*.35+
    balanceSheetPct*.15+
    historyPct*.20+
    marketHistoryPct*.15+
    industryPct*.10+
    peerPct*.05
  );
  const status=
    fundamentalsPct>=80&&historyPct>=80&&balanceSheetPct>=60&&overallPct>=70
      ?"sufficient"
      : fundamentalsPct>0||historyPct>0
        ?"partial"
        :"blocked";

  return{
    company_id:company.id,engine_version:COVERAGE_ENGINE_VERSION,as_of_date:asOfDate,status,
    fundamentals_pct:fundamentalsPct,balance_sheet_pct:balanceSheetPct,history_pct:historyPct,
    market_history_pct:marketHistoryPct,industry_pct:industryPct,peer_pct:peerPct,overall_pct:overallPct,
    normalized_quarters:rows.length,complete_fiscal_years:years,market_days:Number(marketDays??0),
    primary_source_quarters:primarySourceQuarters,missing_fields:missing,provider_summary:providerSummary,limitations,
    generated_at:new Date().toISOString(),updated_at:new Date().toISOString()
  };
}
