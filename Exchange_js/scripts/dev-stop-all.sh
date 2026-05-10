#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[branch] delegating dev:stop to stack.sh down branch"
exec bash "${SCRIPT_DIR}/stack.sh" down branch
