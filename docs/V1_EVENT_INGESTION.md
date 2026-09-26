# V1 Real-World Event Ingestion

Deterministic ingestion of real-world company events (PRD §15) into the
materiality pipeline. No LLM anywhere in this path: every classification is a
pure function of the SEC filing text plus the 8-K item code, so the same
filing always yields the same event.

## Pipeline

```
SEC 8-K filings ──detect──> classified taxonomy event ──insert──> company_change_events
   (items metadata            (lib/event-detectors.mjs)            (event_key idempotent)
    + filing text)
        │
        └─ SEC companyfacts ──detect──> share-count event (buyback / dilution)

company_change_events ──Stage A──> materiality_assessments (company-level, versioned)
   (service-role wrapper)            methodology: group-b-event-materiality-v1

materiality_assessments ──Stage B──> user_materiality_assessments (owner-scoped)
   (lazy, on What Matters read)       methodology: group-b-user-materiality-v2
                                      (PR #137 position-weight-aware scoring)

user_materiality_assessments ──union──> get_my_what_matters_v1
```

Stage B refreshes lazily at the start of `get_my_what_matters_v1`, so the
ingestion worker only needs to insert events and run Stage A.

## Event taxonomy (PRD §15)

Eight categories, seeded by migration `20260926160000_v1_event_ingestion.sql`
into `event_taxonomy` and enforced by a foreign key on
`company_change_events.category`:

`financial` `guidance` `business` `competition` `capital_allocation`
`management` `regulatory` `research`

Legacy change-engine categories map deterministically
(`lib/event-detectors.mjs` → `LEGACY_CATEGORY_MAP`; single source of truth,
also used by the backfill script):

- market, valuation, return, consensus, financial, score, coverage → `financial`
- thesis, filing, research → `research`

## Detectors (`lib/event-detectors.mjs`)

Pure functions, unit-tested by `scripts/test-event-detectors.mjs`
(`npm run test:event-detectors`):

- `extractEightKItems(text)` — 8-K item codes present in a filing document.
- `classifyEightKItem(item, text)` — per-item classification. Items 1.01,
  1.02, 1.03, 2.01, 2.03, 3.02, 5.07 classify from the item code alone;
  2.02, 5.02, 7.01, 8.01 additionally use keyword evidence.
- `classifyEightKDocument({text})` — all items in a document; an exhibits-only
  (Item 9.01) filing yields one explicit `not_material` event, never noise.
- `guidanceDirectionFromText(text)` — raised / maintained / lowered /
  withdrawn / new. Priority on ambiguity: withdrawn > lowered > raised >
  new > maintained.
- `classifyManagementEvent(text)` — Item 5.02; CEO/CFO role detection;
  departure beats appointment on ambiguity (a departure disclosed alongside a
  successor is still a leadership change).
- Item 8.01 cascade (first match wins): regulatory > guidance > management >
  capital allocation > competition > business > explicit `not_material`.
- `detectShareCountEvent({prevShares, currShares, periodEnd})` — ±2%
  quarter-over-quarter share-count delta ⇒ buyback (improving) / dilution
  (weakening); ±5% upgrades the severity to `material`.

Confidence heuristic (0–100, deterministic):

- 88 base for SEC 8-K primary documents (`primary_regulatory` source class),
  +4 with keyword corroboration (cap 95).
- 90 for explicitly dismissed routine items — we are confident they carry no
  thesis signal.
- 75 for share-count derivations (`derived_calculation` source class).
- 65 for uncatalogued 8-K items (surfaced for review, never silently dropped).
- 50 when filing text could not be fetched for a text-dependent item — the
  event is surfaced as `notable`/`monitor` for review, never dismissed.

## Worker (`scripts/ingest-company-events.mjs`)

Reads 8-K `filing_events` (provider `sec-submissions-monitor`), classifies new
items, inserts `company_change_events` rows with:

- `event_key` = `8k:{accession}:{item}` (filings) or `shares:{periodEnd}`
  (share count) — idempotent; re-runs insert nothing new.
- `confidence`, `knowledge_time` (when the world knew — the filing date),
  `disclosure_time` (when Solpient ingested — the detector run time).
- `affected_fact_id` — latest `normalized_facts` row for the company whose
  `metric_key` matches the category pattern (`AFFECTED_FACT_PATTERNS`); null
  when no fact matches.
- `evidence_payload` with the filing metadata and the exact matched keywords.
- `event_taxonomy = 'event-taxonomy-v1'`.

After each insert it calls the service-role-only RPC
`assess_company_event_materiality_v1` (Stage A). Usage:

```
node scripts/ingest-company-events.mjs [--ticker ADBE] [--limit 25] [--dry-run]
npm run events:ingest
npm run events:ingest:dry
```

The script refuses non-loopback Supabase URLs unless
`SOLPIENT_ALLOW_REMOTE_DB=1` is set.

## Scheduling (local stack, macOS launchd)

`scripts/run-v1-event-ingestion-worker.mjs` loads `.env.local`, takes a lock
(`.cache/v1-event-ingestion.lock`), and runs the ingestion with logging to
`.cache/v1-event-ingestion/worker.log`. Install the twice-daily schedule
(09:00 and 18:00 local — after the 08:15/17:15 SEC monitor runs):

```
npm run install:events:launchd
launchctl kickstart -k gui/$(id -u)/com.solpient.v1-event-ingestion  # run now
```

There is intentionally no hosted project-ref gate on this worker (that gate
belongs to the Group A production SEC worker); the loopback guard in the
ingestion script is the safety boundary.

## Stage A / Stage B materiality

- **Stage A** (`consumer_private.assess_company_event_materiality_v1`,
  methodology `group-b-event-materiality-v1`): deterministic mapping from the
  classified event (category, severity, confidence, decision impact) to a
  company-level severity. `not_material` rows are persisted as the explicit
  "reviewed and dismissed" audit trail.
- **Stage B** (`consumer_private.refresh_user_materiality_assessments_v1`,
  methodology `group-b-user-materiality-v2`): per-user, owner-scoped; reuses
  PR #137's position-weight-aware scoring (position weight, equal-weight
  fallback, neutral weight for followed companies). Runs lazily on What
  Matters reads and via the public wrapper `refresh_my_materiality_assessments_v1`.
- The B4 contract (`get_company_materiality_events_v1`) prefers persisted
  Stage A assessments and falls back to the legacy heuristic when none exist;
  `not_material` events are excluded from What Matters.

## Tests

- `supabase/tests/v1_event_ingestion.sql` — taxonomy seed (8 categories),
  FK rejection of unknown categories, confidence bounds,
  knowledge/disclosure ordering, guidance-cut event → Stage A → Stage B →
  What Matters, explicit `not_material`, user-assessment RLS isolation,
  evidence payload, methodology versions, service-role-only Stage A wrapper.
  Runs in CI (`clean-start-database.yml`).
- `scripts/test-event-detectors.mjs` — detector unit tests
  (`npm run test:event-detectors`).
- Existing `group_b4_company_materiality` and `v1_portfolio_own_follow`
  contract tests continue to pass unchanged.

## What's deliberately out of scope

- No LLM classification: keyword + item-code rules only, by design.
- No 10-K/10-Q deep parsing yet: periodic filings flow through the existing
  snapshot-diff engine; only 8-Ks and share-count derivations are new here.
- No cross-user or remote-DB operation: owner-scoped RLS everywhere new, and
  the worker refuses non-local Supabase URLs without an explicit override.
