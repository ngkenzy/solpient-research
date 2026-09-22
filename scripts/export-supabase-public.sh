#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT/backups/supabase-export}"
mkdir -p "$OUT_DIR"

cd "$ROOT"

echo "Exporting Solpient schemas (public, private) to $OUT_DIR/schema.sql ..."
supabase db dump --linked --schema public,private -f "$OUT_DIR/schema.sql"

echo "Exporting Solpient data (public, private) to $OUT_DIR/data.sql ..."
supabase db dump --linked --schema public,private -f "$OUT_DIR/data.sql" --use-copy --data-only

echo "Export complete."
echo "Files:"
echo "  $OUT_DIR/schema.sql"
echo "  $OUT_DIR/data.sql"
