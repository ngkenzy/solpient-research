import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { classifyIssuerSector } from "../lib/universe-sector-model-v2-2.mjs";

function arg(name,fallback=null){
  const prefix="--"+name+"=";
  const found=process.argv.find(x=>x.startsWith(prefix));
  return found?found.slice(prefix.length):fallback;
}
const inputPath=arg("input",process.env.UNIVERSE_INPUT_PATH??null);
if(!inputPath)throw new Error("Provide --input=/path/to/universe.json.");

function parse(filePath){
  const raw=fs.readFileSync(filePath,"utf8");
  const ext=path.extname(filePath).toLowerCase();
  if(ext===".jsonl"||ext===".ndjson")return raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(JSON.parse);
  const parsed=JSON.parse(raw);
  if(Array.isArray(parsed))return parsed;
  if(Array.isArray(parsed.securities))return parsed.securities;
  throw new Error("Universe input must be an array, JSONL, or object with securities.");
}

const rows=parse(inputPath).map(row=>{
  const classification=classifyIssuerSector({
    ticker:row.ticker,
    cik:row.cik,
    companyName:row.company_name??row.companyName,
    sic:row.sic,
    sicDescription:row.sic_description??row.sicDescription??"",
    existingSector:row.sector,
    existingIndustry:row.industry,
    existingScreenProfile:row.screen_profile,
  });
  return{
    ticker:String(row.ticker??"").toUpperCase(),
    company_name:row.company_name??row.companyName??null,
    sic:row.sic??null,
    sic_description:row.sic_description??row.sicDescription??null,
    previous_sector:row.sector??null,
    previous_profile:row.screen_profile??null,
    sector:classification.sector,
    industry:classification.industry,
    profile:classification.screen_profile,
    method:classification.classification_method,
    rule:classification.classification_rule,
    confidence:classification.classification_confidence,
    rationale:classification.classification_rationale??null,
  };
});

const counts={};
for(const row of rows)counts[row.method]=(counts[row.method]??0)+1;
const repaired=rows.filter(r=>
  r.method==="issuer_override"||
  r.method==="sic_rule"||
  r.method==="description_rule"
);
const unresolved=rows.filter(r=>r.method==="unresolved"||r.sector==="Unknown");
const changed=rows.filter(r=>
  String(r.previous_sector??"")!==String(r.sector??"")||
  String(r.previous_profile??"")!==String(r.profile??"")
);

console.log(JSON.stringify({
  input_count:rows.length,
  method_counts:Object.fromEntries(Object.entries(counts).sort((a,b)=>b[1]-a[1])),
  repaired_count:repaired.length,
  changed_count:changed.length,
  unresolved_count:unresolved.length,
  repaired:repaired.sort((a,b)=>a.ticker.localeCompare(b.ticker)),
  unresolved:unresolved.sort((a,b)=>a.ticker.localeCompare(b.ticker)),
},null,2));
