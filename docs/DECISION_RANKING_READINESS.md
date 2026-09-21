# Solpient 100 Phase 3 — Decision Ranking + Readiness

## Purpose

Phase 3 separates three questions that were previously collapsed into a single legacy `overall_score`:

1. **Business Quality** — how strong is the underlying business?
2. **Investment Opportunity** — how attractive is the stock at today's price?
3. **Evidence Confidence** — how much should Solpient trust the first two dimensions?

These dimensions are intentionally distinct.

Evidence Confidence does **not** become investment merit. A company can be a strong business and attractive opportunity while still remaining **Building** because the evidence package is incomplete.

## Ranking contract

Phase 3 ranking order is:

1. Readiness tier
   - Decision Ready
   - Research Ready
   - Building
2. Decision Score
3. Evidence Confidence
4. Business Quality
5. Ticker, for deterministic final tie-breaking

The legacy published-research `overall_score` remains stored in `ranking_history.overall_score` for historical compatibility, but it no longer determines Phase 3 rank order.

## Business Quality

Business Quality uses reviewed/published score dimensions:

| Component | Weight |
| --- | ---: |
| quality_score | 55% |
| moat_score | 30% |
| financial_strength_score | 15% |

Missing values are **not** filled with 50.

The score is calculated over available components, while `business_quality_coverage_pct` records how much of the intended model was actually available.

Example:

- Quality = 85
- Financial strength = 85
- Moat = unavailable

Business Quality remains 85, but component coverage is only 70%.

This preserves the difference between:

> “The evidence we have looks strong.”

and

> “We have complete evidence that the business is strong.”

## Investment Opportunity

Investment Opportunity evaluates the stock rather than the business:

| Component | Weight |
| --- | ---: |
| 5Y base expected CAGR | 35% |
| Price vs base fair value | 30% |
| Margin-of-safety position | 20% |
| Bear-case downside protection | 15% |

Missing components reduce `opportunity_coverage_pct`; they are never assigned a neutral value.

### Expected-return normalization

- -5% CAGR or worse → 0
- +15% CAGR or better → 100
- values between those points scale linearly

This is a ranking normalization rule, not a return forecast.

### Valuation-gap normalization

- 50% above base fair value → 0
- at base fair value → 50
- 50% below base fair value → 100

### Margin-of-safety normalization

- at/below 35% MOS price → 100
- at/below 25% MOS price → 85
- at/below base fair value → 65
- above base but at/below bull fair value → 35
- above bull fair value → 10

### Downside protection

Bear-case fair value relative to current price is converted to a bounded 0–100 score.

## Evidence Confidence

Evidence Confidence uses explicit coverage layers:

| Coverage layer | Weight |
| --- | ---: |
| Fundamentals | 12% |
| Balance sheet | 7% |
| Financial history | 12% |
| Market history | 5% |
| Valuation history | 12% |
| Capital allocation | 10% |
| Peers | 10% |
| Industry evidence | 8% |
| Consensus | 4% |
| Research structure | 10% |
| Primary-source share | 10% |

Research freshness is then blended:

- 90% evidence coverage score
- 10% freshness score

Freshness cannot rescue missing evidence.

Phase 2 provenance confidence is deliberately **not fabricated** in this branch. The frozen score input records `provenanceConfidence: null`. Once Phase 2 merges, a later methodology version can incorporate provenance without silently changing historical Phase 3 snapshots.

## Decision Score

The attractiveness score is:

```
Decision Score =
  40% Business Quality
+ 60% Investment Opportunity
```

Evidence Confidence is not multiplied into this score.

Instead, confidence controls **readiness**.

This prevents a well-documented mediocre investment from appearing economically superior merely because it has more data.

## Readiness states

### Building

Used when core research evidence is still insufficient.

Typical blockers include:

- Business Quality unavailable
- Business Quality component coverage below 55%
- Investment Opportunity unavailable
- Opportunity component coverage below 60%
- Evidence Confidence below 60%
- Current price unavailable
- Base fair value unavailable
- Research structure below 80%
- Fundamentals below 70%
- History below 60%

### Research Ready

The research package is coherent enough to compare and study, but does not yet meet the stricter Decision Ready evidence standard.

### Decision Ready

Requires all of the following:

- Evidence Confidence >= 85%
- Business Quality component coverage >= 70%
- Investment Opportunity component coverage >= 80%
- Research structure >= 90%
- Fundamentals >= 85%
- Financial history >= 80%
- Valuation history >= 60%
- Capital-allocation history >= 50%
- Peer coverage >= 50%
- 5Y base expected return available
- Current market price available
- Base fair value available

A Decision Ready label means:

> Solpient considers the research evidence sufficiently complete for a decision-grade comparison.

It does **not** mean “Buy.”

## Historical behavior

Phase 3 extends the existing immutable `ranking_history` table instead of creating a duplicate ranking ledger.

Each new ranking snapshot stores:

- Business Quality score
- Business Quality component coverage
- Investment Opportunity score
- Opportunity component coverage
- Evidence Confidence score
- Evidence component coverage
- Decision Score
- Readiness state/tier
- Ranking methodology version
- Readiness methodology version
- frozen scoring inputs
- frozen readiness reasons
- Phase 1 integrity hash

Old ranking rows remain untouched.

## Ranking explanations

Ranking explanations now distinguish changes in:

- readiness
- Decision Score
- Business Quality
- Investment Opportunity
- Evidence Confidence
- market price
- valuation gap
- relative rank

This is intended to answer:

> Why did the company move?

without hiding all movement behind a single overall-score delta.

## Phase 2 compatibility

Phase 3 is intentionally independent of the Phase 2 branch.

It does not modify:

- evidence provenance schema
- temporal research readers
- publication RPC
- research page historical-cutoff components
- Phase 2 migration files

Once Phase 2 merges, Evidence Confidence can add provenance-specific inputs only through a new ranking methodology version. Existing Phase 3 snapshots remain unchanged.

## Solpient 100 relationship

Phase 3 does **not** select the Solpient 100 universe.

It ranks the currently published research universe.

Future universe selection should remain separate:

```
Large investable universe
→ screening
→ research candidates
→ Solpient 100 membership

Solpient 100
→ Business Quality
→ Investment Opportunity
→ Evidence Confidence
→ Readiness
→ current decision ranking
```

A company can remain a Solpient 100 member while temporarily ranking poorly as an investment opportunity.
