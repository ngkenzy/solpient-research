import { YAHOO_FINANCIAL_KEYS, normalizeYahooFundamentals } from "./yahoo-fundamentals.mjs";
import { peerSetForTicker } from "./peer-sets.mjs";

function n(v){if(v===null||v===undefined||(typeof v==="string"&&v.trim()===""))return null;const x=Number(v);return Number.isFinite(x)?x:null;}
function ratio(a,b,scale=1){const x=n(a),y=n(b);return x==null||y==null||y===0?null:(x/y)*scale;}
function pctChange(a,b){const x=n(a),y=n(b);return x==null||y==null||y===0?null:(x/y-1)*100;}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function sum(rows,fn){const xs=rows.map(fn);return xs.some(v=>n(v)==null)?null:xs.reduce((a,v)=>a+n(v),0);}
function raw(row,section,key){return n(row?.raw_payload?.[section]?.[key]);}

async function cookieCrumb(userAgent){
  try{
    const boot=await fetch("https://fc.yahoo.com",{headers:{"User-Agent":userAgent},redirect:"manual"});
    const sets=typeof boot.headers.getSetCookie==="function"?boot.headers.getSetCookie():[boot.headers.get("set-cookie")].filter(Boolean);
    const cookie=sets.map(v=>String(v).split(";")[0]).join("; ");
    if(!cookie)return null;
    const res=await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb",{headers:{"User-Agent":userAgent,Cookie:cookie}});
    if(!res.ok)return null;
    const crumb=(await res.text()).trim();
    return crumb?{cookie,crumb}:null;
  }catch{return null;}
}

async function requestSeries(symbol,prefix,userAgent,authRef){
  const types=YAHOO_FINANCIAL_KEYS.map(k=>prefix+k).join(",");
  const period1=Math.floor(new Date("2014-01-01T00:00:00Z").getTime()/1000);
  const period2=Math.floor(Date.now()/1000)+86400;
  async function attempt(host,withAuth=false){
    const endpoint=new URL(host+"/ws/fundamentals-timeseries/v1/finance/timeseries/"+encodeURIComponent(symbol));
    endpoint.searchParams.set("symbol",symbol);endpoint.searchParams.set("type",types);
    endpoint.searchParams.set("period1",String(period1));endpoint.searchParams.set("period2",String(period2));
    const headers={"User-Agent":userAgent,Accept:"application/json"};
    if(withAuth&&authRef.value){endpoint.searchParams.set("crumb",authRef.value.crumb);headers.Cookie=authRef.value.cookie;}
    const res=await fetch(endpoint,{headers});
    const txt=await res.text();let body;try{body=JSON.parse(txt);}catch{body=null;}
    const error=body?.timeseries?.error??body?.finance?.error;
    if(res.ok&&!error&&Array.isArray(body?.timeseries?.result))return body;
    const e=new Error("Yahoo peer fundamentals HTTP "+res.status+": "+String(error?.description??txt).slice(0,160));e.status=res.status;throw e;
  }
  try{return await attempt("https://query1.finance.yahoo.com");}
  catch(first){
    try{return await attempt("https://query2.finance.yahoo.com");}
    catch(second){
      if([401,403].includes(Number(second.status??first.status))){
        authRef.value=authRef.value??await cookieCrumb(userAgent);
        if(authRef.value)return attempt("https://query2.finance.yahoo.com",true);
      }
      throw second;
    }
  }
}

async function alphaOverview(symbol,apiKey){
  if(!apiKey)return null;
  const endpoint=new URL("https://www.alphavantage.co/query");
  endpoint.searchParams.set("function","OVERVIEW");
  endpoint.searchParams.set("symbol",symbol);
  endpoint.searchParams.set("apikey",apiKey);
  const res=await fetch(endpoint,{headers:{Accept:"application/json"}});
  if(!res.ok)throw new Error("Alpha Vantage overview HTTP "+res.status);
  const body=await res.json();
  if(body?.Note||body?.Information||body?.["Error Message"])throw new Error(String(body.Note??body.Information??body["Error Message"]));
  const forwardPe=n(body?.ForwardPE),trailingPe=n(body?.PERatio);
  return{
    forward_pe:forwardPe!=null&&forwardPe>0&&forwardPe<200?forwardPe:null,
    pe:trailingPe!=null&&trailingPe>0&&trailingPe<200?trailingPe:null,
  };
}

async function latestPrice(symbol,userAgent){
  const endpoint="https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol)+"?interval=1d&range=5d&includePrePost=false";
  const res=await fetch(endpoint,{headers:{"User-Agent":userAgent,Accept:"application/json"}});
  if(!res.ok)throw new Error("Yahoo peer price HTTP "+res.status);
  const body=await res.json(),result=body?.chart?.result?.[0];
  if(!result)throw new Error("No Yahoo chart result for "+symbol);
  const ts=result.timestamp??[],closes=result.indicators?.quote?.[0]?.close??[];
  for(let i=closes.length-1;i>=0;i--){
    const price=n(closes[i]);if(price==null)continue;
    return{price,trading_date:new Date(Number(ts[i])*1000).toISOString().slice(0,10),source_url:endpoint};
  }
  throw new Error("No recent price for "+symbol);
}

function comparablePrior(rows,latest){
  if(!latest)return null;
  const expected=new Date(String(latest.period_end)+"T00:00:00Z");expected.setUTCFullYear(expected.getUTCFullYear()-1);
  return rows
    .filter(r=>r.period_end!==latest.period_end)
    .map(r=>({r,d:Math.abs(new Date(String(r.period_end)+"T00:00:00Z")-expected)}))
    .filter(x=>Number.isFinite(x.d)&&x.d<=45*86400000)
    .sort((a,b)=>a.d-b.d)[0]?.r??null;
}

function metricsFromRows(rows,price){
  const q=[...rows].filter(r=>String(r.form).toUpperCase()==="10-Q").sort((a,b)=>String(b.period_end).localeCompare(String(a.period_end)));
  const latest=q[0],prior=comparablePrior(q,latest),ttm=q.slice(0,4),priorTtm=q.slice(4,8);
  if(!latest||ttm.length<4)return null;
  const revenue=sum(ttm,r=>r.revenue),netIncome=sum(ttm,r=>r.net_income),fcf=sum(ttm,r=>r.free_cash_flow);
  const grossProfit=sum(ttm,r=>raw(r,"income","grossProfit")),operatingIncome=sum(ttm,r=>raw(r,"income","operatingIncome"));
  const shares=n(latest.shares_outstanding),marketCap=shares&&price?shares*price:null;
  const currentFcfPerShare=fcf!=null&&shares?fcf/shares:null;
  let priorFcfPerShare=null;
  if(priorTtm.length===4){
    const pFcf=sum(priorTtm,r=>r.free_cash_flow),pShares=n(priorTtm[0]?.shares_outstanding);
    priorFcfPerShare=pFcf!=null&&pShares?pFcf/pShares:null;
  }
  return{
    revenue_growth_yoy:pctChange(latest.revenue,prior?.revenue),
    gross_margin:ratio(grossProfit,revenue,100),
    operating_margin:ratio(operatingIncome,revenue,100),
    net_margin:ratio(netIncome,revenue,100),
    fcf_margin:ratio(fcf,revenue,100),
    fcf_per_share_growth_yoy:pctChange(currentFcfPerShare,priorFcfPerShare),
    share_count_growth_yoy:pctChange(latest.shares_outstanding,prior?.shares_outstanding),
    pe:ratio(marketCap,netIncome),
    price_to_fcf:ratio(marketCap,fcf),
    fcf_yield:ratio(fcf,marketCap,100),
  };
}

export async function buildReferencePeerContext({ticker,asOfDate=new Date().toISOString().slice(0,10),userAgent=process.env.YAHOO_DATA_USER_AGENT??"SOLPIENT Research/1.0",alphaVantageKey=process.env.ALPHA_VANTAGE_API_KEY??null}){
  const peerSet=peerSetForTicker(ticker);
  const peerComparison=[],snapshotRows=[];
  const authRef={value:null};
  for(const peer of peerSet){
    try{
      const [quarterlyBody,annualBody,market]=await Promise.all([
        requestSeries(peer.ticker,"quarterly",userAgent,authRef),
        requestSeries(peer.ticker,"annual",userAgent,authRef),
        latestPrice(peer.ticker,userAgent),
      ]);
      const normalized=normalizeYahooFundamentals({company:{id:"reference-peer",ticker:peer.ticker},quarterlyBody,annualBody,industryModule:null});
      const metrics=metricsFromRows(normalized.rows,market.price);
      if(!metrics)throw new Error("Insufficient normalized peer history");
      if(alphaVantageKey){
        try{
          const overview=await alphaOverview(peer.ticker,alphaVantageKey);
          if(overview?.forward_pe!=null)metrics.forward_pe=overview.forward_pe;
          if(metrics.pe==null&&overview?.pe!=null)metrics.pe=overview.pe;
        }catch{
          // Forward valuation is optional at ingestion; decision-grade validation handles absence.
        }
      }
      const selected={};
      for(const [metric_key,value] of Object.entries(metrics)){
        if(n(value)==null)continue;selected[metric_key]=value;
        snapshotRows.push({
          peer_ticker:peer.ticker,metric_key,as_of_date:asOfDate,value_numeric:value,value_text:null,
          unit:metric_key.includes("margin")||metric_key.includes("growth")||metric_key==="fcf_yield"?"percent":metric_key==="pe"||metric_key==="price_to_fcf"?"x":null,
          provider:metric_key==="forward_pe"?"alpha-vantage-overview":"yahoo-reference-peer-v1",
          source_url:metric_key==="forward_pe"?"https://www.alphavantage.co/documentation/#company-overview":market.source_url,
          observed_at:new Date().toISOString()
        });
      }
      peerComparison.push({...peer,data_status:"available",metrics:selected,market_date:market.trading_date});
    }catch(error){
      peerComparison.push({...peer,data_status:"unavailable",metrics:{},error:error instanceof Error?error.message:String(error)});
    }
    await sleep(120);
  }
  return{peerSet,peerComparison,snapshotRows};
}
