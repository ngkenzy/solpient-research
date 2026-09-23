#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.local-stack ]]; then
  echo "Missing .env.local-stack." >&2
  exit 1
fi

COMPOSE=(docker compose -f docker-compose.local.yml --env-file .env.local-stack)

echo "Repairing local extension-schema privileges..."
"${COMPOSE[@]}" exec -T db sh -lc 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
grant usage on schema extensions to solpient, postgres, solpient_dev_api, service_role;
grant execute on all functions in schema extensions to solpient, postgres, solpient_dev_api, service_role;

select
  has_schema_privilege('solpient','extensions','USAGE') as solpient_extensions_usage,
  has_schema_privilege('postgres','extensions','USAGE') as postgres_extensions_usage,
  has_schema_privilege('solpient_dev_api','extensions','USAGE') as dev_api_extensions_usage;
SQL

echo "Extension-schema privileges repaired."
