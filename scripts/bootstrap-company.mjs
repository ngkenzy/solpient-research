import process from "node:process";
import { spawnSync } from "node:child_process";

const ticker=String(process.argv[2]??"").trim().toUpperCase();
if(!ticker){
  console.error("Usage: npm run bootstrap:company -- <TICKER>");
  process.exit(1);
}

const env={...process.env,COVERAGE_TICKER:ticker};
const steps=[
  ["SEC fundamentals",["scripts/sync-sec-companyfacts-backfill.mjs"]],
  ["Yahoo fundamentals fallback",["scripts/sync-yahoo-fundamentals-fallback.mjs"]],
  ["Market history",["scripts/sync-market-history.mjs"]],
  ["Historical and peer context",["scripts/build-historical-peer-context.mjs"]],
  ["Data coverage",["scripts/build-data-coverage.mjs"]],
  ["Baseline draft",["scripts/build-baseline-draft.mjs",ticker]],
  ["Research composition",["scripts/compose-research-drafts.mjs","--ticker="+ticker]],
];

for(const [label,args] of steps){
  console.log("\n=== "+label+" · "+ticker+" ===");
  const result=spawnSync(process.execPath,args,{stdio:"inherit",env});
  if(result.status!==0){
    console.error("\nBootstrap stopped at: "+label);
    process.exit(result.status??1);
  }
}

console.log("\nBootstrap complete for "+ticker+". Open /review to inspect the generated package before publication.");
