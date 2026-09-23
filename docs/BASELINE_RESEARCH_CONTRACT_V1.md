# Baseline Research Contract V1

## Purpose

Baseline Research Contract V1 is the canonical boundary between Solpient's deterministic evidence systems and any AI research composer.

It does **not** replace:

- Research Standard V2
- Coverage V2
- Research Factory V1
- Phase 3 Decision Ranking
- the Research Candidate Pipeline
- the Solpient 100 / 20 / 5 list methodology

It packages those systems into one evidence-grounded input contract that can scale baseline analysis across all 100 governed companies.

## Operating model

```text
Solpient 100 member
  -> stored primary-source evidence
  -> Baseline Factory metrics
  -> Coverage V2
  -> sector evidence module
  -> reviewed valuation evidence when available
  -> Baseline Research Evidence Pack V1
  -> isolated AI composer
  -> Composer Output V1
  -> Contract validator
  -> Building or Baseline Ready
  -> existing Research Ready / Decision Ready gates
```

## Key rule

AI is a **composer**, not a calculator or source of record.

Every qualitative claim must cite at least one ID from the immutable evidence pack supplied to the composer.

If evidence is insufficient, the composer must return:

```json
{
  "status": "insufficient_evidence",
  "claims": [],
  "limitation": "What evidence is missing and why the section cannot be supported."
}
```

It must not infer or invent the missing conclusion.

## Evidence pack

`buildBaselineEvidencePack()` produces:

- company identity
- immutable Solpient membership context
- reviewed industry module
- universal Research Standard V2 metric coverage
- sector-specific metric coverage
- deterministic summary metrics
- valuation evidence that already exists
- normalized evidence items with stable IDs
- missing-evidence list
- baseline gate
- evidence-pack SHA-256 hash

The evidence-pack hash binds an AI composition to the exact evidence it saw.

## Baseline gate

The contract deliberately separates **composer allowed** from **public baseline ready**.

### Composer allowed

Requires:

- canonical company identity
- ticker
- at least one grounded evidence item

This permits private draft generation while research is still building.

### Public baseline ready

Requires:

- canonical company identity
- a reviewed industry module
- non-empty grounded evidence
- Coverage V2 status = `sufficient`
- all required sector-module metric records present

This is intentionally below Research Ready / Decision Ready, but still prevents weak or generic AI prose from being presented as a completed Solpient baseline.

Research Ready and Decision Ready remain controlled by the existing Phase 3 / candidate-pipeline methodology.

## Composer output

Every section must have this shape:

```json
{
  "status": "supported",
  "claims": [
    {
      "text": "A concise analytical statement.",
      "evidence_refs": ["metric:universal:operating_margin:2026-06-30"]
    }
  ],
  "limitation": null
}
```

or explicitly declare insufficient evidence.

Canonical sections:

1. company_overview
2. revenue_model
3. customer_characteristics
4. competitive_position
5. moat_evidence
6. pricing_power
7. growth_drivers
8. major_risks
9. ai_opportunities
10. ai_disruption_risks
11. management_observations
12. capital_allocation_observations
13. bull_thesis
14. bear_thesis
15. biggest_unknowns

For a public baseline, these core sections must be supported:

- company_overview
- revenue_model
- competitive_position
- growth_drivers
- major_risks
- bull_thesis
- bear_thesis
- biggest_unknowns

Other sections may explicitly say evidence is insufficient.

## State model

```text
blocked
  -> building
  -> baseline_ready
  -> research_ready
  -> decision_ready
```

Baseline Contract V1 may only determine `blocked`, `building`, or `baseline_ready`.

It never promotes a company to Research Ready or Decision Ready. Those states remain authoritative from the existing governed pipeline.

## Sector behavior

The contract reuses `INDUSTRY_MODULES`.

A company without a reviewed industry module can still receive a private Building-stage composition, but cannot become public-baseline-ready from generic metrics alone.

This is important for sectors such as REITs, insurers, energy, and other cases where a generic corporate metric set may be economically misleading.

## Integration with Grok

Grok's composer should:

- accept the evidence pack as input
- return only Composer Output V1
- never query or write Solpient databases
- never calculate or overwrite supplied deterministic metrics
- never change ranking, readiness, or membership
- cite evidence IDs on every claim
- declare insufficient evidence instead of filling gaps with plausible prose

ChatGPT's canonical factory will validate the output before any persistence or public display.

## No database migration

V1 introduces no new database tables or columns.

It is designed to plug into existing:

- `baseline_drafts`
- `data_coverage_reports`
- `research_compositions`
- `research_factory_items`
- `research_factory_events`

A persistence migration should be added only after the 5-company proof confirms the contract shape is stable.

## Validation cohort

The contract tests five deliberately different cases:

- ADBE / software
- PFE / biopharma with missing critical sector evidence
- JPM / bank
- XOM / explicit generic operating-company assignment
- AMT / unreviewed REIT-like sector assignment

The AMT case is intentionally blocked from public baseline readiness. This catches the exact failure mode where generic metrics masquerade as sector-aware research.


## Local commands

Run the deterministic contract tests:

```bash
npm run test:baseline-contract
```

Build a five-name proof evidence-pack set from local PostgreSQL:

```bash
npm run baseline:packs:proof
```

Build packs for the full governed Solpient 100:

```bash
npm run baseline:packs
```

Generated files are local-only:

```text
data/baseline-research/index.json
data/baseline-research/packs/<TICKER>.json
```

The pack builder performs **no AI calls and no database writes**. It reads the latest complete 100-member candidate snapshot and existing Solpient evidence, then materializes hashed composer inputs on the local machine.
