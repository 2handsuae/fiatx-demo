#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[branch] delegating dev:start to stack.sh up branch"
exec bash "${SCRIPT_DIR}/stack.sh" up branch
