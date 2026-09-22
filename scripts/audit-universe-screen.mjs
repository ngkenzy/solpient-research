import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildUniverseQAReport } from "../lib/universe-qa-engine.mjs";

function arg(name,fallback=null){
  const prefix="--"+name+"=";
  const hit=process.argv.find(x=>x.startsWith(prefix));
  return hit?hit.slice(prefix.length):fallback;
}

const inputPath=arg("input");
const outputPath=arg("output");
const limit=Math.max(1,Number(arg("limit","100"))||100);
if(!inputPath)throw new Error("Provide --input=/path/to/universe.json.");

function parse(filePath){
  const raw=fs.readFileSync(filePath,"utf8");
  const ext=path.extname(filePath).toLowerCase();
  if(ext===".jsonl"||ext===".ndjson"){
    return raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(JSON.parse);
  }
  const parsed=JSON.parse(raw);
  if(Array.isArray(parsed))return parsed;
  if(Array.isArray(parsed.securities))return parsed.securities;
  throw new Error("Universe input must be an array, JSONL/NDJSON, or an object with securities.");
}

const rows=parse(inputPath);
const report=buildUniverseQAReport(rows,{limit});
const output=JSON.stringify(report,null,2)+"\n";

if(outputPath){
  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  fs.writeFileSync(outputPath,output);
  console.log(JSON.stringify({
    output:outputPath,
    status:report.status,
    blockers:report.blockers,
    review_items:report.review_items,
    input_count:report.funnel.input_count,
    shortlist_count:report.funnel.proposed_deep_research,
  },null,2));
}else{
  process.stdout.write(output);
}

if(report.status!=="pass"&&process.argv.includes("--fail-on-review"))process.exit(2);
