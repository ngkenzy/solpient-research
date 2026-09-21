# SEC-first U.S. Universe Feed V1

Solpient can build its first real U.S. broad-market research funnel without a paid fundamentals provider.

## Architecture

```
SEC companyfacts.zip + submissions.zip + ticker/exchange mapping
→ existing Solpient SEC normalizer
→ Solpient-computed screening fundamentals
→ cached Yahoo chart enrichment (temporary prototype market source)
→ existing Solpient 100 screen
→ Valuation V3
→ Research Candidate Pipeline
→ Readiness
→ Ask Solpient
```

The EODHD adapter remains in the repository as an optional future provider.

## SEC inputs

The SEC publishes:

- `companyfacts.zip` — bulk XBRL company facts
- `submissions.zip` — bulk submissions metadata
- `company_tickers_exchange.json` — CIK/ticker/exchange associations

The bulk archives are rebuilt nightly by the SEC.

Universe Feed V1 uses Nasdaq, NYSE and NYSE American by default.

## Stage 1 — fundamentals

Set an SEC-compliant contact identity:

```bash
export SEC_CONTACT="you@example.com"
```

Build the cached fundamental universe:

```bash
node scripts/build-sec-universe-fundamentals.mjs \
  --output=data/universe/sec-us-fundamentals.json
```

The script downloads the bulk archives once into `.cache/sec-universe`, extracts them, reuses the existing `normalizeCompanyFacts()` logic, and calculates screening fields such as:

- ROIC when SEC tax/pre-tax facts support it
- ROE
- FCF margin
- cash conversion
- operating margin
- positive FCF/EPS years
- revenue consistency
- margin volatility
- three-year share dilution
- net debt / EBITDA when D&A is available
- debt/equity
- interest coverage
- current ratio
- three-year revenue/EPS/FCF CAGR

Missing evidence remains null.

Use `--refresh` to redownload the nightly archives and `--max-symbols=100` for a small development run.

The local machine must have the standard `unzip` command available.

## Stage 2 — prototype market enrichment

The SEC does not publish daily prices or trading volume. For the prototype, Solpient reuses the same Yahoo chart path already used by `sync-market-history.mjs`.

```bash
node scripts/enrich-sec-universe-market.mjs \
  --input=data/universe/sec-us-fundamentals.json \
  --output=data/universe/sec-us-screening.json
```

This stage is resumable. Individual chart responses are cached in `.cache/yahoo-universe`.

It calculates:

- latest price
- average dollar volume from the latest 30 valid sessions
- approximate market cap = latest SEC shares × latest close
- P/FCF
- FCF yield
- EV/EBITDA when the SEC facts support EBITDA

If fewer than 20 sessions are available, liquidity remains null and the existing Solpient investability gate fails closed.

Yahoo is explicitly tagged as a temporary prototype market source. A commercial Solpient product should replace it with a licensed market-data source.

## Stage 3 — screen

First run dry:

```bash
node scripts/run-universe-screen.mjs \
  --input=data/universe/sec-us-screening.json \
  --limit=100 \
  --dry-run
```

Review exclusions, evidence coverage, sector/profile mapping and the highest-ranked companies before materializing an immutable screen.

## Important limitations

SEC filing data is primary-source but heterogeneous. Not every filer uses the same tags, and banks, REITs and pre-revenue companies need sector-specific evidence that may not be fully represented in V1.

Forward P/E and PEG are intentionally not fabricated from SEC filings.

The SEC ticker/exchange association files are useful for search and ingestion but the SEC does not guarantee complete accuracy or scope.

V1 is U.S.-only. Global screening should wait for FX normalization and duplicate-listing/ADR resolution.
