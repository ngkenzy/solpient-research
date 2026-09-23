# Local Update Engine reconciliation

Base: `data-engine-ranking-integration` (PR #102).
Does not change `lib/solpient-list-engine.mjs` or ranking writers.

## Verdict (stash files were not in GitHub)

The named Local Update Engine files exist only on the Mac stash, not on this branch. Do not `git stash pop` them onto #99/#102.

| Stash path | Decision |
| --- | --- |
| `scripts/local-update-engine.mjs` | **Retire.** Duplicates `scripts/run-solpient-daily.mjs`. |
| `lib/local-update-plan.mjs` | **Retire** as an orchestrator. |
| `scripts/local-materialize-research-candidate-pipeline-v2-4.mjs` | **Do not restore as daily.** Governed only. |
| `app/api/local-update/` | **Do not restore.** Next.js must not spawn long pipelines. |
| `data/universe/` | Cache only. Not a membership source. |
| `tsconfig.json` / `next-env.d.ts` / `.next` | Ignore. |

## Cadence

```text
npm run local:daily          # lock → market 100 → Phase 3 → 20/5
node scripts/run-solpient-governed.mjs --dry-run
```

Concurrent daily runs exit 2 (`pipeline_locked`).

## Commands

```bash
git checkout feat/local-update-reconcile
node scripts/test-local-update-reconcile.mjs
npm run local:daily:dry-run
node scripts/run-solpient-governed.mjs --dry-run
node scripts/with-pipeline-lock.mjs --lock=solpient_daily.lock -- node scripts/run-solpient-daily.mjs --dry-run
```
