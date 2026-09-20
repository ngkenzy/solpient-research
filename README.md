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
