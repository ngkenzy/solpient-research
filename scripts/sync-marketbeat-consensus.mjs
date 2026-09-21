import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");

const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const userAgent=process.env.MARKET_DATA_USER_AGENT??"SOLPIENT Research/1.0";

function stripHtml(value=""){
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/\s+/g," ")
    .trim();
}
function n(value){const x=Number(value);return Number.isFinite(x)?x:null;}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

function parseForwardEps(text){
  const patterns=[
    /earnings are expected to (increase|decrease)\s+(-?[0-9.]+)%\s+next year,\s+from\s+\$?([0-9.]+)\s+to\s+\$?([0-9.]+)\s+per share/i,
    /expected to (increase|decrease)\s+(-?[0-9.]+)%.*?from\s+\$?([0-9.]+)\s+to\s+\$?([0-9.]+)\s+per share/i,
  ];
  for(const pattern of patterns){
    const match=text.match(pattern);
    if(!match)continue;
    const direction=match[1].toLowerCase()==="decrease"?-1:1;
    return {
      current_eps:n(match[3]),
      next_eps:n(match[4]),
      growth_pct:Math.abs(n(match[2])??0)*direction,
    };
  }
  return null;
}

const {data:companies,error:companyError}=await sb
  .from("companies")
  .select("id,ticker,exchange")
  .order("ticker");
if(companyError)throw companyError;

const today=new Date().toISOString().slice(0,10);
let written=0;
let processed=0;

for(const company of companies??[]){
  const exchange=String(company.exchange??"NYSE").toUpperCase().replace(/[^A-Z]/g,"");
  const ticker=String(company.ticker??"").toUpperCase();
  if(!ticker)continue;
  const endpoint=`https://www.marketbeat.com/stocks/${exchange}/${ticker}/earnings/`;

  try{
    const existing=await sb
      .from("consensus_snapshots")
      .select("id")
      .eq("company_id",company.id)
      .eq("provider","marketbeat")
      .gte("observed_at",today+"T00:00:00Z")
      .lt("observed_at",new Date(Date.now()+86400000).toISOString().slice(0,10)+"T00:00:00Z")
      .limit(1);
    if(existing.error)throw existing.error;
    if((existing.data??[]).length){processed++;continue;}

    const response=await fetch(endpoint,{headers:{"User-Agent":userAgent,Accept:"text/html"}});
    if(!response.ok){console.warn("Consensus",ticker,"HTTP",response.status);continue;}
    const html=await response.text();
    const parsed=parseForwardEps(stripHtml(html));
    if(!parsed?.next_eps){console.warn("Consensus",ticker,"no forward EPS pattern");continue;}

    const {error}=await sb.from("consensus_snapshots").insert({
      company_id:company.id,
      observed_at:new Date().toISOString(),
      provider:"marketbeat",
      revenue_next_fy:null,
      eps_next_fy:parsed.next_eps,
      revenue_growth_next_fy:null,
      eps_growth_next_fy:parsed.growth_pct,
      analyst_count:null,
      raw_payload:{
        source_url:endpoint,
        current_year_eps:parsed.current_eps,
        parser:"marketbeat_forward_eps_sentence_v1",
      },
    });
    if(error)throw error;
    written++;processed++;
    console.log("Consensus",ticker,"next EPS",parsed.next_eps,"growth",parsed.growth_pct);
  }catch(error){
    console.warn("Consensus failed",ticker,error instanceof Error?error.message:String(error));
  }
  await sleep(140);
}

console.log(JSON.stringify({processed,written,date:today},null,2));
