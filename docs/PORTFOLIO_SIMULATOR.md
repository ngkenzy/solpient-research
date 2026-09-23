# Portfolio / Capital Allocation Simulator V1

## Purpose

The simulator answers:

> What changes in the portfolio if I change dollar allocations before actually moving capital?

It is a planning and comparison engine. It does not execute trades, publish research, or alter Solpient historical records.

## Inputs

Each simulated position can carry:

- ticker and company name
- sector / industry group
- current market value
- Decision Readiness state
- Decision Score
- Business Quality score
- Investment Opportunity score
- Evidence Confidence score
- 5-year base expected CAGR
- current market price
- bear / base / bull fair values

The review workbench hydrates these research fields from the latest Solpient ranking snapshot. The user enters only current dollar holdings, cash, proposed dollar trades, and optional planning constraints.

## No unresearched additions

A new simulated holding cannot be added unless candidate research metadata is supplied for that ticker.

The internal workbench therefore limits additions to companies already present in Solpient's latest ranking snapshot.

## Portfolio metrics

V1 calculates:

- total value
- invested value
- cash value and cash weight
- position count
- single-position concentration
- top-three concentration
- invested-capital concentration HHI
- effective number of invested positions
- group / sector exposure
- Building / Research Ready / Decision Ready exposure
- value-weighted Decision Score
- value-weighted Business Quality
- value-weighted Investment Opportunity
- value-weighted Evidence Confidence
- value-weighted 5-year base expected CAGR

Missing research metrics are never filled with neutral values.

Each weighted metric carries explicit coverage.

## Expected-return rule

`portfolio_base_5y_cagr` is shown only when **100% of invested capital** has a 5-year base expected-return estimate.

This prevents a portfolio with missing return estimates from being presented with a precise portfolio CAGR.

Cash return defaults to 0% unless explicitly supplied by the caller.

## Fair-value marks

Bear, base, and bull values are treated as **valuation marks**, not timing forecasts.

For a covered position:

`marked value = current position value × stored fair value / current share price`

Uncovered positions remain at current market value and reduce mark coverage.

The output explicitly states that these scenarios do not predict when a market price will reach fair value.

## Exposure denominators

- Position weights and top-three concentration use total portfolio value, including cash.
- Sector / industry-group exposure uses invested capital only.
- Decision-readiness exposure uses invested capital only.
- HHI / effective-position calculations use invested capital only.

This prevents a large cash balance from making a 100%-of-invested-capital sector concentration look diversified.

## Trade simulation

Trades are dollar changes:

- positive amount = simulated purchase
- negative amount = simulated sale

V1 rejects:

- selling more than the current simulated position
- purchases that exceed available cash
- new positions with no candidate research metadata

No margin or short selling is assumed.

## Guardrails

Default planning guardrails are intentionally configurable and are **not universal investment rules**:

- maximum single position: 25% of total portfolio
- maximum group exposure: 40% of invested capital
- minimum cash: 5% of total portfolio
- maximum Building exposure: 10% of invested capital
- minimum Decision Ready exposure: 50% of invested capital
- minimum value-weighted Evidence Confidence: 65

The workbench lets the reviewer change every limit.

The engine reports individual passes/breaches rather than reducing portfolio quality to one opaque recommendation score.

## Workbench

Authenticated route:

`/review/portfolio-simulator`

The page reads:

- latest `ranking_history` snapshot
- related `valuations`
- 5-year base `expected_return_scenarios`
- latest research industry module for grouping

It performs no database writes.

## CLI

Run a JSON scenario locally:

`node scripts/simulate-portfolio.mjs --input=scripts/fixtures/portfolio-simulator-sample.json`

The JSON can contain either:

- a portfolio only, for current-state analysis
- a portfolio plus trades, for one what-if scenario
- multiple scenarios, for side-by-side comparison output

## Phase 2 isolation

V1 adds no database schema and does not touch provenance, temporal readers, publication, or research composition.

After Phase 2 stabilizes, provenance confidence may be added as another portfolio research-quality dimension in a future methodology version rather than changing V1 silently.