export const MARKETBEAT_CAPITAL_PROVIDER = "marketbeat";

function decodeHtml(value="") {
  return String(value)
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'")
    .replace(/&#x27;/gi,"'")
    .replace(/&ndash;/gi,"-")
    .replace(/&mdash;/gi,"-");
}
function stripTags(value="") {
  return decodeHtml(
    String(value)
      .replace(/<script[\s\S]*?<\/script>/gi," ")
      .replace(/<style[\s\S]*?<\/style>/gi," ")
      .replace(/<br\s*\/?\s*>/gi," ")
      .replace(/<[^>]+>/g," ")
  ).replace(/\s+/g," ").trim();
}
function tableRows(html) {
  const rows=[];
  for(const rowHtml of String(html??"").match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)??[]){
    const cells=[...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m)=>stripTags(m[1]));
    if(cells.length) rows.push(cells);
  }
  return rows;
}
function parseNumber(value) {
  const cleaned=String(value??"").replace(/[^0-9.+-]/g,"");
  if(!cleaned)return null;
  const n=Number(cleaned);
  return Number.isFinite(n)?n:null;
}
function parseMoney(value) {
  const text=String(value??"").trim().replace(/,/g,"");
  if(!text||/^N\/?A$/i.test(text))return null;
  const match=text.match(/\$?(-?[0-9]+(?:\.[0-9]+)?)\s*([KMBT])?/i);
  if(!match)return null;
  const base=Number(match[1]);
  if(!Number.isFinite(base))return null;
  const mult={K:1e3,M:1e6,B:1e9,T:1e12}[String(match[2]??"").toUpperCase()]??1;
  return base*mult;
}
function parsePercent(value) {
  const text=String(value??"").trim();
  if(!text||/^N\/?A$/i.test(text))return null;
  const n=Number(text.replace("%","").replace("+","").trim());
  return Number.isFinite(n)?n:null;
}
function isoDate(value) {
  const text=String(value??"").trim();
  if(!text)return null;
  const d=new Date(text+" 00:00:00 UTC");
  return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):null;
}
function safeKey(value) {
  return String(value??"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,120);
}
function splitInsider(value) {
  const text=String(value??"").trim();
  const political=text.match(/^(.*?)(House|Senate)\s*\([^)]*\)$/i);
  if(political)return {political:true,name:political[1].trim(),detail:political[2]};
  const match=text.match(/^(.*?)(Chairman(?:\s*&\s*CEO)?|President(?:\s*&\s*CEO)?|CEO|CFO|COO|EVP|SVP|VP|Director|Officer|Insider|10%\s*Owner)$/i);
  if(match)return {political:false,name:match[1].trim(),detail:match[2].trim()};
  return {political:/\b(House|Senate)\b/i.test(text),name:text,detail:"Insider"};
}
function monthsAgo(dateText,months) {
  const d=new Date(dateText+"T00:00:00Z");
  if(!Number.isFinite(d.getTime()))return null;
  d.setUTCMonth(d.getUTCMonth()-months);
  return d.toISOString().slice(0,10);
}
export function marketBeatPageLooksValid(html,{ticker,kind}={}) {
  const text=stripTags(html);
  const tickerOk=!ticker||new RegExp("\\b"+String(ticker).replace(/[^A-Z0-9.]/gi,"\\$&")+"\\b","i").test(text);
  if(!tickerOk)return false;
  if(kind==="insider")return /Insider Buying and Selling Activity|Insider Trading & Ownership/i.test(text);
  if(kind==="institutional")return /Institutional Ownership Changes|Institutional Ownership/i.test(text);
  return false;
}

export function normalizeMarketBeatInsiders({
  company,
  html,
  sourceUrl,
  verifiedAt=new Date().toISOString(),
  maxRows=100,
}={}) {
  const ticker=company?.ticker;
  const rows=[];
  for(const cells of tableRows(html)){
    if(cells.length<6)continue;
    const action=String(cells[2]??"").trim();
    if(!/^(Buy|Sell)$/i.test(action))continue;
    const actor=splitInsider(cells[1]);
    if(actor.political)continue;
    const transactionDate=isoDate(cells[0]);
    const shares=parseNumber(cells[3]);
    const price=parseMoney(cells[4]);
    const value=parseMoney(cells[5]);
    if(!transactionDate||!actor.name)continue;
    rows.push({
      company_id:company.id,
      activity_type:"insider",
      actor_name:actor.name,
      actor_detail:actor.detail||"Insider",
      action:action[0].toUpperCase()+action.slice(1).toLowerCase(),
      shares,
      price,
      value,
      change_pct:null,
      amount_range:null,
      transaction_date:transactionDate,
      disclosure_date:null,
      position_date:null,
      source_url:sourceUrl,
      provider:MARKETBEAT_CAPITAL_PROVIDER,
      source_key:["marketbeat","insider",ticker,safeKey(actor.name),transactionDate,shares??"na",value??"na"].join(":"),
      verified_at:verifiedAt,
      raw_payload:{source:"MarketBeat insider trades public page"},
    });
    if(rows.length>=maxRows)break;
  }

  const text=stripTags(html);
  const buyingMatch=text.match(/Number\s+Of\s+Insiders\s+Buying\s*\(Last\s+12\s+Months\)\s*([0-9,]+)/i);
  const sellingMatch=text.match(/Number\s+Of\s+Insiders\s+Selling\s*\(Last\s+12\s+Months\)\s*([0-9,]+)/i);
  const buys=buyingMatch?parseNumber(buyingMatch[1]):null;
  const sells=sellingMatch?parseNumber(sellingMatch[1]):null;
  const end=verifiedAt.slice(0,10);
  const start=monthsAgo(end,12);
  const recentRows=rows.filter((row)=>
    row.transaction_date&&start&&row.transaction_date>=start&&row.transaction_date<=end
  );
  const summaryShowsActivity=(buys??0)>0||(sells??0)>0;
  const verifiedNone=buys===0&&sells===0;
  const status=recentRows.length||summaryShowsActivity
    ?"activity_found"
    :verifiedNone
      ?"verified_none"
      :"partial";

  return {
    rows,
    coverage:{
      company_id:company.id,
      activity_type:"insider",
      status,
      provider:MARKETBEAT_CAPITAL_PROVIDER,
      window_start:start,
      window_end:end,
      verified_at:verifiedAt,
      record_count:recentRows.length,
      source_url:sourceUrl,
      source_key:["marketbeat","coverage",ticker,"insider",end].join(":"),
      notes:status==="activity_found"
        ?"MarketBeat reports qualifying insider Buy/Sell activity in the last 12 months."
        :verifiedNone
          ?"MarketBeat reports zero insiders buying and zero insiders selling over the last 12 months."
          :"MarketBeat page loaded but did not provide enough evidence for a verified-negative insider result.",
      metadata:{
        source:"public_html",
        summary_buys:buys,
        summary_sells:sells,
        historical_rows_parsed:rows.length,
        recent_rows_parsed:recentRows.length,
      },
      updated_at:new Date().toISOString(),
    },
  };
}

export function normalizeMarketBeatInstitutional({
  company,
  html,
  sourceUrl,
  verifiedAt=new Date().toISOString(),
  maxRows=100,
}={}) {
  const ticker=company?.ticker;
  const rows=[];
  for(const cells of tableRows(html)){
    if(cells.length<6)continue;
    const reportingDate=isoDate(cells[0]);
    const organization=String(cells[1]??"").trim();
    if(!reportingDate||!organization||/Major Shareholder Name/i.test(organization))continue;
    const shares=parseNumber(cells[2]);
    const value=parseMoney(cells[3]);
    const changePct=parsePercent(cells[5]);
    const action=changePct==null?"Reported":changePct>0.5?"Increased":changePct<-0.5?"Reduced":"Reported";
    rows.push({
      company_id:company.id,
      activity_type:"institutional",
      actor_name:organization,
      actor_detail:"Institutional holder",
      action,
      shares,
      price:null,
      value,
      change_pct:changePct,
      amount_range:null,
      transaction_date:null,
      disclosure_date:reportingDate,
      position_date:reportingDate,
      source_url:sourceUrl,
      provider:MARKETBEAT_CAPITAL_PROVIDER,
      source_key:["marketbeat","institutional",ticker,safeKey(organization),reportingDate].join(":"),
      verified_at:verifiedAt,
      raw_payload:{
        source:"MarketBeat institutional ownership public page",
        pct_portfolio:parsePercent(cells[4]),
        ownership_company:parsePercent(cells[6]),
      },
    });
    if(rows.length>=maxRows)break;
  }

  const deduped=[...new Map(rows.map((row)=>[row.source_key,row])).values()];
  const text=stripTags(html);
  const unavailable=/Institutional Holdings is currently not available/i.test(text);
  const end=verifiedAt.slice(0,10);
  return {
    rows:deduped,
    coverage:{
      company_id:company.id,
      activity_type:"institutional",
      status:deduped.length?"activity_found":unavailable?"unavailable":"partial",
      provider:MARKETBEAT_CAPITAL_PROVIDER,
      window_start:null,
      window_end:end,
      verified_at:verifiedAt,
      record_count:deduped.length,
      source_url:sourceUrl,
      source_key:["marketbeat","coverage",ticker,"institutional",end].join(":"),
      notes:deduped.length
        ?"MarketBeat public institutional-ownership page returned disclosed holder positions."
        :unavailable
          ?"MarketBeat explicitly reports institutional holdings as unavailable."
          :"MarketBeat page loaded but no holder rows were parsed; coverage remains partial.",
      metadata:{source:"public_html"},
      updated_at:new Date().toISOString(),
    },
  };
}
