# Solpient Research Factory V1

## Purpose

Research Factory V1 is the operational layer between the immutable Research Candidate Pipeline and analyst-reviewed research.

It does **not** change screening scores, Valuation V3 formulas, Decision Readiness thresholds, or the immutable candidate-pipeline history. It does **not** publish research automatically.

Its job is to turn a 100-name deep-research shortlist into an auditable work queue and automate the repetitive evidence work.

## Source contract

Each factory run is bound to one immutable `research-candidate-pipeline-v2.4` run. The factory run hash includes:

- source pipeline run ID and input hash
- source evaluation timestamp
- every source pipeline item ID, ticker, and item hash

The factory never mutates the source pipeline snapshot.

## Work stages

1. **Onboarding** — resolve the SEC identity and create a canonical Solpient company record.
2. **Evidence ingestion** — collect SEC fundamentals plus supported fallback data and market history.
3. **Baseline draft** — build the private evidence-grounded baseline package.
4. **Research draft** — compose the private Research Standard v2 draft.
5. **Valuation review** — generate an evidence-prefilled Valuation V3 draft, then wait for explicit analyst assumptions/review.
6. **Research review** — wait for the private research package to pass the existing human publication gates.
7. **Pipeline refresh** — once reviewed research and valuation exist, create a new immutable Pipeline V2.4 snapshot.
8. **Complete** — no factory work remains for the source snapshot.

Current mutable factory state is stored separately from immutable factory events. Every state transition is written to the append-only event ledger.

## Canonical onboarding

Research Factory uses the SEC ticker/CIK/exchange mapping to resolve company identity.

For Pipeline Run #1, the 100 required identity rows are versioned in
`data/research-factory/sec-identities-pipeline-run-1.json`. This is a deterministic
cache of SEC identity data because GitHub-hosted runners received HTTP 403 from the
live SEC ticker/exchange endpoint. The snapshot is explicitly bound to the immutable
Pipeline Run #1 ID; a future pipeline run must provide a new reviewed identity snapshot
rather than silently reusing this one.

A unique, defensible SEC ticker match can create a new canonical `companies` row. Existing Solpient companies keep their non-null metadata; onboarding only fills missing CIK, exchange, sector, or industry fields.

If an SEC ticker maps to multiple plausible issuers and name matching cannot disambiguate safely, the factory blocks that item for identity review. It never guesses.

## Evidence automation

For automatically processable candidates the worker reuses Solpient's existing systems:

- SEC Company Facts normalizer
- supported fundamentals fallback
- market-history adapter
- historical and peer context
- Coverage V2
- Baseline Factory
- Automated Research Composer
- Research Repair Center

These systems write private evidence and drafts only.

The worker is bounded by `RESEARCH_FACTORY_MAX_COMPANIES` so a scheduled run advances the highest-priority shortlist names without turning the entire 100-name queue into one fragile long-running job.

## Valuation draft guardrail

Research Factory can prefill only evidence-backed Valuation V3 inputs:

- immutable screen price
- stored FCF/share when available
- historical price/FCF quartile/median anchors when enough history exists
- observed peer price/FCF anchors when at least two local peer observations exist

It deliberately does **not** invent:

- bear/base/bull growth assumptions
- discount rates
- terminal growth
- normalized EPS assumptions
- tangible book value
- unsupported peer multiples
- expected-return assumptions

The result lives in `research_factory_valuation_drafts` with status `draft`. It is append-only and cannot become a reviewed `candidate_valuation_input_pack` automatically.

## Industry-module review

Many new shortlisted companies are not in the legacy static ticker-to-industry-module map.

Research Factory therefore surfaces a separate `industry_module_review` action when a generated baseline lacks a reviewed industry module. A generic coverage percentage is not treated as proof that sector-specific evidence is complete.

This guardrail is operational; Coverage V2 itself is not changed by Research Factory V1.

## Human gates remain authoritative

Research Factory never:

- auto-publishes a research run
- marks a valuation input pack reviewed
- reuses screening scores as reviewed business-quality scores
- clears manual repair jobs on its own
- promotes a company into a final Solpient 100 portfolio decision

Those steps remain under the existing review, valuation, publication, and Pipeline V2.4 controls.

## Operations

The regular Research Factory workflow has separate verification and operation paths.

- pull requests / relevant pushes run tests and syntax checks only
- weekday schedule or manual dispatch runs the production worker
- the worker materializes the current factory run idempotently, onboards identities, refreshes state, and processes a bounded batch
- the first V1 deployment includes a one-time bootstrap workflow to initialize the current Pipeline Run #1 queue

The private review surface is `/review/research-factory`.
