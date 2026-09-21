import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { validateCatalog } from "../lib/methodology-governance.mjs";

const catalogPath=process.env.METHODOLOGY_CATALOG_PATH??"methodologies/catalog.json";
const catalog=JSON.parse(fs.readFileSync(catalogPath,"utf8"));
const validation=validateCatalog(catalog.methodologies??[]);
if(!validation.valid){
  console.error(validation.errors.join("\n"));
  process.exit(1);
}

const failures=[];
const results=[];
for(const m of validation.manifests){
  const existing=[];
  const containing=[];
  for(const file of m.source_files){
    if(!fs.existsSync(file))continue;
    existing.push(file);
    const content=fs.readFileSync(file,"utf8");
    if(content.includes(m.version))containing.push(file);
  }
  if(!existing.length){
    failures.push(m.version+": none of the declared source files exist.");
  }else if(!containing.length){
    failures.push(m.version+": version string is not present in any declared source file.");
  }
  results.push({
    methodology_key:m.methodology_key,
    version:m.version,
    existing_source_files:existing,
    version_evidence_files:containing,
  });
}

console.log(JSON.stringify({
  valid:failures.length===0,
  catalog_entries:results.length,
  failures,
  results,
},null,2));

if(failures.length)process.exit(1);
