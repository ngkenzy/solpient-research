# SOLPIENT Research

**See clearly. Invest deliberately.**

SOLPIENT Research is a point-in-time fundamental investment research system. It is designed to preserve what the research believed at each date, compare later evidence with prior assumptions, and build a durable historical research dataset.

## Stack

- Next.js + TypeScript
- PostgreSQL
- Local PostgREST compatibility bridge during the database migration
- GitHub
- Optional Vercel deployment while production hosting is being separated

The target architecture is Solpient-owned PostgreSQL with a server-side data layer. Hosted Supabase remains a temporary production dependency until local parity is verified.

## Local-first development

The repo now includes a self-owned local PostgreSQL stack.

```bash
cp .env.local-stack.example .env.local-stack
# edit .env.local-stack and change the local database password
npm run local:up
npm run local:status
```

The current application can talk to the local stack through:

```text
http://127.0.0.1:54321
```

Add the local data API values from `.env.local-stack.example` to `.env.local`, then run:

```bash
npm install
npm run dev
```

See `docs/local-first-migration.md` for the controlled migration from the existing Supabase PostgreSQL database.

## Existing hosted database

Do not delete or modify the hosted production database until the local copy has been restored and the main research, ranking, review, alert, and automation workflows have passed parity checks.

The existing Supabase variables remain supported as fallbacks during the transition.

## Automated intelligence

SOLPIENT includes an append-only intelligence pipeline:

- SEC 10-K, 10-Q, 8-K and Form 4 monitoring
- notable-manager 13F monitoring
- SEC XBRL fundamental snapshots
- end-of-day market snapshots
- immutable prediction snapshots
- realized-outcome and prediction-error scoring
- point-in-time valuation and research history

Consensus-estimate and political-disclosure automation use provider adapters rather than assuming scraping is reliable or permitted.

## Security

Never commit `.env.local`, `.env.local-stack`, database passwords, service-role keys, or provider credentials.

The local PostgREST bridge is deliberately permissive and loopback-only so the current app can migrate without a big-bang query rewrite. It is **not** the intended production security model. The production VPS should expose only the web application/reverse proxy; PostgreSQL should remain on a private network.
