# Automated Research Composer v1

The composer converts normalized baseline evidence plus historical/peer context into a **private Research Standard v2 draft**.

It generates:
- investment thesis framing
- quantitative business assessment
- historical trend narrative
- fundamental scorecard
- peer context
- five valuation methods explicitly considered
- bear/base/bull fair-value scenarios
- 3/5/10-year expected-return scenarios
- risk register and thesis breakers
- Buffett-style and Lynch-style lenses
- decision dashboard and five-part conclusion

## Guardrails

Composer output is stored separately in `research_compositions`. It is never published directly and never pretends to be human review.

Qualitative moat, management, AI, customer concentration, market-position and geographic claims are carried forward only when the baseline already contains evidence. Otherwise they are marked provisional or unresolved.

Historical and peer gaps stay explicit. The composer does not silently impute missing history.

## Flow

1. Baseline factory creates evidence draft.
2. Historical/peer context engine refreshes private context.
3. Composer writes `research_compositions`.
4. Analyst explicitly applies the composition in the private review workbench.
5. Existing promotion gates validate the merged Research Standard v2 package.
6. Publication remains a separate human action.

Run with `npm run compose:research`.

For one company: `node scripts/compose-research-drafts.mjs --ticker=ADBE`.
