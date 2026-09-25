# Solpient V1 Product Contract

**Status:** authoritative product/engineering contract  
**Product promise:** **Know when your investment thesis changes.**

## Initial user

A serious self-directed investor generally holding approximately **5–30 individual stocks**, investing on fundamentals over months or years, and wanting fewer high-quality signals rather than more financial news.

## V1 surfaces

Consumer navigation is intentionally limited to:

1. **WHAT MATTERS**
2. **PORTFOLIO**
3. **RESEARCH**

Internal research-health, methodology, factory, automation, and review tooling remain internal.

## V1 conceptual loop

```text
Portfolio
  -> Holding
  -> Company
  -> Thesis Variable
  -> New Evidence
  -> Materiality Decision
  -> What Matters
  -> User Feedback
```

Group A builds the trustworthy Research side of this loop. It does **not** build the consumer workflow.

## Coverage contract

### MONITORED

Solpient knows the canonical company/security and can monitor it. Complete reviewed Research is not implied.

### RESEARCHED

The latest immutable published Research version has, at minimum:

- a reviewed business assessment,
- at least one canonical thesis variable,
- valuation,
- at least one risk,
- a frozen Research input manifest with evidence lineage.

### DEEP_COVERAGE

The company satisfies RESEARCHED and also has:

- at least two immutable published Research versions,
- at least one locked prediction snapshot,
- at least 12 valuation-history observations,
- at least three fiscal years of capital-allocation history,
- every component marked `required_for_deep_coverage` in the active freshness policy at `CURRENT`.

Coverage is deterministic backend state, not a UI label. A stale required component can downgrade DEEP_COVERAGE to RESEARCHED. Group A never promotes a company merely because a page exists.

## Evidence and time contract

Research must retain the chain:

```text
SOURCE
  -> OBSERVATION
  -> NORMALIZED FACT
  -> RESEARCH INPUT
  -> ANALYSIS
  -> PUBLISHED CONCLUSION
```

Published historical Research is immutable. Corrections create superseding versions. Historical/as-of reads may use only facts whose `known_at` is at or before the requested cutoff. A later restatement or provider update cannot silently change what Solpient believed earlier.

## Freshness contract

Freshness is component-level. Solpient distinguishes:

- **last checked** — the source/pipeline was actually checked,
- **latest evidence** — the newest evidence found,
- **last reviewed** — a thesis/research judgment was reviewed,
- **last recalculated** — a deterministic calculation such as valuation ran,
- **last published** — an immutable Research version was published,
- **evidence since publication** — later evidence exists after the Research cutoff.

A quiet source check is valuable state. It must not be represented as “stale” merely because nothing new appeared.

## Dependency / invalidation contract

New evidence does not automatically regenerate full Research.

```text
new normalized fact
  -> compare with superseded fact
  -> dependency rules
  -> affected components
  -> component invalidation
  -> targeted maintenance queue
  -> selective refresh/review
  -> new Research version only when warranted
```

Core financial state and invalidation are deterministic/database-authoritative. AI may explain or assist classification later; it is not authoritative financial state.

## Group B backend contract

Group B consumes stable service boundaries for:

- canonical company identity,
- current coverage state,
- current immutable Research,
- Research history,
- canonical thesis variables,
- component freshness,
- evidence after the current Research cutoff,
- open invalidations,
- frozen evidence manifest.

Future consumer UI must not query arbitrary internal provenance or maintenance tables directly.

## Explicit V1 non-goals

V1 does **not** include:

- Solpient Money,
- budgeting,
- Plaid as a requirement,
- banking,
- brokerage or trade execution,
- lending,
- cards,
- crypto,
- options,
- social feeds,
- public user profiles,
- personalized buy/sell advice,
- a giant Discover/content portal,
- universal deep Research for every listed company.

## Product test

Before approving a V1 feature:

> Does this help Solpient determine whether something materially changed the reason a user owns a company?

If not, defer it.

Before approving a data-model change:

> Can Solpient still know what this value was, where it came from, when it knew it, and what conclusion it produced later?

If not, redesign it.
