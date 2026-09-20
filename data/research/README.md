# Research ingestion

Each published research version begins as a structured JSON file committed here.

Recommended filename:

`data/research/<TICKER>/<YYYY-MM-DD>.json`

When a JSON file is pushed to `main`, the GitHub Action imports it into Supabase. The file path becomes the immutable ingestion key, so rerunning the workflow does not create duplicate research versions.

Required top-level fields:

- `ticker`
- `company_name`
- `research`

Supported sections:

- `financial_metrics`
- `scores`
- `valuations`
- `thesis_variables`
- `sources`
- `ranking`

The importer creates a new sequential research version for the company. Existing versions are never overwritten.

## Repository secrets required

In GitHub repository settings, add:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Never commit either secret to the repository.
