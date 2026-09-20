# Capital Coverage Verification v1

SOLPIENT tracks capital intelligence as a 22-company × 3-category matrix:

- insider
- institutional
- political

That creates 66 coverage cells.

## Why this exists

No event rows can mean two very different things:

1. nobody found qualifying activity, or
2. nobody checked.

Those states must never be conflated.

## Coverage states

- `pending` — not yet verified
- `activity_found` — one or more normalized events were found
- `verified_none` — the stated source/window was checked and no qualifying activity was found
- `partial` — some verification completed but more evidence is required
- `unavailable` — the intended provider/source was unavailable

Only `activity_found` and `verified_none` count as fully verified.

## Database

`capital_coverage_checks` stores one current verification state for each company/category.

The migration seeds all 66 cells. Existing normalized activity automatically upgrades the corresponding cells to `activity_found`.

## Ingest contract

The authenticated capital-intelligence ingest endpoint accepts both:

- `records` — positive activity
- `coverage` — verification results, including verified-negative results

A `verified_none` result requires a source URL. Provider failure or an empty API response must not be converted into `verified_none`.

## Bulk backfill

Export unresolved work:

`npm run export:capital-coverage`

Import a trusted verification batch:

`npm run import:capital-coverage -- --file=/path/to/batch.json`

An external worker can also request:

`GET /api/capital-intelligence/coverage-queue`

using the same bearer secret as the ingest endpoint.

## Success criteria

The orchestrator should report:

- 22 / 22 companies fully verified
- 66 / 66 coverage cells complete

A stock can be fully verified even when one or more categories contain zero events, as long as the negative result was explicitly verified and sourced.
