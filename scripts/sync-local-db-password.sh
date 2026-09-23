#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.local-stack ]]; then
  echo "Missing .env.local-stack. Copy .env.local-stack.example first." >&2
  exit 1
fi

COMPOSE=(docker compose -f docker-compose.local.yml --env-file .env.local-stack)

echo "Starting the local PostgreSQL container..."
"${COMPOSE[@]}" up -d db

echo "Waiting for PostgreSQL..."
for _ in {1..30}; do
  if "${COMPOSE[@]}" exec -T db sh -lc 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1'; then
    break
  fi
  sleep 1
done

if ! "${COMPOSE[@]}" exec -T db sh -lc 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1'; then
  echo "PostgreSQL did not become ready." >&2
  exit 1
fi

echo "Synchronizing the PostgreSQL role password without printing the secret..."
"${COMPOSE[@]}" exec -T db sh -lc 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
\getenv db_role POSTGRES_USER
\getenv db_password POSTGRES_PASSWORD
ALTER ROLE :"db_role" WITH LOGIN PASSWORD :'db_password';
SQL

echo "Regenerating .env.local from .env.local-stack..."
node scripts/configure-local-data-env.mjs >/dev/null

echo "Restarting temporary compatibility services..."
"${COMPOSE[@]}" up -d --force-recreate rest gateway

echo "Verifying a real TCP login using the app connection URL..."
node --env-file=.env.local scripts/verify-direct-postgres.mjs >/tmp/solpient-db-verify.json

if ! grep -q '"ok": true' /tmp/solpient-db-verify.json; then
  cat /tmp/solpient-db-verify.json
  echo "TCP login verification failed." >&2
  exit 1
fi

cat /tmp/solpient-db-verify.json
rm -f /tmp/solpient-db-verify.json

echo "Local PostgreSQL credentials are synchronized and verified."
