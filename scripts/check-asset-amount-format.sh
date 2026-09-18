#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIRS=(
  "$ROOT_DIR/admin-web/src/pages"
  "$ROOT_DIR/client-web/src/pages"
)

PATTERN_1='Number\(([^)]*(amount|feeAmount|netAmount|availableBalance|restrictedBalance|totalBalance|clientCredit|lockedBalance))\)\.toLocaleString\('
PATTERN_2='(amount|feeAmount|netAmount|availableBalance|restrictedBalance|totalBalance|clientCredit|lockedBalance)[^\n]{0,120}minimumFractionDigits:\s*2[^\n]{0,120}maximumFractionDigits:\s*8'

echo "[check-asset-amount-format] scanning frontend pages..."

HIT_1="$(rg -n --pcre2 "$PATTERN_1" "${TARGET_DIRS[@]}" || true)"
HIT_2="$(rg -n --pcre2 "$PATTERN_2" "${TARGET_DIRS[@]}" || true)"

if [[ -n "$HIT_1" || -n "$HIT_2" ]]; then
  echo "[check-asset-amount-format] FAILED: found hardcoded asset amount formatting."
  if [[ -n "$HIT_1" ]]; then
    echo "$HIT_1"
  fi
  if [[ -n "$HIT_2" ]]; then
    echo "$HIT_2"
  fi
  exit 1
fi

echo "[check-asset-amount-format] OK"
