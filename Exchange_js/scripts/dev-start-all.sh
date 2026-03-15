#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[main] delegating dev:start to stack.sh up main"
exec bash "${SCRIPT_DIR}/stack.sh" up main
