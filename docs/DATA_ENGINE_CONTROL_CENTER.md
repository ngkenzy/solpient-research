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
