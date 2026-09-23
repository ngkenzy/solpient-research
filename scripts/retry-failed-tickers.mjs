import process from "node:process";
import { spawn } from "node:child_process";
import { readFailureJournal } from "../lib/daily-reliability.mjs";

const dryRun = process.argv.includes("--dry-run");
const journal = readFailureJournal();
const tickers = (journal.tickers ?? []).map((row) => row.ticker).filter(Boolean);

if (!tickers.length) {
  console.log(JSON.stringify({ ok: true, retried: 0, reason: "no_failed_tickers" }, null, 2));
  process.exit(0);
}

const args = ["scripts/sync-market-history.mjs", "--tickers", tickers.join(",")];

if (dryRun) {
  console.log(JSON.stringify({ dry_run: true, tickers, command: ["node", ...args] }, null, 2));
  process.exit(0);
}

const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
