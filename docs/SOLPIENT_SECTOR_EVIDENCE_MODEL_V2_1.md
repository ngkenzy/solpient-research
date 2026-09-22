# Solpient Sector Evidence Model V2.1

## Purpose

Sector Evidence Model V2.1 separates **broad quantitative merit** from **sector-specific evidence completeness**.

Sector Model V2 fixed the original bias that disadvantaged financial and real-estate companies, but full-universe validation showed a second problem: coarse SEC-derived proxies could produce near-100% screening coverage for industries whose decision-critical evidence was not actually present.

V2.1 therefore leaves the broad economic score intact while applying an evidence-confidence ceiling for sector-sensitive profiles.

A company can still score very highly on available SEC evidence. It cannot become a Solpient 100 Candidate solely because broad fields are complete when critical sector evidence is absent.

## Core rule

For each sector-sensitive profile:

1. Compute the existing technical screening coverage.
2. Reserve a portion of total evidence weight for sector-critical evidence.
3. Measure how much of that critical evidence is present.
4. Compute an evidence ceiling:
   
   `ceiling = 100 - reserved_weight + reserved_weight × critical_evidence_fraction`
5. Effective screening coverage is:
   
   `min(technical_coverage, evidence_ceiling)`

The broad screening score is not reduced simply because critical evidence is missing. Merit and evidence confidence remain separate.

## Sector-sensitive profiles

### Banks

40% of evidence completeness is reserved for:

- CET1 or reviewed regulatory capital
- net interest margin
- efficiency ratio
- non-performing assets / loans
- credit-loss / provision quality

With none of these fields present, maximum effective screening coverage is 60%.

### Insurance

40% is reserved for:

- combined ratio / underwriting profitability
- reserve development
- statutory capital / solvency
- premium growth quality
- catastrophe / concentration exposure

With none present, maximum effective screening coverage is 60%.

### Asset managers / brokers

35% is reserved for:

- AUM/AUA scale and trend
- organic net flows
- fee-rate trend
- client concentration
- market / performance-fee sensitivity

With none present, maximum effective screening coverage is 65%.

### Other financials

35% is reserved for:

- business-specific capital adequacy
- credit / receivables quality
- funding cost
- portfolio / receivables yield
- funding or customer concentration

### REITs

40% is reserved for:

- reviewed FFO/AFFO
- occupancy
- same-store NOI
- debt maturity schedule
- tenant / property concentration

The existing SEC-derived net-income + D&A proxy remains a broad screening input only and does not satisfy reviewed FFO/AFFO evidence.

### Other real estate

35% is reserved for:

- property-level economics
- occupancy / utilization
- debt maturity schedule
- reviewed NAV / property value
- tenant / property concentration

## Candidate behavior

The normal thresholds remain:

- Research Candidate: score >= 60, quality core >= 60, coverage >= 60
- Solpient 100 Candidate: score >= 75, quality core >= 72, coverage >= 70

Because banks, insurers and REITs with zero critical evidence are capped at 60% effective coverage, they can remain Research Candidates but cannot automatically become Solpient 100 Candidates.

This intentionally sends strong companies into the research funnel without overstating how much Solpient knows about them.

## Unknown classifications

Rows with an Unknown/unresolved sector classification:

- may remain Watch or Research Candidate
- cannot become Solpient 100 Candidate through automated screening
- must have sector classification repaired before promotion

Their effective evidence coverage is capped below the 70% Solpient 100 Candidate threshold.

Manual already-approved Solpient 100 membership remains a separate reviewed state and is not silently revoked by this screening rule.

## No sector quotas

V2.1 does not cap the number of banks, insurers, REITs, technology companies, or any other sector in the Top 100.

The model corrects evidence confidence, not portfolio composition.

If financial companies continue to dominate after sector-critical evidence is supplied, that is allowed to emerge from the methodology.

## Historical reproducibility

The prior engines remain frozen:

- `lib/universe-screening-engine-v1.mjs`
- `lib/universe-screening-engine-v2.mjs`
- `lib/research-candidate-pipeline-v1.mjs`
- `lib/research-candidate-pipeline-v2.mjs`

New runs use:

- `solpient-sector-evidence-model-v2.1`
- `solpient-universe-screen-v2.1`
- `solpient-100-selection-v2.1`
- `research-candidate-pipeline-v2.1`

Existing immutable V1/V2 screen runs are not rewritten.

## Audit output

Each V2.1 screening result preserves:

- raw technical evidence coverage
- sector-critical evidence coverage
- evidence coverage ceiling
- effective evidence coverage
- missing sector-critical evidence
- promotion blockers

These details are stored in immutable `score_detail` when a screen is materialized.
