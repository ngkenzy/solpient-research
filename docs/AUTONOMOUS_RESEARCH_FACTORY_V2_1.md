# Autonomous Research Factory V2.1

## Purpose

Autonomous Research Factory V2.1 removes three routine manual gates from the Solpient 100 research pipeline:

1. evidence repair and historical-context reconstruction,
2. industry-module assignment,
3. explicit Valuation V3 assumption generation.

It does **not** silently relax evidence standards. When the evidence is too weak or classification is ambiguous, the company is quarantined and the factory continues with other candidates.

## Operating loop

For up to 10 unresolved candidates per weekday, in shortlist order:

1. refresh SEC normalized fundamentals,
2. try the Yahoo fundamentals fallback,
3. refresh market history,
4. assign an industry module from the immutable screen classification,
5. rebuild historical / peer context,
6. rebuild the private baseline under the assigned module,
7. recalculate Coverage V2,
8. generate a private research composition,
9. construct explicit Valuation V3 assumptions and relative-valuation anchors,
10. auto-approve the valuation input pack only when policy thresholds pass,
11. refresh the Research Factory state.

The scheduler uses Settled Queue V2.1.2. It prioritizes first-pass `needs_review` items, then ordinary queued work. A quarantined company is considered settled under its current structural evidence and does not consume another weekday slot unless that evidence fingerprint changes. Blocked and running items are excluded from routine scheduling. An explicit single-ticker run may recheck a blocked or quarantined company.

## Industry assignment

Policy version: `industry-assignment-v2.1`.

The assignment combines:

- the immutable Universe Screen V2.3 profile,
- screen sector and industry,
- Sector Classification V2.3 confidence,
- reviewed ticker overrides where Solpient already has a known issuer-specific mapping.

Automatic assignment requires confidence >= 80% and no source classification review flag.

All assignments are append-only and retain their evidence payload and decision hash.

## Valuation assumptions

Policy version: `valuation-assumptions-v2.1.1`.

V2.1 does not claim generated assumptions are reported facts. It explicitly labels the inputs as Solpient policy/model assumptions.

Inputs can include:

- historical revenue, EPS and FCF/share growth,
- point-in-time consensus growth when enough analysts are present,
- stored multi-year historical valuation observations,
- normalized peer valuation observations,
- latest stored market price,
- true primary regulatory fundamentals when available,
- independently corroborated structured fundamentals when primary access is unavailable,
- leverage and coverage evidence.

V2.1.1 does not treat a 10-K/10-Q label from an aggregator as primary evidence. Full primary-source credit requires at least eight actual regulator-backed rows; four to seven receive partial primary credit. In the absence of enough primary evidence, structured-provider corroboration can receive partial source-evidence credit only with at least two providers, six comparable metric-period pairs, and at least 90% agreement within 5%. A single structured provider cannot qualify.

For corporate FCF profiles, the policy creates bear/base/bull:

- initial growth,
- mature growth,
- discount rate,
- terminal growth,
- historical multiple anchors,
- peer multiple anchors,
- terminal-return scenarios.

The discount rate is a named Solpient policy rate. It is **not** represented as an observed WACC.

## Auto-approval requirements

A valuation input pack can be auto-approved only when all of the following hold:

- applied industry assignment confidence >= 80%,
- valuation policy confidence >= 78%,
- Valuation V3 preflight is complete,
- current price is available,
- positive FCF/share is available,
- at least two independent growth signals are available,
- at least 36 historical valuation observations spanning roughly 2.5+ years are available,
- at least three peer valuation observations are available,
- specialized profiles meet their additional required inputs.

If any requirement fails, the ticker is quarantined.

## Auditability

New append-only tables:

- `research_factory_autonomous_runs`
- `research_factory_autonomous_decisions`
- `research_factory_industry_assignments`

Auto-approved valuation packs are stored in `candidate_valuation_input_packs` with:

- `status='reviewed'`,
- `reviewed_by='autonomous-policy:valuation-assumptions-v2.1.1'`,
- the exact generated valuation input,
- the exact input hash,
- an audit note containing the autonomous decision hash and confidence.

This keeps machine approval distinguishable from human review.

## Security

Autonomous decision tables are RLS-enabled and service-role only.

The valuation publication RPC is `SECURITY INVOKER`, executable only by `service_role`, and refuses to create a reviewed valuation pack unless it can prove:

1. the Research Factory item exists,
2. an applied high-confidence industry assignment exists,
3. a matching applied valuation-assumption decision exists,
4. the decision confidence exceeds the publication threshold,
5. the payload/hash matches the recorded decision.

## Capital-allocation repair

The historical context engine now persists annual:

- dividends paid,
- buybacks,
- stock-based compensation,
- acquisitions,
- debt issued,
- debt repaid.

This allows Coverage V2 to reconstruct its five-year capital-allocation layer automatically when normalized cash-flow evidence supports it.

## Quarantine semantics

Quarantine is an automated exception state, not a daily retry loop.

Settled Queue V2.1.2 records a structural evidence hash after each autonomous attempt. The hash is based on policy version plus structural coverage, provider mix, consensus inputs, historical/peer availability, baseline evidence, and industry assignment. It intentionally excludes routine timestamp churn and daily market-price movement.

A quarantined ticker becomes eligible again only when its current structural evidence hash differs from the hash stored after its last autonomous attempt. This lets new filings, additional providers, peer availability, consensus evidence, coverage improvements, or policy changes trigger a fresh attempt without allowing unchanged quarantines to consume weekday capacity.

Blocked and running states are also excluded from routine batches. An explicit single-ticker execution can override quarantine or blocked status for controlled recovery.

## Schedule

The existing Research Factory workflow runs Monday through Friday at 14:29 UTC. It processes a maximum of 10 candidates by default, uses Settled Queue V2.1.2 for routine selection, and supports manual single-ticker execution.

## Scope boundary

V2.1 automates evidence repair, industry assignment, research composition and valuation assumptions. It still stops at the **research verification/publication** gate. Autonomous claim verification, skeptic review and publication are intentionally deferred to the next Research Factory version rather than being silently introduced into V2.1.
