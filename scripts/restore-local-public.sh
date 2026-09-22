#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUMP="${1:-$ROOT/backups/solpient-public.dump}"

if [[ ! -f "$DUMP" ]]; then
  echo "Dump not found: $DUMP" >&2
  exit 1
fi

cd "$ROOT"

echo "Restoring $DUMP into local Solpient PostgreSQL..."

docker compose -f docker-compose.local.yml --env-file .env.local-stack exec -T db   pg_restore   --username="${SOLPIENT_DB_USER:-solpient}"   --dbname="${SOLPIENT_DB_NAME:-solpient}"   --clean   --if-exists   --no-owner   --no-privileges   < "$DUMP"

docker compose -f docker-compose.local.yml --env-file .env.local-stack exec -T db   psql   --username="${SOLPIENT_DB_USER:-solpient}"   --dbname="${SOLPIENT_DB_NAME:-solpient}"   -v ON_ERROR_STOP=1   -c "grant usage on schema public to solpient_dev_api; grant select,insert,update,delete on all tables in schema public to solpient_dev_api; grant usage,select,update on all sequences in schema public to solpient_dev_api; grant execute on all functions in schema public to solpient_dev_api; notify pgrst, 'reload schema';"

echo "Restore complete."
