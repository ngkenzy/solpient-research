export const QUIVER_POLITICAL_PROVIDER = "quiver";

function decodeHtml(value="") {
  return String(value)
    .replace(/&nbsp;/g," ")
    .replace(/&amp;/g,"&")
    .replace(/&lt;/g,"<")
    .replace(/&gt;/g,">")
    .replace(/&quot;/g,'"')
    .replace(/&#39;/g,"'")
    .replace(/&#x27;/gi,"'")
    .replace(/&#x2F;/gi,"/");
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
function isoDate(value) {
  const text=String(value??"").trim();
  if(!text||/^N\/?A$/i.test(text))return null;
  const d=new Date(text+" 00:00:00 UTC");
  return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):null;
}
function safeKey(value) {
  return String(value??"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,120);
}
function parsePolitician(value) {
  const text=String(value??"").trim();
  const match=text.match(/^(.*?)\s+(House|Senate)\s*\/\s*([A-Za-z])$/i);
  if(!match)return {name:text||"Political filer",detail:"Public disclosure"};
  return {name:match[1].trim(),detail:match[2][0].toUpperCase()+match[2].slice(1).toLowerCase()+" / "+match[3].toUpperCase()};
}
function parseTransaction(value) {
  const text=String(value??"").trim();
  const match=text.match(/^(Purchase|Sale)\s+(.+)$/i);
  if(!match)return null;
  return {
    action:match[1][0].toUpperCase()+match[1].slice(1).toLowerCase(),
    amountRange:match[2].trim(),
  };
}
function tableRows(html) {
  const rows=[];
  const matches=String(html??"").match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)??[];
  for(const rowHtml of matches){
    const cells=[...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m)=>stripTags(m[1]));
    if(cells.length>=5)rows.push(cells);
  }
  return rows;
}

export function normalizeQuiverPolitical({
  company,
  html,
  verifiedAt=new Date().toISOString(),
  windowStart=null,
  windowEnd=null,
  sourceUrl=null,
  explicitNone=false,
}={}) {
  const ticker=company?.ticker;
  const effectiveSourceUrl=sourceUrl??("https://www.quiverquant.com/congresstrading/stock/"+encodeURIComponent(ticker));
  const end=windowEnd??verifiedAt.slice(0,10);
  const start=windowStart??(()=>{const d=new Date(end+"T00:00:00Z");d.setUTCFullYear(d.getUTCFullYear()-2);return d.toISOString().slice(0,10);})();
  const rows=[];

  if(!explicitNone) for(const cells of tableRows(html)){
    const transaction=parseTransaction(cells[1]);
    if(!transaction)continue;
    const actor=parsePolitician(cells[2]);
    const disclosureDate=isoDate(cells[3]);
    const transactionDate=isoDate(cells[4]);
    const effectiveDate=transactionDate??disclosureDate;
    if(!effectiveDate||effectiveDate<start||effectiveDate>end)continue;

    rows.push({
      company_id:company.id,
      activity_type:"political",
      actor_name:actor.name,
      actor_detail:actor.detail,
      action:transaction.action,
      shares:null,
      price:null,
      value:null,
      change_pct:null,
      amount_range:transaction.amountRange,
      transaction_date:transactionDate,
      disclosure_date:disclosureDate,
      position_date:null,
      source_url:effectiveSourceUrl,
      provider:QUIVER_POLITICAL_PROVIDER,
      source_key:["quiver","political",ticker,safeKey(actor.name),transaction.action.toLowerCase(),transactionDate??"unknown",disclosureDate??"unknown",safeKey(transaction.amountRange)].join(":"),
      verified_at:verifiedAt,
      raw_payload:{
        source:"Quiver Congress Trading public ticker page",
        stock_cell:cells[0],
        description:cells[5]??null,
        verification_window:{start,end},
      },
    });
  }

  const deduped=[...new Map(rows.map((row)=>[row.source_key,row])).values()];
  return {
    rows:deduped,
    coverage:{
      company_id:company.id,
      activity_type:"political",
      status:deduped.length?"activity_found":"verified_none",
      provider:QUIVER_POLITICAL_PROVIDER,
      window_start:start,
      window_end:end,
      verified_at:verifiedAt,
      record_count:deduped.length,
      source_url:effectiveSourceUrl,
      source_key:["quiver","coverage",ticker,start,end].join(":"),
      notes:deduped.length
        ?"Quiver public Congress Trading page returned qualifying Purchase/Sale rows in the verification window."
        :"Quiver public Congress Trading page was successfully checked; no qualifying Purchase/Sale rows were found in the verification window.",
      metadata:{source:"public_html",verification_window:{start,end}},
      updated_at:new Date().toISOString(),
    },
  };
}
