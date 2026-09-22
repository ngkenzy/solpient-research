#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the direct PostgreSQL connection string first.}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/backups/solpient-public.dump}"
mkdir -p "$(dirname "$OUT")"

cd "$ROOT"

echo "Exporting Supabase public schema + data to:"
echo "  $OUT"

docker compose -f docker-compose.local.yml --env-file .env.local-stack exec -T db   pg_dump "$SUPABASE_DB_URL"   --schema=public   --format=custom   --no-owner   --no-privileges   > "$OUT"

echo "Export complete."
