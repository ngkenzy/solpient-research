# Daily reliability (extracted ideas only)

The Mac stash Local Update Engine was not available in this environment.
These helpers capture the *useful* ideas that #99/#102/#103 do not already own:

- per-ticker failure journal from the market-sync artifact
- retry only those tickers (`scripts/retry-failed-tickers.mjs`)
- step checkpoint so an interrupted daily run can resume with existing `--skip-*` flags

Already owned by ChatGPT / #103 and **not** rebuilt here:

- process lock + stale lock recovery
- scheduler lock
- fail-closed 20/5
- canonical `npm run local:daily`

Still retired:

- `local-update-engine.mjs` orchestrator
- `app/api/local-update/`
- any second ranking / score

Commands:

```bash
node scripts/test-daily-reliability.mjs
node scripts/retry-failed-tickers.mjs --dry-run
```

ChatGPT hook: after `sync-market-history` in `run-solpient-daily.mjs`, call `writeFailureJournal(extractFailedTickers(marketSummary))` and `writeCheckpoint('market_refresh')`. Do not add a second daily command.
