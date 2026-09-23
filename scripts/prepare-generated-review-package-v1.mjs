import process from "node:process";
import { pgMaybeOne, pgQuery, insertObject, postgresConfigured } from "../lib/postgres-node.mjs";
import { applyReviewPatch, validatePromotionReadiness } from "../lib/review-workbench.mjs";

function arg(name, fallback = null) {
  const prefix = "--" + name + "=";
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

if (!postgresConfigured()) throw new Error("SOLPIENT_DATABASE_URL is not configured.");
const ticker = String(arg("ticker", "")).trim().toUpperCase();
if (!ticker) throw new Error("Usage: node scripts/prepare-generated-review-package-v1.mjs --ticker=<TICKER>");

const company = await pgMaybeOne(
  "select * from public.companies where upper(ticker)=$1 limit 1",
  [ticker],
);
if (!company) throw new Error("Company not found: " + ticker);

const draft = await pgMaybeOne(
  "select * from public.baseline_drafts where company_id=$1 and published_run_id is null order by generated_at desc, created_at desc limit 1",
  [company.id],
);
if (!draft) throw new Error("No unpublished baseline draft exists for " + ticker + ".");

const composition = await pgMaybeOne(
  "select * from public.research_compositions where draft_id=$1 and engine_version='composer-v2' and status in ('generated','applied') order by generated_at desc limit 1",
  [draft.id],
);
if (!composition) throw new Error("No Composer V2 package exists for latest draft of " + ticker + ".");

const existing = await pgMaybeOne(
  "select * from public.baseline_reviews where draft_id=$1 limit 1",
  [draft.id],
);

if (existing?.human_verified_at) {
  console.log(JSON.stringify({
    ticker, status: "skipped", reason: "human_verified_review_exists",
    draft_id: draft.id, review_id: existing.id
  }, null, 2));
  process.exit(0);
}

const composerPatch = composition.composition_payload?.review_patch ?? {};
if (!Object.keys(composerPatch).length) {
  throw new Error("Composer V2 review_patch is empty for " + ticker + ".");
}

const merged = applyReviewPatch(draft.draft_payload, composerPatch);
const readiness = validatePromotionReadiness(merged);
const now = new Date().toISOString();

const review = await insertObject(
  "baseline_reviews",
  {
    draft_id: draft.id,
    status: readiness.ready ? "ready" : "editing",
    review_payload: composerPatch,
    validation_result: readiness.standard,
    promotion_readiness: readiness,
    review_notes: "Autonomous Solpient 100 factory prepared this private review package. Human verification is required before release.",
    reviewed_at: null,
    prepared_at: now,
    preparation_source: "solpient_100_baseline_factory_v1",
    human_verified_at: null,
    human_verified_by: null,
    human_verified_payload_hash: null,
    attestation_version: null,
    updated_at: now,
  },
  { conflict: ["draft_id"], update: true, returning: "*" },
);

await pgQuery(
  "update public.research_compositions set status='applied',applied_at=$2::timestamptz,updated_at=$2::timestamptz where id=$1",
  [composition.id, now],
);

await pgQuery(
  "update public.baseline_drafts set status=$2,standard_valid=$3,standard_status=$4,validation_result=$5::jsonb,updated_at=$6::timestamptz where id=$1",
  [draft.id, readiness.ready ? "ready_for_review" : "generated", readiness.standard.valid, readiness.standard.status, JSON.stringify(readiness.standard), now],
);

console.log(JSON.stringify({
  ticker,
  status: readiness.ready ? "ready_for_verification" : "review_blocked",
  draft_id: draft.id,
  composition_id: composition.id,
  review_id: review.id,
  promotion_ready: readiness.ready,
  blocker_count: readiness.blockers.length,
  blockers: readiness.blockers,
  auto_publish: false,
  human_verified: false,
}, null, 2));
