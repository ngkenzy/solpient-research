# Read contract: company metrics tables (for the research-page worker)

This documents exactly what `scripts/backfill-company-metrics.mjs` writes, so the
research-page worker (Worker C) can read it without guessing.

## Tables used (all pre-existing — no new table was needed)

| Table | Row grain | Upsert key (unique constraint) |
|---|---|---|
| `public.market_snapshots` | one row per symbol per trading day per provider | `(symbol, trading_date, provider)` |
| `public.fundamental_snapshots` | one row per company per fiscal period per form per provider | `(company_id, period_end, form, provider)` |

`public.financial_metrics` is intentionally **not** used: it is keyed by
`research_run_id` (one row per published research run), not per company.

## Queries Worker C should use

Latest market row per company (TS):

```ts
const { data } = await supabase
  .from("market_snapshots")
  .select("*")
  .eq("symbol", ticker)
  .eq("provider", "yahoo-chart")
  .order("trading_date", { ascending: false })
  .limit(1)
  .maybeSingle();
```

Recent fundamental rows per company (note: mix of providers is possible; prefer
`sec_companyfacts` rows, fall back to `yahoo_fundamentals`):

```ts
const { data } = await supabase
  .from("fundamental_snapshots")
  .select("*")
  .eq("company_id", companyId)
  .order("period_end", { ascending: false })
  .limit(8);
```

## market_snapshots row contract

- `price`, `previous_close`, `volume`, `market_cap` (numeric; `market_cap` is
  `price ×` latest `shares_outstanding` from `fundamental_snapshots`, null when
  shares are unknown).
- `provider = 'yahoo-chart'`, `source_url` = the Yahoo chart v8 URL,
  `observed_at` = fetch time, `trading_date` = last valid daily session (YYYY-MM-DD).
- `raw_payload` (jsonb) **may** contain:
  - `dividend_yield_ttm` — TTM cash dividends from chart `events.dividends`
    divided by price, or Yahoo `meta.trailingAnnualDividendYield`; **null when
    not obtainable**.
  - `analyst_target` — `{ target, high, low }` from the Nasdaq quote/analyst API
    when obtainable, else **null**. Opportunistic only; never gate the page on it.
  - `currency`, `exchange_name`, `instrument_type` (Yahoo chart meta),
    `regular_market_price`, `provider`, `methodology_version`.
- Every row carries `raw_payload.methodology_version = 'metrics-v1'`.

## fundamental_snapshots row contract

- Columns: `revenue`, `net_income`, `operating_cash_flow`,
  `capital_expenditure` (negative), `free_cash_flow` (OCF − |capex|),
  `shares_outstanding`, `eps_diluted`, `period_end`, `fiscal_year`,
  `fiscal_period` (`Q1`/`Q2`/`Q3` for 10-Q, `Q4` for 10-K), `form` (`10-Q`/`10-K`),
  `filed_at`, `source_url`, `observed_at`.
- `provider = 'sec_companyfacts'` (SEC EDGAR companyfacts, preferred) or
  `'yahoo_fundamentals'` (Yahoo timeseries fallback, only when a CIK-mapped
  issuer has no SEC data; quality-gated).
- `raw_payload` carries income/cash-flow/balance-sheet detail from the source
  lib plus `methodology_version = 'metrics-v1'` (no dedicated column exists).

## Light tier (funds/ETFs/cash-like tickers)

`public.companies` has **no `holding_kind` column**, so light tier is defined as:
no resolvable SEC CIK **or** Yahoo `instrumentType` in
`ETF/MUTUALFUND/INDEX/CURRENCY/FUTURE/OPTION/CRYPTOCURRENCY`.
Light-tier tickers get **a market_snapshots price row only** — fundamentals are
never invented for them. Absence of `fundamental_snapshots` rows for a ticker is
therefore expected for light-tier holdings, not a data gap.

## Freshness semantics

- Backfill is idempotent (upserts on the unique keys); re-running is safe.
- Default run skips a company when its `yahoo-chart` row was observed < 12h ago
  **and** its `sec_companyfacts` rows were observed < 7 days ago. `--refresh`
  forces a full refetch.
- Runs are logged to `public.automation_runs` with
  `pipeline = 'company_metrics_backfill'` (skipped under `--dry-run`).
