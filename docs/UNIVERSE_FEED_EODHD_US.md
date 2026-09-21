# Universe Feed V1 — EODHD US

## Purpose

This adapter creates the provider-normalized JSON consumed by:

```
scripts/run-universe-screen.mjs
```

It is deliberately **US-only in V1**.

EODHD global market-cap values are denominated in each listing's local currency. Solpient must not rank a Vietnamese, Japanese, British and U.S. market capitalization as though the raw numbers were directly comparable. Global coverage belongs in Universe Feed V2 after FX-normalized market-cap and liquidity semantics are defined.

## Data flow

```
EODHD extended bulk EOD (US)
        ↓
latest price + market cap + instrument identity
        ↓
30 distinct EOD bulk sessions
        ↓
exact average daily dollar volume
        ↓
EODHD bulk fundamentals v1.2
        ↓
Solpient provider normalizer
        ↓
provider-normalized universe JSON
        ↓
Solpient 100 Universe Screening V1
```

## Run

Set:

```bash
export EODHD_API_TOKEN="..."
```

Then:

```bash
node scripts/build-eodhd-universe-feed.mjs \
  --exchange=US \
  --output=data/universe/eodhd-us.json
```

Preview a small fetch during development:

```bash
node scripts/build-eodhd-universe-feed.mjs --exchange=US --max-symbols=100 --dry-run
```

Then screen without writing to Supabase:

```bash
node scripts/run-universe-screen.mjs \
  --input=data/universe/eodhd-us.json \
  --limit=100 \
  --dry-run
```

Only after reviewing the output should the existing universe materializer be run without `--dry-run`.

## Fail-closed behavior

Missing provider fields remain null.

The adapter does **not** manufacture neutral values.

A 30-session dollar-liquidity value is populated only with at least 20 observed sessions. Sparse listings therefore fail the current investability gate rather than receiving a guessed liquidity value.

## Initial mapped dimensions

The adapter attempts to supply:

- price
- market capitalization
- 30-session average dollar volume
- sector / industry
- ROE / ROIC
- FCF margin
- operating margin
- cash conversion
- five-year positive FCF / EPS history
- revenue consistency
- operating-margin volatility
- three-year share dilution
- leverage / interest coverage / current ratio
- three-year revenue / EPS / FCF CAGR
- price / FCF
- FCF yield
- forward P/E
- EV / EBITDA
- PEG

Unavailable data remains unavailable and reduces evidence coverage in the Solpient 100 engine.

## Licensing

This code is provider-agnostic at the Solpient screening boundary, but this particular adapter uses EODHD. Verify that the selected EODHD plan and data-services agreement permit the intended Solpient use before displaying or redistributing provider-derived data in a commercial product.

The adapter can be replaced later without changing the Solpient 100 screening contract.
