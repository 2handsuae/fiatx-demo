#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[main] delegating dev:stop to stack.sh down main"
exec bash "${SCRIPT_DIR}/stack.sh" down main
