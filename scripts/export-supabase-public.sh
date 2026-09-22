#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT/backups/supabase-export}"
mkdir -p "$OUT_DIR"

cd "$ROOT"

echo "Exporting hosted Supabase schema to $OUT_DIR/schema.sql ..."
supabase db dump --linked -f "$OUT_DIR/schema.sql"

echo "Exporting hosted Supabase data to $OUT_DIR/data.sql ..."
supabase db dump --linked -f "$OUT_DIR/data.sql" --use-copy --data-only

echo "Export complete."
echo "Files:"
echo "  $OUT_DIR/schema.sql"
echo "  $OUT_DIR/data.sql"
