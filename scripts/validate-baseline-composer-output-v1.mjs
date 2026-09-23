import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { validateBaselineComposerOutput } from "../lib/baseline-research-contract-v1.mjs";

function arg(name, fallback = null) {
  const prefix = "--" + name + "=";
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const packPath = arg("pack");
const outputPath = arg("output");

if (!packPath || !outputPath) {
  console.error(
    "Usage: node scripts/validate-baseline-composer-output-v1.mjs --pack=<evidence-pack.json> --output=<composer-output.json>",
  );
  process.exit(2);
}

const [packText, outputText] = await Promise.all([
  fs.readFile(path.resolve(packPath), "utf8"),
  fs.readFile(path.resolve(outputPath), "utf8"),
]);

const pack = JSON.parse(packText);
const output = JSON.parse(outputText);
const result = validateBaselineComposerOutput(pack, output);

console.log(JSON.stringify(result, null, 2));
process.exit(result.valid ? 0 : 1);
