# SOLPIENT Research Standard v1

## Purpose

SOLPIENT Research Standard v1 defines the minimum evidence and decision structure required for a company to be considered fully researched. The goal is not to maximize the number of ratios. The goal is to make every conclusion reproducible, point-in-time, sourced, and comparable across research versions.

The governing question is:

> Why should this dollar leave the index?

## Research rules

1. Freeze the research date, data cutoff, market price, benchmark, source period, and source URLs.
2. Prefer primary sources. Clearly distinguish reported facts, derived metrics, estimates, assumptions, and assessments.
3. Never invent unavailable data. Record unavailable or not-applicable metrics explicitly.
4. Do not use universal thresholds when industry economics make them inappropriate. Compare the company with its own history, relevant peers, and the economics of its industry.
5. Scores summarize the research; they do not replace the evidence.
6. Every thesis must contain observable conditions and explicit breaker conditions.
7. Every material risk must include probability, severity, leading indicators, and evidence that would indicate permanent impairment.
8. Valuation must use scenario analysis and expose assumptions.
9. Expected return must identify the economic path to shareholder return rather than relying only on a single fair-value number.
10. Predictions are immutable once locked and are scored against subsequent reality.

## Standard layers

### 1. Business assessment

Required:
- business quality rating
- moat rating
- pricing power
- revenue model
- recurring revenue where relevant
- customer concentration
- geographic exposure
- market position
- growth runway
- cyclicality
- capital intensity
- AI opportunity
- AI threat
- management quality
- capital-allocation assessment
- bull thesis
- bear thesis
- biggest unknown
- capital-allocation test versus the benchmark

### 2. Universal metric ledger

Every metric observation records its value or explicit unavailable status, unit, period, basis, source, calculation method, and notes.

Required core:
- revenue growth
- gross margin
- operating margin
- net margin
- operating cash flow
- free cash flow
- FCF margin
- FCF per share
- FCF conversion
- cash
- total debt
- net debt
- shares outstanding
- forward P/E
- price/FCF
- FCF yield

Recommended when relevant:
- enterprise value
- EV/EBITDA
- ROIC
- five-year median ROIC
- incremental ROIC
- interest coverage
- share-count growth
- stock-based compensation
- SBC/revenue
- SBC/FCF
- capex/revenue
- organic growth

Industry modules add metrics rather than replacing the universal core.

#### Consumer / brand module

For branded consumer companies, SOLPIENT additionally requires:
- top-two brand revenue concentration
- direct-to-consumer revenue mix
- international revenue mix
- leading-brand growth
- second-brand growth
- direct-to-consumer growth
- international growth
- year-over-year inventory growth using comparable seasonal dates
- year-over-year share-count change
- buyback spend
- average buyback price
- stock-based compensation as a percent of revenue

Recommended supporting observations include brand-level gross margins, wholesale growth, domestic growth, buyback authorization, SBC/FCF, and inventory growth relative to revenue growth.

The module exists to answer whether brand strength is converting into disciplined inventory, full-price demand, channel quality, international expansion, and improving per-share ownership economics.

### 3. Valuation

Use methods appropriate to the business. Normally consider DCF, owner earnings / normalized FCF, earnings or FCF multiple, historical valuation, and peer valuation. Bear, base, and bull cases must expose major assumptions.

### 4. Expected return

SOLPIENT models 3-, 5-, and 10-year bear/base/bull cases. Where possible decompose returns into starting owner-earnings or FCF yield, business growth, margin change, share-count change, dividends, and valuation multiple change.

If a component cannot be supported, leave it null and state the limitation rather than filling it with a guess.

### 5. Thesis conditions

A thesis condition contains the expected state, current evidence, status, monitored metric where applicable, comparator/threshold where applicable, review frequency, and an explicit breaker condition.

### 6. Risk register

Each material risk contains category, probability, severity, leading indicators, thesis breaker, and supporting evidence/source.

### 7. Prediction readiness

A company becomes prediction-ready only after the baseline is complete enough to support immutable forecasts. Initial locked predictions should be few and measurable: revenue-growth range, FCF-margin range, thesis status, expected return range, and benchmark-outperformance probability.

## Completion rule

A v1 record is structurally valid only when all required sections and required metric records exist. A required metric may be marked unavailable, but unavailable data lowers evidence completeness. A record is marked complete when structural validation passes and at least 80% of required metrics are available or legitimately not applicable.

This allows SOLPIENT to distinguish missing research, explicitly unavailable evidence, and a complete defensible baseline.
