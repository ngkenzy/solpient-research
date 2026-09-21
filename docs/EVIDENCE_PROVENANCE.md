# Evidence Provenance and Point-in-Time Research

Solpient Phase 2 defines the canonical evidence contract that sits beneath immutable Phase 1 publication.

## Truth flow

The authoritative analytical flow is:

```
Source document
→ Evidence observation
→ Normalized fact
→ Research input
→ Assumption/model input
→ Deterministic model output
→ Human judgment
→ Immutable published research
→ Later realized outcome
```

Phase 2 is additive. It does not replace or weaken the Phase 1 publication RPC, historical immutability guards, correction semantics, hashes, or locked prediction contracts.

## Canonical roles

### `fundamental_snapshots`
Provider/current projection used by ingestion and operational pipelines. It is not the immutable historical truth ledger.

A database trigger captures inserted and substantively corrected provider states into the append-only evidence ledger at write time.

### `company_metric_history`
Normalized analytical/history projection used by current-state analytical workflows. Historical research pages must not rely on it as the sole source of truth because projection rows can be regenerated.

### Peer / valuation / consensus / capital tables
Specialized point-in-time projections used by analytical engines and current-state UX. Their observations are canonicalized into the evidence ledger.

### `evidence_sources`
Append-only canonical source-document ledger. Stores provider identity, source type, publication/retrieval time, document identity/version, source quality class, and internal metadata.

Raw provider payloads remain internal.

### `evidence_observations`
Append-only statements or values as Solpient observed them from a source.

An observation answers:

> What did this source say, and when did Solpient know it?

### `normalized_facts`
Append-only canonical Solpient facts.

A normalized fact can supersede a prior fact but never rewrites it. Facts preserve economic time, knowledge time, source confidence, conflict state, methodology version, and derivation metadata.

### `metric_observations` + `financial_metrics`
Frozen research-version facts and summaries attached to a published research package.

### `research_context_packs`
Private analytical context assembled before publication. New publications freeze the exact context pack used by the composition. A context pack used by published research becomes immutable.

### `research_input_manifests`
Immutable manifest of the exact normalized facts and assumptions used by a published research version.

### Phase 1 research tables
Immutable published conclusion and historical record.

## Bitemporal semantics

Every canonical fact separates two clocks.

### Economic time
When the fact applies.

Examples:
- FY2025 revenue
- Q2 2026 operating margin
- market valuation on 2026-08-31

### Knowledge time
When Solpient could have known the fact.

Examples:
- SEC filing retrieval time
- provider snapshot observation time
- amended filing arrival time

Historical queries use knowledge time.

A later amendment may change the current fact without changing what an older research version knew.

## As-of behavior

For a published research version, the effective cutoff is:

```
research_runs.data_cutoff_at
fallback: research_runs.researched_at
```

New publications freeze `source_context_pack_id`.

Legacy publications without a frozen context pack use a conservative fallback requiring the context pack to have existed by the research cutoff.

The public historical performance panel uses:

`get_public_research_history_as_of_v1(research_run_id)`

This RPC exposes only whitelisted normalized values for the published company's frozen cutoff. It does not expose raw evidence, provider payloads, resolution notes, or arbitrary as-of access.

Historical mode fails closed to this bitemporal read model rather than reconstructing history from mutable projection rows.

## Restatements and amendments

A later same-provider correction is represented as:

```
Observation A
→ Fact A

later

Observation B
→ Fact B supersedes Fact A
```

Fact A and Observation A remain intact.

Current research can use Fact B.

Historical research with a cutoff before B continues to resolve Fact A.

The `fundamental_snapshots` provenance trigger captures both the pre-update state and substantive corrected state so an upsert cannot silently destroy previously known evidence.

## Provider conflicts

Independent-provider disagreement is not averaged or overwritten.

Solpient preserves:
- all observations
- the selected observation
- conflicting observations
- source quality classes
- conflict state
- deterministic selection reason

Canonical conflict states are:
- `verified`
- `provisional`
- `conflicting`
- `superseded`
- `unavailable`

A reviewed conflict-resolution decision is append-only and records the selected observation, reason, methodology version, and decision timestamp.

## Source confidence classes

Default source authority classes are:

1. `primary_regulatory`
2. `company_direct`
3. `structured_provider`
4. `verified_secondary`
5. `derived_calculation`
6. `analyst_assumption`

This hierarchy is a default deterministic ordering, not a claim that lower-ranked sources are always wrong.

Material conflicts remain visible even when a higher-authority source is selected.

## Derived metrics

Derived facts must identify:
- exact input fact IDs
- formula identifier
- calculation engine version
- calculation time
- derivation basis

Example:

```
Revenue fact
+
Free cash flow fact
→ free_cash_flow_div_revenue_pct_v1
→ FCF margin fact
```

A derived value is never represented as though it came directly from a filing.

## Research input manifest

Before the existing Phase 1 publication RPC runs, the reviewed application path builds and stages a canonical input manifest.

The manifest contains, where applicable:
- normalized fact ID
- metric key
- value/text
- unit
- economic period
- known-at timestamp
- basis
- source confidence class
- conflict state
- provenance status
- derivation basis
- source lineage
- per-input hash

Publication validates that no manifest input is known after the research cutoff.

The manifest is frozen inside the same publication transaction and its hash is cryptographically incorporated into the Phase 1 normalized-input integrity hash.

## Publication cutoff rule

New Phase 2 publications fail closed when a research input is known after the publication cutoff.

Conceptually:

```
max(research input known_at) <= research cutoff
```

Explicit assumptions are allowed but must be labeled as assumptions rather than fabricated source-backed facts.

## Public vs internal provenance

### Public
- immutable published research
- frozen research input manifest
- approved manifest items
- safe whitelisted historical fact read model
- public source references already approved for research display

### Internal
- raw evidence observations
- provider payloads
- resolution notes
- staging manifests
- repair state
- provider operational metadata
- internal canonical facts outside approved read models

New provenance tables use RLS and least-privilege grants. Raw evidence is service-role only.

## Legacy history

Phase 2 does not fabricate provenance that did not exist.

Older research versions may have:
- no frozen context pack
- no research input manifest
- incomplete canonical source lineage

These records remain immutable under Phase 1.

Where exact provenance cannot be reconstructed, the correct status is:

`legacy_provenance_partial`

not invented certainty.

## Historical invariants

Phase 2 tests must preserve these invariants:

1. Research published using Fact A continues to show Fact A after a later amendment creates Fact B.
2. Current state may use Fact B.
3. Fact B supersedes Fact A; Fact A is never rewritten.
4. Independent-provider disagreement remains explicit.
5. Derived facts preserve exact input fact lineage.
6. Inputs known after the research cutoff cannot be published.
7. Historical pages cannot consume post-cutoff facts.
8. Raw evidence remains inaccessible to public roles.
9. The safe historical read model is callable only for published research and exposes only whitelisted fields.

## Automation

The evidence provenance synchronizer canonicalizes existing projection tables into the append-only ledger.

The intended sequence is:

```
raw/provider state
→ provenance sync
→ historical/context engine
→ derived projections
→ provenance sync
```

The second sync captures derived analytical facts and their knowledge-time state.

## Phase boundary

Phase 2 does not redesign:
- valuation methodology
- Solpient scoring
- Solpient 100 selection
- Local Research AI

Those later phases must consume this evidence contract rather than bypass it.
