# Solpient Sector Classification Repair V2.2

## Purpose

V2.2 repairs unresolved or economically misleading sector classifications without destabilizing the successful Sector Model V2 taxonomy.

The full-universe V2.1 validation showed that evidence confidence was behaving correctly, but a small set of companies remained `Unknown/general`. Sector Classification Repair V2.2 addresses that classification hygiene problem only.

## Classification hierarchy

The live classifier uses this deterministic order:

1. **Reviewed issuer override**
2. **Targeted SIC repair rule**
3. **Targeted SIC-description repair rule**
4. **Sector Model V2 base classification**
5. **Existing non-Unknown provider classification** when no usable SEC classification exists
6. **Unresolved / Unknown**

The hierarchy is intentionally narrow. V2.2 does not introduce broad speculative mappings simply to eliminate every Unknown row.

## Reviewed issuer overrides

Initial reviewed overrides:

- **AWI — Armstrong World Industries** → Industrials / Building Products / `industrial`
- **LOPE — Grand Canyon Education** → Consumer Discretionary / Education Services / `consumer_discretionary`
- **YELP — Yelp** → Communication Services / Interactive Media & Services / `communication`

Each override records method, rule, confidence, and rationale in the screening result.

## Targeted SIC repair

V2.2 adds SIC 8200–8299 as Education Services under Consumer Discretionary.

This is a narrow repair for a known taxonomy gap rather than a wholesale remapping of the SIC system.

## Description repair

Targeted description rules cover:

- education services
- interactive media / online reviews / local discovery
- building products / ceiling / wall / architectural products

Description rules are lower confidence than reviewed issuer overrides and explicit SIC rules.

## Auditability

Every classification emits:

- `sector_classification_method`
- `sector_classification_rule`
- `sector_classification_confidence`
- optional `sector_classification_rationale`

The audit command:

```bash
node scripts/audit-sector-classification.mjs \
  --input=data/universe/sec-us-screening-full-v2.json
```

reports method counts, repaired names, changed classifications, and all unresolved names.

## Historical reproducibility

V2.1 screening and candidate-pipeline code are frozen in versioned files. New live runs use:

- `solpient-universe-sector-model-v2.2`
- `solpient-universe-screen-v2.2`
- `solpient-100-selection-v2.2`
- `research-candidate-pipeline-v2.2`

Sector Evidence Model V2.1 remains unchanged.

Existing V1, V2 and V2.1 immutable runs are not rewritten.

## Non-goals

V2.2 does not:

- change score thresholds
- change sector evidence ceilings
- change financial scoring
- impose sector quotas
- automatically approve Solpient 100 membership
- guess classifications for unresolved issuers without defensible rules
