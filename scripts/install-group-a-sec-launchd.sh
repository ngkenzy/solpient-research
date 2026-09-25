#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$ROOT/ops/com.solpient.group-a-sec-worker.plist"
TARGET="$HOME/Library/LaunchAgents/com.solpient.group-a-sec-worker.plist"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$ROOT/.cache/group-a-sec-worker"

sed "s|__SOLPIENT_REPO__|$ROOT|g" "$TEMPLATE" > "$TARGET"

launchctl bootout "gui/$(id -u)" "$TARGET" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$TARGET"
launchctl enable "gui/$(id -u)/com.solpient.group-a-sec-worker"

echo "Installed: $TARGET"
echo "Schedule: 08:15 and 17:15 local machine time."
echo "Run now: launchctl kickstart -k gui/$(id -u)/com.solpient.group-a-sec-worker"
echo "Logs: $ROOT/.cache/group-a-sec-worker/"
