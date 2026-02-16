#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT="$ROOT/.wt/integration"
APP="$WT/Exchange_js"
PORT_NUM="3000"

if [[ ! -d "$APP" ]]; then
  echo "Missing app path: $APP" >&2
  exit 1
fi

BRANCH="$(git -C "$WT" rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
  echo "integration expects branch main, got: $BRANCH" >&2
  exit 1
fi

echo "[integration] branch=$BRANCH port=$PORT_NUM url=http://localhost:$PORT_NUM"
cd "$APP"
PORT="$PORT_NUM" npm run start:dev
