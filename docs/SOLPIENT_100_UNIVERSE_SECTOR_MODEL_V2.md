# Solpient Universe Sector Model V2

## Purpose

Sector Model V2 makes the Solpient 100 broad-universe screen economically sector-aware without imposing sector quotas.

V1 proved the full SEC-first universe pipeline, but live full-universe validation exposed three structural weaknesses:

1. SIC 7000–8999 was often collapsed into a generic `Services` sector.
2. All financial companies shared a bank-like profile that expected CET1, efficiency, non-performing-assets and liquidity-coverage fields not produced by the SEC-first feed.
3. REITs expected AFFO/fixed-charge fields that the prototype feed did not calculate.

V2 fixes those issues by changing classification, screening profiles and available SEC-derived screening metrics. It does **not** guarantee that every sector will appear in the final Top 100, and it does not impose sector minimums or maximums.

## Taxonomy

The deterministic SIC/text classifier emits:

- Information Technology — software; technology hardware/semiconductors
- Communication Services
- Consumer Discretionary
- Consumer Staples
- Industrials
- Health Care — healthcare equipment/services; biopharma
- Financials — banks; insurance; asset managers/capital markets; diversified financials
- Real Estate — REITs; real-estate management/development
- Utilities
- Energy
- Materials
- Unknown

Every SEC-first row receives `screen_profile` and `sector_taxonomy_version=solpient-universe-sector-model-v2`.

## Sector-specific screening economics

### Banks

Corporate ROIC/net-debt/EBITDA are not used as core bank measures. V2 emphasizes SEC-derived:

- ROE
- ROA
- positive EPS history
- revenue consistency
- book-value growth
- equity/assets
- dilution
- trailing P/E
- price/book

`equity/assets` is explicitly a coarse screening capital proxy and is **not CET1**.

### Insurance

V2 emphasizes ROE, ROA, earnings durability, book-value growth, equity/assets, dilution, trailing P/E and price/book.

The screen does not pretend that equity/assets replaces statutory RBC or solvency review.

### Asset managers / brokers / diversified financials

The screen uses the financial profile appropriate to available evidence and ignores generic corporate leverage hard gates where balance-sheet structure is economically different.

### REIT / real estate

The SEC-first feed now derives a **screening FFO proxy**:

`net income + depreciation & amortization`

It is used only for broad screening and is labeled as a proxy. It is **not reviewed NAREIT FFO or AFFO** and cannot become authoritative research evidence by itself.

### Consumer / communication / technology

V2 removes the old catch-all `Services` bucket and separates communication services, consumer staples, consumer discretionary, software and technology hardware.

## No forced sector diversification

Solpient does not reserve slots by sector. Sector Model V2 is designed to make comparisons fairer, not to force the Top 100 to resemble an index.

Sector concentration remains a validation diagnostic.

## Historical reproducibility

The V1 engine is preserved at:

- `lib/universe-screening-engine-v1.mjs`
- `lib/research-candidate-pipeline-v1.mjs`

New runs use:

- `solpient-universe-screen-v2`
- `solpient-100-selection-v2`
- `research-candidate-pipeline-v2`

Existing immutable V1 screening runs are not rewritten.

## Downstream valuation safety

Sector-aware screening does not imply that Valuation V3 already has a safe model for every sector.

V2 therefore allows the existing bank valuation profile for banks, but blocks automatic generic corporate-FCF valuation for insurance, asset managers/diversified financials and real estate/REIT profiles unless a reviewed industry-specific Valuation V3 module is explicitly supplied.

This makes missing methodology visible instead of silently applying the wrong model.
