#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT="$ROOT/.wt/claude"
APP="$WT/Exchange_js"
PORT_NUM="3102"

if [[ ! -d "$APP" ]]; then
  echo "Missing app path: $APP" >&2
  exit 1
fi

BRANCH="$(git -C "$WT" rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != claude/* ]]; then
  echo "claude expects branch prefix claude/, got: $BRANCH" >&2
  exit 1
fi

echo "[claude] branch=$BRANCH port=$PORT_NUM url=http://localhost:$PORT_NUM"
cd "$APP"
PORT="$PORT_NUM" npm run start:dev
