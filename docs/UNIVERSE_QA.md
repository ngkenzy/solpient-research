# Universe QA / Screening Audit Console V1

## Purpose

Universe QA V1 is a read-only audit layer between provider normalization and immutable universe-screen materialization.

It answers:

> Is this universe clean enough that Solpient should trust the resulting Top 100 research queue?

Universe QA never changes screening scores, evidence ceilings, states, candidate membership, or readiness.

## Normal operating sequence

```
SEC-first universe feed
        ↓
normalized universe JSON
        ↓
Universe QA V1
        ↓
human review
        ↓
Universe Screening V2.1 dry run
        ↓
approved immutable materialization
        ↓
Research Candidate Pipeline
```

## Browser console

Authenticated route:

```
/review/universe-qa
```

Choose a local normalized universe JSON/JSONL file.

The file is parsed and screened in the browser. It is not uploaded to the application and is not written to Supabase.

## CLI

```bash
node scripts/audit-universe-screen.mjs \
  --input=data/universe/sec-us-universe.json \
  --limit=100 \
  --output=data/universe/sec-us-universe-qa.json
```

To make CI or an operational script fail when manual review is required:

```bash
node scripts/audit-universe-screen.mjs \
  --input=data/universe/sec-us-universe.json \
  --fail-on-review
```

Exit code 2 means the universe generated a QA REVIEW REQUIRED result.

## Audits

### Funnel integrity

Reports:

- input securities
- unique tickers
- excluded
- watch
- research candidates
- Solpient 100 candidates
- current members
- Top-100 deep-research shortlist

### Classification and concentration

Reports:

- input sector/profile distribution
- shortlist sector/profile distribution
- Unknown/general classification rate
- profile concentration in the shortlist
- Unknown/general names that improperly reach the shortlist

### Evidence calibration

Reports:

- raw evidence coverage
- effective V2.1 evidence coverage
- shortlist median coverage
- number of companies subject to evidence ceilings
- sector-sensitive company count
- average critical-sector evidence coverage

### Data quality

Reports field completeness for:

- price
- market cap
- 30-day dollar liquidity
- ROIC
- ROE
- FCF margin
- cash conversion
- operating margin
- growth fields
- valuation fields

Also reports:

- duplicate tickers
- duplicate issuer/CIK identities
- Unknown classifications
- missing price/market cap/liquidity
- temporary market-data source usage

### Exclusion reasons

Counts every failed investability gate such as:

- market capitalization
- liquidity
- price
- commercial scale
- going concern
- bankruptcy
- extreme leverage

### Missing evidence

Aggregates missing screening components across non-excluded companies.

Sector Evidence Model V2.1 critical evidence is reported separately so missing CET1, NIM, combined ratio, AFFO, occupancy, debt maturity evidence, etc. is visible rather than buried inside a single coverage percentage.

### Suspicious-score diagnostics

Flags:

- high economic score with sub-70% effective evidence
- extreme score with thin raw evidence
- large raw-to-effective evidence compression
- potential value traps: strong valuation / weak quality
- expensive compounders: strong quality / weak valuation
- companies blocked by sector-critical evidence gaps

These are review prompts, not new investment scores.

## PASS versus REVIEW REQUIRED

QA PASS means no configured blocker or review condition fired.

REVIEW REQUIRED does **not** mean the screen is wrong. It means a human should inspect the highlighted condition before an immutable universe run is written.

Hard blockers include:

- duplicate tickers
- duplicate issuer/CIK identities
- Unknown/general promotion into a Solpient 100 candidate/member state
- Solpient 100 candidate/member below required effective evidence coverage
- bypass of a V2.1 sector-evidence promotion block

Review conditions include:

- excessive Unknown classifications
- excessive shortlist profile concentration
- weak shortlist evidence coverage
- high scores supported by weak evidence
- empty research shortlist

## Historical integrity

Universe QA does not create historical investment records.

It is intentionally pre-materialization. The immutable historical record begins only after the user approves the universe and runs the existing universe-screen materializer.

## Methodology relationship

Universe QA V1 is an audit/control layer, not a scoring methodology. It consumes the active Universe Screening V2.1 and Sector Evidence Model V2.1 outputs without modifying them.
