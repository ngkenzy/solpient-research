# Live DB Invariant Evidence — Universe Methodology Activation

**Verified:** 2026-09-22  
**Scope:** Methodology Registry V1, Universe Screening, and Research Candidate Pipeline production tables.

This evidence supports the `db_invariant` validation gate used by Methodology Validation & Activation V1.

## Verified production invariants

The following tables were inspected directly in the connected Solpient Research Supabase/Postgres production project:

- `methodology_definitions`
- `methodology_lifecycle_events`
- `methodology_validation_runs`
- `universe_screen_runs`
- `universe_screen_results`
- `research_candidate_pipeline_runs`
- `research_candidate_pipeline_items`

For all seven tables:

1. Row Level Security is enabled.
2. `anon` has no SELECT privilege.
3. `authenticated` has no SELECT privilege.
4. `service_role` has SELECT and INSERT.
5. `service_role` does **not** have UPDATE, DELETE, or TRUNCATE.
6. Each table has an append-only `BEFORE UPDATE OR DELETE` trigger invoking `private.guard_append_only_history()`.

Verified trigger names include:

- `methodology_definitions_append_only_guard`
- `methodology_lifecycle_append_only_guard`
- `methodology_validation_append_only_guard`
- `universe_screen_runs_append_only_guard`
- `universe_screen_results_append_only_guard`
- `research_candidate_pipeline_runs_append_only_guard`
- `research_candidate_pipeline_items_append_only_guard`

## Migration state

Production includes the methodology registry, universe screening, and research candidate pipeline migrations.

No schema mutation is introduced by Methodology Validation & Activation V1. The activation build uses the existing append-only tables and records new definitions, validation evidence, lifecycle events, and screening runs only through INSERT operations.

## Supabase platform check

The current Supabase breaking-change review found no change that invalidates this internal service-role pattern. New-table Data API auto-exposure behavior is irrelevant to these existing tables, which are explicitly RLS-protected and not granted to `anon` or `authenticated`.

## Evidence reference

Use this stable evidence reference for the activation CLI:

`docs/validation/UNIVERSE_METHODOLOGY_DB_INVARIANT_2026-09-22.md`
