import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const envPath = path.join(root, ".env.local");
const stackEnvPath = path.join(root, ".env.local-stack");
const backupPath = path.join(root, ".env.local.before-local-db");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const parsed = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

const stack = parseEnvFile(stackEnvPath);
const dbUser = stack.SOLPIENT_DB_USER || "solpient";
const dbPassword = stack.SOLPIENT_DB_PASSWORD || "solpient_local_change_me";
const dbName = stack.SOLPIENT_DB_NAME || "solpient";
const dbPort = stack.SOLPIENT_DB_PORT || "55432";
const databaseUrl =
  `postgresql://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@127.0.0.1:${dbPort}/${encodeURIComponent(dbName)}`;

const values = {
  SOLPIENT_DATABASE_URL: databaseUrl,
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

console.log("Configured .env.local for direct Solpient PostgreSQL access.");
console.log("The local PostgREST variables remain available as migration fallback.");
console.log("Hosted Supabase variables were preserved as final rollback fallback.");
