import fs from "node:fs/promises";
import process from "node:process";
import { validateResearchStandard } from "../lib/research-standard-v1.mjs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/validate-research-standard.mjs <research-json>");
  process.exit(1);
}

const payload = JSON.parse(await fs.readFile(path, "utf8"));
const result = validateResearchStandard(payload);
console.log(JSON.stringify(result, null, 2));
if (result.applies && !result.valid) process.exit(2);
