import fs from "node:fs";
import process from "node:process";
import {
  analyzePortfolio,
  simulateTrades,
  compareScenarioImpacts,
} from "../lib/portfolio-simulator.mjs";

function arg(name,fallback=null){
  const prefix="--"+name+"=";
  const found=process.argv.find(x=>x.startsWith(prefix));
  return found?found.slice(prefix.length):fallback;
}

const inputPath=arg("input",process.env.PORTFOLIO_SIMULATOR_INPUT??null);
if(!inputPath)throw new Error("Provide --input=/path/to/scenario.json.");

const payload=JSON.parse(fs.readFileSync(inputPath,"utf8"));
const constraints=payload.constraints??{};

if(Array.isArray(payload.scenarios)){
  const results=payload.scenarios.map((scenario)=>simulateTrades({
    portfolio:scenario.portfolio??payload.portfolio??{},
    candidates:scenario.candidates??payload.candidates??[],
    trades:scenario.trades??[],
    constraints:scenario.constraints??constraints,
  }));
  console.log(JSON.stringify({
    scenario_count:results.length,
    comparison:compareScenarioImpacts(results),
    scenarios:results,
  },null,2));
  process.exit(0);
}

if(Array.isArray(payload.trades)&&payload.trades.length){
  console.log(JSON.stringify(simulateTrades({
    portfolio:payload.portfolio??{},
    candidates:payload.candidates??[],
    trades:payload.trades,
    constraints,
  }),null,2));
  process.exit(0);
}

console.log(JSON.stringify(analyzePortfolio(payload.portfolio??payload,constraints),null,2));
