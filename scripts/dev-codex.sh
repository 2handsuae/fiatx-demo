#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT="$ROOT/.wt/codex"
APP="$WT/Exchange_js"
PORT_NUM="3101"

if [[ ! -d "$APP" ]]; then
  echo "Missing app path: $APP" >&2
  exit 1
fi

BRANCH="$(git -C "$WT" rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != codex/* ]]; then
  echo "codex expects branch prefix codex/, got: $BRANCH" >&2
  exit 1
fi

echo "[codex] branch=$BRANCH port=$PORT_NUM url=http://localhost:$PORT_NUM"
cd "$APP"
PORT="$PORT_NUM" npm run start:dev
