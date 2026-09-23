# Solpient 100 Autonomous Baseline Research Factory V1

## Purpose

This is the completion loop that turns the governed Solpient 100 from a ranked list into a research universe where every company has at least an evidence-grounded baseline analysis.

It is a control layer over existing Solpient workers. It is not a second research pipeline.

## Canonical architecture

```text
Immutable Solpient 100
  -> Research Factory V1 identity records
  -> Baseline Factory V1 planner
     -> existing industry assignment worker
     -> existing SEC Companyfacts worker
     -> existing Yahoo fallback worker
     -> existing market-history worker
     -> existing historical/peer engine
     -> existing Baseline Factory V2
     -> existing Coverage V2
     -> existing valuation-evidence worker
  -> Baseline Research Evidence Pack V1
  -> Baseline Research Composer V1
  -> canonical validator
  -> private research_compositions
  -> existing /research/<TICKER> page
```

Published research remains authoritative. The baseline factory never replaces or auto-publishes a published research run.

## Baseline completion

A company is complete for this factory when canonical identity exists, no baseline repair step remains, and the latest Baseline Research Composer V1 output is structurally valid and bound to the latest baseline draft.

Baseline completion does not mean Research Ready or Decision Ready. A completed baseline may still display Research Building while richer sector, valuation, peer, management, or qualitative evidence is incomplete.

## Incremental behavior

The planner checks identity, industry assignment, SEC and total fundamental coverage, market-history depth, historical/peer context freshness, baseline draft freshness, Coverage V2 freshness, valuation-evidence freshness, and baseline-composition persistence.

Newer evidence invalidates dependent work. For example, new SEC facts can make historical context, baseline, coverage, and composition stale. A new reviewed sector module makes the sector-specific baseline and composition stale.

## Sector expansion

V1 adds deterministic baseline modules for energy_integrated, real_estate_reit, financial_insurance, and financial_services. This allows energy, REIT, insurance, and diversified-financial names to receive sector-aware baseline evidence rather than remaining unsupported by policy.

These are baseline modules, not a claim that generic accounting metrics are sufficient for full decision-grade analysis.

## Integrity behavior

- Latest governed candidate run must contain exactly 100 members.
- Identity failures fail closed.
- Solpient 100 membership is never padded or replaced.
- Published research is never overwritten.
- No automatic research publication.
- No new database schema.
- Existing pipeline lock prevents concurrent baseline writers.
- Provider failures are isolated by ticker where possible.
- Final batch reports partial or failed if selected companies still lack a valid baseline.

## Commands

Run deterministic unit tests:

```bash
npm run test:baseline-factory100
```

Inspect the plan without writing:

```bash
npm run baseline:factory:plan
```

Process the next five incomplete names:

```bash
npm run baseline:factory
```

Process JPM only:

```bash
node scripts/with-pipeline-lock.mjs --lock=baseline_research.lock -- node scripts/run-solpient-100-baseline-factory-v1.mjs --ticker=JPM
```

Process the whole remaining universe after smaller batches are proven:

```bash
npm run baseline:factory:all
```

## Recommended rollout

1. Unit tests.
2. Dry-run plan.
3. Run JPM only.
4. Inspect /research/JPM.
5. Run the next five incomplete names.
6. Repeat five at a time.
7. Use baseline:factory:all only after several clean batches.

## Local artifacts

```text
data/baseline-research/factory-runs/latest.json
data/baseline-research/factory-runs/solpient-100-baseline-<timestamp>.json
data/baseline-research/packs/<TICKER>.json
data/baseline-research/compositions/<TICKER>.json
```

These are operational artifacts. PostgreSQL remains the application source of truth for persisted research state.
