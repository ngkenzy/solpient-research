# SOLPIENT Research

**See clearly. Invest deliberately.**

SOLPIENT Research is a point-in-time fundamental investment research system. It is designed to preserve what the research believed at each date, compare later evidence with prior assumptions, and build a durable historical research dataset.

## First milestone

ADBE → Research Version 1 → Supabase → public company page.

Then:

ADBE → Research Version 2 → preserve Version 1 → show what changed.

## Stack

- Next.js + TypeScript
- Supabase/PostgreSQL
- Vercel
- GitHub

Payments, analytics, email automation, and native mobile will be added only after the research workflow is working.

## Development

1. Copy `.env.example` to `.env.local`.
2. Add the Supabase project URL and publishable key locally.
3. Run the SQL migration in `supabase/migrations/0001_research_core.sql` against the Supabase project.
4. Install dependencies with `npm install`.
5. Start with `npm run dev`.

Never commit `.env.local` or service-role keys.


## Automated intelligence

SOLPIENT now includes an append-only intelligence pipeline:

- SEC 10-K, 10-Q, 8-K and Form 4 monitoring every six hours
- notable-manager 13F monitoring
- daily SEC XBRL fundamental snapshots
- daily end-of-day market snapshots for the tracked research universe plus SPY
- immutable prediction snapshots published with research versions
- automatic realized-outcome and prediction-error scoring when supported forecasts mature
- current valuation gaps use the latest stored market price while preserving the original research-date price

Database migrations `0004_intelligence_predictions.sql` and
`0005_automated_intelligence.sql` must be applied to the production Supabase
database before the new storage-backed automation jobs can write records.

Consensus-estimate and political-disclosure automation are intentionally provider
adapters rather than web scrapers. They should only be enabled when a stable,
licensed/reliable data source is configured.
