# Capital Intelligence Orchestrator v1

The orchestrator makes SOLPIENT ownership/disclosure intelligence resilient to provider failures.

## Goal

Keep every tracked company page structurally consistent while separating:

1. data collection,
2. validation and normalization,
3. provider health,
4. provenance and freshness,
5. downstream alerts.

A provider failure is recorded as a provider failure. It does not silently become a successful refresh.

## Architecture

External or direct provider -> validation -> normalized capital_activity -> intelligence_events -> company pages / alerts

Provider state is stored separately in capital_provider_health.

Every accepted external batch is recorded in capital_ingest_batches for auditability.

## Provider strategy

Current priority:

1. web_verified / externally orchestrated verified evidence
2. SEC direct Form 4 / 13F when reachable
3. Financial Datasets when API access is configured
4. Quiver or equivalent political-disclosure provider when configured
5. FMP fallback when plan limits permit it

Direct SEC is intentionally non-fatal to the orchestrator because SEC blocks the current GitHub/Vercel cloud runner IPs.

## External ingest

POST /api/capital-intelligence/ingest

Authentication:

Authorization: Bearer <CAPITAL_INGEST_SECRET>

Example payload:

{
  "provider": "web_verified",
  "verified_at": "2026-09-20T20:00:00Z",
  "source_run_id": "external-run-123",
  "records": [
    {
      "ticker": "MSFT",
      "activity_type": "insider",
      "actor_name": "Example Officer",
      "actor_detail": "CFO",
      "action": "Buy",
      "shares": 100,
      "price": 500,
      "value": 50000,
      "transaction_date": "2026-09-19",
      "disclosure_date": "2026-09-20",
      "source_url": "https://example.com/source",
      "source_key": "msft-example-2026-09-19"
    }
  ]
}

The endpoint:
- rejects unknown tickers
- rejects unsupported activity types
- requires a source URL and stable source key
- upserts capital_activity
- creates/updates intelligence_events
- writes provider health
- records accepted/rejected batch counts

## Cloud-independent import

A trusted worker that has direct Supabase service credentials can import a JSON batch without Vercel:

npm run import:capital-intelligence -- --file=/path/to/batch.json

This is the preferred fallback when a source blocks GitHub/Vercel IPs.

## Health

GET /api/capital-intelligence/health

Returns:
- provider health
- latest orchestrator run
- coverage by company
- number of companies with any coverage
- number with all three categories

Provider states:
- healthy
- degraded
- blocked
- stale
- inactive

## Company page behavior

The ownership/disclosure section now remains visible even when a company has zero records.

It shows:
- institutional activity
- political disclosures
- insider activity
- latest verification date
- provider provenance
- provider health
- explicit empty states when coverage is missing

Duplicate-looking records prefer higher-confidence providers in the UI.

## Alert materiality

The orchestrator preserves review priority for:
- meaningful insider purchases
- very large insider sales
- new/exited notable-investor positions
- institutional changes >= 25%

Political disclosures remain informational evidence by default, not an investment signal.

## Operational cadence

The Capital Intelligence Orchestrator workflow runs weekdays and can be dispatched manually.

It:
1. tests the engine/orchestrator
2. tries direct SEC ingestion
3. records SEC as blocked/degraded instead of failing silently
4. audits all provider health and company coverage
5. refreshes intelligence events

## Security

capital_ingest_batches is service-role only.

capital_provider_health is public-read but service-role-write.

The ingest endpoint requires CAPITAL_INGEST_SECRET and uses the server-side Supabase service credential. Neither secret should ever be exposed to browser code.
