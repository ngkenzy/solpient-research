#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IN_DIR="${1:-$ROOT/backups/supabase-export}"
SCHEMA="$IN_DIR/schema.sql"
DATA="$IN_DIR/data.sql"
SANITIZED_SCHEMA="$IN_DIR/schema.local.sql"

for f in "$SCHEMA" "$DATA"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing export file: $f" >&2
    exit 1
  fi
done

cd "$ROOT"

set -a
source .env.local-stack
set +a

DB_USER="${SOLPIENT_DB_USER:-solpient}"
DB_NAME="${SOLPIENT_DB_NAME:-solpient}"

echo "Ensuring local compatibility roles exist..."
POSTGRES_ROLE_EXISTS="$(docker compose -f docker-compose.local.yml --env-file .env.local-stack exec -T db \
  psql --username="$DB_USER" --dbname="$DB_NAME" -tAc "select 1 from pg_roles where rolname='postgres';" | tr -d '[:space:]')"

if [[ "$POSTGRES_ROLE_EXISTS" != "1" ]]; then
  docker compose -f docker-compose.local.yml --env-file .env.local-stack exec -T db \
    psql --username="$DB_USER" --dbname="$DB_NAME" -v ON_ERROR_STOP=1 \
    -c "create role postgres nologin;"
fi

echo "Preparing schema for plain PostgreSQL..."
awk '
  BEGIN { skip = 0 }
  skip {
    if ($0 ~ /;[[:space:]]*$/) skip = 0
    next
  }
  /^[[:space:]]*(CREATE EXTENSION|COMMENT ON EXTENSION)/ {
    if ($0 !~ /;[[:space:]]*$/) skip = 1
    next
  }
  /^[[:space:]]*(CREATE|ALTER|DROP)[[:space:]]+PUBLICATION/ {
    if ($0 !~ /;[[:space:]]*$/) skip = 1
    next
  }
  /^[[:space:]]*COMMENT[[:space:]]+ON[[:space:]]+PUBLICATION/ {
    if ($0 !~ /;[[:space:]]*$/) skip = 1
    next
  }
  { print }
' "$SCHEMA" > "$SANITIZED_SCHEMA"

echo "Resetting only the local public schema..."
docker compose -f docker-compose.local.yml --env-file .env.local-stack exec -T db   psql --username="$DB_USER" --dbname="$DB_NAME" -v ON_ERROR_STOP=1   -c "drop schema if exists public cascade; create schema public; grant all on schema public to $DB_USER; grant usage on schema public to solpient_dev_api;"

echo "Restoring schema..."
docker compose -f docker-compose.local.yml --env-file .env.local-stack exec -T db   psql --username="$DB_USER" --dbname="$DB_NAME" -v ON_ERROR_STOP=1 < "$SANITIZED_SCHEMA"

echo "Restoring data..."
{
  echo "SET session_replication_role = replica;";
  cat "$DATA";
  echo "SET session_replication_role = origin;";
} | docker compose -f docker-compose.local.yml --env-file .env.local-stack exec -T db     psql --username="$DB_USER" --dbname="$DB_NAME" -v ON_ERROR_STOP=1

echo "Granting local API access and reloading PostgREST..."
docker compose -f docker-compose.local.yml --env-file .env.local-stack exec -T db   psql --username="$DB_USER" --dbname="$DB_NAME" -v ON_ERROR_STOP=1   -c "grant usage on schema public to solpient_dev_api; grant select,insert,update,delete on all tables in schema public to solpient_dev_api; grant usage,select,update on all sequences in schema public to solpient_dev_api; grant execute on all functions in schema public to solpient_dev_api; notify pgrst, 'reload schema';"

echo "Restore complete."
