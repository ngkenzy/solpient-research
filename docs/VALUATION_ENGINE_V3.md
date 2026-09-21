# Valuation Engine V3 Core

## Purpose

Valuation Engine V3 fixes four methodological weaknesses in the current composer valuation:

1. generic fallback assumptions can create valuations even when evidence is missing;
2. owner earnings can duplicate the same FCF anchor rather than provide independent corroboration;
3. sector differences are not strong enough, especially for banks and biopharma;
4. 3/5/10-year expected-return estimates can reuse the same terminal fair value instead of projecting a distinct terminal business state at each horizon.

V3 is deliberately isolated from publication, provenance, ranking, and UI code. It is a deterministic valuation library intended to be integrated only after the current Phase 2 work settles.

## Core principles

### No silent assumptions

V3 does not insert generic growth, discount-rate, terminal-growth, or exit-multiple assumptions when inputs are missing.

A method either has the explicit inputs required to run, or it is marked unavailable.

### Independent anchors only

Fair value is built from independent valuation families:

- intrinsic cash flow
- normalized earnings
- book value
- historical relative valuation
- peer relative valuation
- independent owner earnings, only when the caller demonstrates that owner earnings is not just the same FCF metric renamed

Duplicate anchors are excluded from the independent-anchor count.

### Sector-aware profiles

The initial model registry supports consumer/brand, software/platform, advertising platforms, industrial/manufacturing, healthcare/medtech, transaction networks, data/subscription, healthcare distribution, industrial distribution, franchise consumer, biopharma, and financial banks.

Non-financial operating companies primarily use FCF DCF + historical + peer valuation.

Biopharma can use FCF DCF, normalized EPS multiple, historical multiple, and peer multiple. Pipeline counts are not automatically monetized.

Banks intentionally do not use generic FCF DCF. The bank profile uses normalized EPS multiple, tangible/book value multiple, historical P/TBV, and peer P/TBV.

## Scenario DCF

V3 uses an explicit two-stage per-share FCF DCF.

Required inputs: starting FCF/share, initial growth, mature growth, projection years, discount rate, and terminal growth.

Growth fades linearly from initial growth to mature growth during the explicit projection period.

If any required assumption is unavailable, the DCF method is unavailable.

## Bear / base / bull

Each scenario is valued independently.

The engine computes the median of the independent anchors available in that scenario.

Internal model output can retain a precise central value, but public presentation should use the engine's fair-value range and confidence band rather than implying false precision.

## Confidence

Confidence is separate from valuation attractiveness.

The V3 core confidence score weights independent-anchor sufficiency 35%, point-in-time valuation-history depth 25%, peer coverage 15%, primary-source evidence share 15%, and DCF assumption completeness 10%.

Bands: High >=85, Medium >=65, Developing >=45, Low <45.

Phase 2 provenance can later replace or augment these coarse evidence inputs without changing historical V3 outputs. A future methodology version should be used for that integration.

## Fair-value range

V3 avoids presenting weakly supported valuations as a single authoritative number.

The range begins with the interquartile spread of available independent anchors. A confidence-dependent minimum width is then enforced: High +/-8%, Medium +/-12%, Developing +/-18%, Low +/-25%.

This means a low-confidence internal model result such as 147.51 would normally be displayed as a range rather than '$147.51 fair value.'

## Margin of safety

The engine retains three simple capital-allocation reference prices: 25% margin of safety = 75% of base central value, 35% = 65%, and 50% = 50%.

These are outputs, not automatic buy recommendations.

## Expected returns

Expected-return modeling is explicitly separated from current intrinsic value.

For each bear/base/bull scenario and each horizon, the engine starts with an explicit per-share economic metric, compounds that metric for the requested horizon, applies an explicit exit multiple, adds modeled cumulative dividends, and calculates CAGR from today's price to horizon-specific terminal wealth.

Therefore terminal_value_3y, terminal_value_5y, and terminal_value_10y are independently projected rather than recycled from one fair-value number.

The engine never reuses one current fair value as the terminal value for every horizon.

## Current status

This core is intentionally not wired into research-composer.mjs, publication, Supabase valuation rows, ranking, Research Standard V2 UI, or Decision Triggers.

Integration should occur only after Phase 2 provenance/temporal work is stable, sector fixtures are reviewed, V3 output is compared against the current published universe, and a migration/versioning strategy for published valuation methodology is approved.

## Initial regression fixtures

The deterministic suite covers DECK-like consumer brand, ADBE-like software, PFE-like biopharma, GMED-like medtech, and a bank valuation case.

It also proves that missing DCF assumptions return unavailable rather than fallback values, duplicate owner-earnings anchors are excluded, weak evidence widens the fair-value range, banks do not run generic FCF DCF, expected-return terminal values are horizon-specific, and missing return assumptions do not manufacture CAGR.