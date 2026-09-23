import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { composeBaselineResearch } from "../lib/baseline-research-composer-v1.mjs";

function arg(name, fallback = null) {
  const prefix = "--" + name + "=";
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const packPath = arg("pack");
const outputPath = arg("output");

if (!packPath) {
  console.error("Usage: node scripts/compose-baseline-research-v1.mjs --pack=<evidence-pack.json> [--output=<file>]");
  process.exit(2);
}

const pack = JSON.parse(fs.readFileSync(path.resolve(packPath), "utf8"));
const output = composeBaselineResearch(pack);
const text = JSON.stringify(output, null, 2);

if (outputPath) {
  const dest = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  console.log(JSON.stringify({ ok: true, ticker: output.company.ticker, output: dest }, null, 2));
} else {
  console.log(text);
}
