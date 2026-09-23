#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.local-stack ]]; then
  echo "Missing .env.local-stack. Copy .env.local-stack.example first." >&2
  exit 1
fi

NEW_DB_PASSWORD="$(node -e 'console.log(require("node:crypto").randomBytes(24).toString("hex"))')"
export NEW_DB_PASSWORD

echo "Rotating local-only PostgreSQL password to a parser-safe value..."
node <<'NODE'
const fs=require("node:fs");
const path=".env.local-stack";
const password=process.env.NEW_DB_PASSWORD;
let text=fs.readFileSync(path,"utf8");
const line="SOLPIENT_DB_PASSWORD="+password;
if(/^SOLPIENT_DB_PASSWORD=.*$/m.test(text)){
  text=text.replace(/^SOLPIENT_DB_PASSWORD=.*$/m,line);
}else{
  if(text && !text.endsWith("\n"))text+="\n";
  text+=line+"\n";
}
fs.writeFileSync(path,text,"utf8");
NODE

COMPOSE=(docker compose -f docker-compose.local.yml --env-file .env.local-stack)

echo "Recreating PostgreSQL container with the new local credential..."
"${COMPOSE[@]}" up -d --force-recreate db

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

echo "Resetting the existing PostgreSQL role over the local Unix socket..."
"${COMPOSE[@]}" exec -T -e NEW_DB_PASSWORD="$NEW_DB_PASSWORD" db   sh -lc 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
\getenv db_role POSTGRES_USER
\getenv db_password NEW_DB_PASSWORD
ALTER ROLE :"db_role" WITH LOGIN PASSWORD :'db_password';
SQL

echo "Regenerating .env.local from the same credential..."
node scripts/configure-local-data-env.mjs >/dev/null

echo "Recreating temporary compatibility services..."
"${COMPOSE[@]}" up -d --force-recreate rest gateway

echo "Verifying a real TCP login through the application connection string..."
node scripts/verify-direct-postgres.mjs >/tmp/solpient-db-verify.json

cat /tmp/solpient-db-verify.json

if ! grep -q '"ok": true' /tmp/solpient-db-verify.json; then
  rm -f /tmp/solpient-db-verify.json
  echo "TCP login verification failed after credential rotation." >&2
  exit 1
fi

rm -f /tmp/solpient-db-verify.json
unset NEW_DB_PASSWORD

echo "Local PostgreSQL credentials are rotated, synchronized, and verified."
