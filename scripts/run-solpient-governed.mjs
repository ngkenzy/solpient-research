import process from "node:process";
import { governedMustNotRunAsDaily } from "../lib/pipeline-lock.mjs";

const dryRun = process.argv.includes("--dry-run");
const confirm = process.argv.includes("--confirm");
const gate = governedMustNotRunAsDaily(process.argv);

if (!gate.ok) {
  console.error(JSON.stringify({ ok: false, reason: gate.reason }, null, 2));
  process.exit(2);
}

const plan = {
  cadence: "governed",
  not_daily: true,
  note: "Does not refresh Solpient 20/5. Membership only. Manual/weekly.",
  steps: [
    { name: "sec_backfill", script: "scripts/sync-sec-companyfacts-backfill.mjs", status: "existing" },
    { name: "universe_screen", script: "scripts/run-universe-screen.mjs", status: "existing_if_present" },
    { name: "candidate_pipeline", script: "scripts/materialize-research-candidate-pipeline-v2-4.mjs", status: "existing_if_present" },
  ],
  retired_do_not_restore: [
    "scripts/local-update-engine.mjs",
    "scripts/local-materialize-research-candidate-pipeline-v2-4.mjs",
    "lib/local-update-plan.mjs",
    "app/api/local-update/",
  ],
};

if (dryRun || !confirm) {
  console.log(JSON.stringify({ dry_run: true, requires_confirm: !confirm, ...plan }, null, 2));
  process.exit(0);
}

console.error(JSON.stringify({
  ok: false,
  reason: "governed_runner_is_plan_only_in_v1",
  message: "Call the existing governed scripts individually. Do not wrap them into local:daily.",
  plan,
}, null, 2));
process.exit(3);
