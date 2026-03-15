#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[main] delegating dev:reset to stack.sh reset-main"
exec bash "${SCRIPT_DIR}/stack.sh" reset-main
