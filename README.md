# SOLPIENT Research

**See clearly. Invest deliberately.**

SOLPIENT Research is a point-in-time fundamental investment research system. It is designed to preserve what the research believed at each date, compare later evidence with prior assumptions, and build a durable historical research dataset.

## First milestone

ADBE → Research Version 1 → Supabase → public company page.

Then:

ADBE → Research Version 2 → preserve Version 1 → show what changed.

## Stack

- Next.js + TypeScript
- Supabase/PostgreSQL
- Vercel
- GitHub

Payments, analytics, email automation, and native mobile will be added only after the research workflow is working.

## Development

1. Copy `.env.example` to `.env.local`.
2. Add the Supabase project URL and publishable key locally.
3. Run the SQL migration in `supabase/migrations/0001_research_core.sql` against the Supabase project.
4. Install dependencies with `npm install`.
5. Start with `npm run dev`.

Never commit `.env.local` or service-role keys.


## Automated intelligence

SOLPIENT now includes an append-only intelligence pipeline:

- SEC 10-K, 10-Q, 8-K and Form 4 monitoring every six hours
- notable-manager 13F monitoring
- daily SEC XBRL fundamental snapshots
- daily end-of-day market snapshots for the tracked research universe plus SPY
- immutable prediction snapshots published with research versions
- automatic realized-outcome and prediction-error scoring when supported forecasts mature
- current valuation gaps use the latest stored market price while preserving the original research-date price

Database migrations `0004_intelligence_predictions.sql` and
`0005_automated_intelligence.sql` must be applied to the production Supabase
database before the new storage-backed automation jobs can write records.

Consensus-estimate and political-disclosure automation are intentionally provider
adapters rather than web scrapers. They should only be enabled when a stable,
licensed/reliable data source is configured.

## Money ticker bridge

`scripts/sync-money-tickers.mjs` syncs your solpient-money holdings tickers
into the research coverage universe (`public.companies`). The research app
needs to know *which* tickers you own so it can cover them; it never needs to
know how much of each you hold.

**Privacy boundary.** The script selects only four columns from the money
database — `ticker`, `name`, `holding_kind`, `sector`. Shares, prices, cost
basis and market values are never selected, never logged, and never leave the
money database.

**Behavior.** Reads distinct tickers from money `public.holdings`, inserts
tickers missing from research `public.companies`, and updates `company_name` /
`sector` (and `holding_kind` when that column exists — no migration needed) on
tickers that already exist. Never deletes. Idempotent: a second run changes
nothing. By default only `stock` and `etf` holdings are synced (`--all-kinds`
includes `bond`/`cash`).

**Usage.**

```bash
node scripts/sync-money-tickers.mjs --dry-run        # preview, writes nothing
node scripts/sync-money-tickers.mjs                  # sync for real
node scripts/sync-money-tickers.mjs --money-db <url> --research-db <url>
```

**Environment.**

| Variable | Purpose | Default / fallback |
|---|---|---|
| `MONEY_DATABASE_URL` | money Postgres connection string | `--money-db`, else `DATABASE_URL` from `MONEY_APP_DIR/.env.local` |
| `MONEY_APP_DIR` | solpient-money checkout dir (its `.env.local` holds `DATABASE_URL`, e.g. `postgresql://solpient:<password>@127.0.0.1:55433/solpient`) | — |
| `RESEARCH_DATABASE_URL` | research target: `postgres://` URL for direct Postgres, `https://` URL for Supabase REST | `--research-db`, else `SUPABASE_URL` |
| `RESEARCH_SERVICE_KEY` | service key for the Supabase REST target | `SUPABASE_SERVICE_ROLE_KEY`, else `SUPABASE_SECRET_KEY` |

The research target accepts either a `postgres://` URL (raw Postgres wire
protocol, zero npm dependencies — works against the local Docker Postgres,
any self-hosted Postgres, or a future self-owned research database) or an
`https://` Supabase URL (PostgREST via the existing `@supabase/supabase-js`
dependency, service-role key required since `public.companies` is
write-restricted). This is what lets the bridge survive the planned migration
from hosted Supabase to self-owned Postgres without code changes.

**Nightly sync on macOS (launchd).** Save as
`~/Library/LaunchAgents/com.solpient.money-ticker-bridge.plist`, then
`launchctl load ~/Library/LaunchAgents/com.solpient.money-ticker-bridge.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.solpient.money-ticker-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/&lt;you&gt;/path/to/solpient-research/scripts/sync-money-tickers.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MONEY_APP_DIR</key>
    <string>/Users/&lt;you&gt;/path/to/solpient-money</string>
    <key>RESEARCH_DATABASE_URL</key>
    <string>https://your-project.supabase.co</string>
    <key>RESEARCH_SERVICE_KEY</key>
    <string>your-service-role-key</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>3</integer>
    <key>Minute</key><integer>15</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/money-ticker-bridge.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/money-ticker-bridge.log</string>
</dict>
</plist>
```

Replace `/Users/&lt;you&gt;/path/to/...` with the real checkout paths, and prefer
`MONEY_APP_DIR` over embedding the money DB password in the plist — the script
reads `DATABASE_URL` from the money checkout's `.env.local` (mode `0600`).

**Tests.** `node scripts/test-sync-money-tickers.mjs` — no database needed.
Covers the mapping/upsert-decision logic, the money query's privacy boundary
(asserts value columns are never selected), Postgres URL parsing, the
SCRAM-SHA-256 math (RFC 5802 test vector), and the zero-dependency Postgres
wire client against a fake server (trust, MD5 and SCRAM auth paths plus error
propagation).
