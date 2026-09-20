# SOLPIENT Baseline Factory v1

## Purpose

Baseline Factory v1 converts Solpient's stored point-in-time market, fundamental and filing evidence into a private Research Standard v1 **draft**.

It never publishes research automatically.

## Flow

1. Resolve the tracked company and assigned industry module.
2. Select the strongest stored fundamental observation for each period using provider priority.
3. Build a trailing-four-quarter evidence window when four quarterly periods exist.
4. Calculate defensible universal metrics from stored observations.
5. Add the required industry-module metric records.
6. Mark unsupported metrics explicitly as unavailable.
7. Sanitize provider URLs so credentials never enter drafts.
8. Attach filing and market provenance.
9. Run Research Standard v1 validation.
10. Store the result in the private `baseline_drafts` table and emit a review artifact.

## Promotion rule

A Baseline Factory draft is not a research run. It does not affect rankings and it cannot create a prediction.

Promotion requires a separate review step that completes:
- business-quality assessment
- primary-source verification for material evidence
- missing industry evidence
- valuation and expected-return scenarios
- risk register
- thesis conditions and breakers
- final scoring

Only a reviewed package that passes Research Standard v1 may be sent through the existing research importer.

## Current deterministic calculations

When source data supports them, the factory calculates:
- year-over-year revenue growth for a comparable quarter
- gross, operating and net margins
- TTM operating cash flow and free cash flow
- TTM FCF margin and FCF conversion
- FCF per share
- FCF yield and price/FCF
- share-count change
- stock-based compensation ratios
- capex intensity
- interest coverage
- R&D intensity

The factory deliberately does not infer unsupported items such as ROIC, organic growth, forward consensus valuation, customer concentration, moat strength or thesis breakers.

## Industry assignment

All 22 tracked companies have an initial module assignment. These assignments are architecture, not a claim that every module is complete. Missing module evidence lowers draft completeness and stays visible in review.

## First pilot

MSFT is the first factory-generated pilot because Solpient already stores five quarterly fundamental snapshots and a current market snapshot for Microsoft.
