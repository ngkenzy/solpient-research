# Data Engine Control Center

Route: `/data-engine`
Branch intent: SuperGrok UI/ops module. ChatGPT owns the ranking engine.

## Local

```bash
npm install
npm run dev
# open http://localhost:3000/data-engine
node scripts/test-data-engine.mjs
```

No new GitHub Actions. No ranking migrations.

## Adapter

`lib/data-engine/store.ts` currently re-exports the mock snapshot.

`adapter: "mock_pending_chatgpt_engine"`

Solpient 20 and 5 render as **0** until ChatGPT implements `getDataEngineSnapshot()` against real `ranking_runs`.

## ChatGPT integration contract

Replace `lib/data-engine/mock-snapshot.ts` usage in `store.ts` with a Postgres reader that returns `DataEngineSnapshot` from `lib/data-engine/types.ts`.

Required fields: `health`, `universe`, `ranking`, `freshness`, `latestRun`, `history`, attention queues.

Rules the UI already encodes:

- partial/failed run `authoritative: false`
- yesterday's successful run remains live
- operator buttons return `{ ok: false, reason: "pending_chatgpt_engine..." }` until you bind `solpient:daily` / local SEC / price scripts

Do not infer 20/5 from `screen_score`.


## ChatGPT integration

When `SOLPIENT_DATABASE_URL` is configured, `getDataEngineSnapshot()` reads real local PostgreSQL state from the existing immutable/audited ledgers:

- `universe_screen_runs`
- `research_candidate_pipeline_runs/items`
- successful `solpient_list_refresh` records in `automation_runs`
- `solpient_daily` orchestration history
- market/fundamental snapshots
- research repair jobs
- review drafts
- company change events

The Data Engine does not calculate a second ranking. Solpient 20/5 are read from the latest successful audited list-refresh snapshot produced by the ranking engine. If that snapshot does not exist, 20/5 remain zero.

Operator buttons remain non-destructive/manual in V1. They show the exact local command to run instead of spawning long-lived workers from a web request.
