#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$ROOT/ops/com.solpient.v1-event-ingestion.plist"
TARGET="$HOME/Library/LaunchAgents/com.solpient.v1-event-ingestion.plist"

NPM_BIN="$(command -v npm)"
NODE_BIN="$(command -v node)"

if [[ -z "$NPM_BIN" || ! -x "$NPM_BIN" ]]; then
  echo "Unable to locate executable npm in the current shell." >&2
  exit 1
fi

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Unable to locate executable node in the current shell." >&2
  exit 1
fi

NODE_DIR="$(dirname "$NODE_BIN")"
NPM_DIR="$(dirname "$NPM_BIN")"
LAUNCHD_PATH="$NODE_DIR:$NPM_DIR:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$ROOT/.cache/v1-event-ingestion"

sed \
  -e "s|__SOLPIENT_REPO__|$ROOT|g" \
  -e "s|__NPM_BIN__|$NPM_BIN|g" \
  -e "s|__LAUNCHD_PATH__|$LAUNCHD_PATH|g" \
  "$TEMPLATE" > "$TARGET"

plutil -lint "$TARGET" >/dev/null

launchctl bootout "gui/$(id -u)" "$TARGET" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$TARGET"
launchctl enable "gui/$(id -u)/com.solpient.v1-event-ingestion"

echo "Installed: $TARGET"
echo "npm: $NPM_BIN"
echo "node: $NODE_BIN"
echo "launchd PATH: $LAUNCHD_PATH"
echo "Schedule: 09:00 and 18:00 local machine time (after the 08:15/17:15 SEC monitor)."
echo "Run now: launchctl kickstart -k gui/$(id -u)/com.solpient.v1-event-ingestion"
echo "Logs: $ROOT/.cache/v1-event-ingestion/"
