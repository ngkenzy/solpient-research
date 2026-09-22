import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const envPath = path.join(root, ".env.local");
const backupPath = path.join(root, ".env.local.before-local-db");

const values = {
  NEXT_PUBLIC_SOLPIENT_DATA_API_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SOLPIENT_DATA_API_KEY: "local-dev-only",
  SOLPIENT_ADMIN_DATA_API_URL: "http://127.0.0.1:54321",
  SOLPIENT_ADMIN_DATA_API_KEY: "local-dev-only",
};

let text = "";
if (fs.existsSync(envPath)) {
  text = fs.readFileSync(envPath, "utf8");
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(envPath, backupPath);
    console.log("Backed up .env.local to .env.local.before-local-db");
  }
}

const keys = new Set(Object.keys(values));
const kept = text
  .split(/\r?\n/)
  .filter((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    return !match || !keys.has(match[1]);
  });

while (kept.length && kept.at(-1) === "") kept.pop();

const localBlock = [
  "",
  "# Solpient-owned local database",
  ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
  "",
];

fs.writeFileSync(envPath, [...kept, ...localBlock].join("\n"), "utf8");

console.log("Configured .env.local to use the Solpient-owned local data API.");
console.log("Hosted Supabase variables were preserved as migration fallback.");
