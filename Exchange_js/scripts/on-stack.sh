#!/usr/bin/env bash
# Run any existing npm script against a chosen stack's database + TigerBeetle.
#
# Why this exists: several scripts (recon:demo, demo:*, verify:manual-settle) hardcode
# DATABASE_URL=...branch... + TB_ADDRESS=3503 inline, and read-from-.env scripts also
# default to the branch stack. This switch redirects ANY of them to a target stack by
# resolving that stack's canonical DB url + TB address and re-running the script body
# with the inline env assignments stripped (so the target env wins).
#
# Usage:
#   bash scripts/on-stack.sh <main|self> <npm-script> [args...]   # self = current worktree
#   bash scripts/on-stack.sh main recon:demo
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./stack-common.sh
source "${SCRIPT_DIR}/stack-common.sh"   # provides load_stack_config + default_database_url

if [[ $# -lt 2 ]]; then
  echo "Usage: on-stack.sh <main|self> <npm-script> [args...]" >&2
  echo "  e.g. on-stack.sh main recon:demo" >&2
  exit 1
fi

stack="$1"; shift
script="$1"; shift

# Canonical per-stack config (sets TB_ADDRESS, ports, paths). Reuses the single source of truth.
load_stack_config "${stack}"
db_url="$(default_database_url "${STACK}")"

# Pull the npm script body from package.json (script name passed as argv, not interpolated).
body="$(node -e 'const s=require(process.argv[1]).scripts||{}; const c=s[process.argv[2]]; if(c==null){console.error("on-stack: no such npm script: "+process.argv[2]);process.exit(2);} process.stdout.write(c);' "${APP_DIR}/package.json" "${script}")"

# Strip leading inline ENV=VALUE assignments (quoted or bare) so the target-stack env wins.
clean="$(printf '%s' "${body}" | sed -E 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=("[^"]*"|[^[:space:]]+)[[:space:]]+)+//')"

echo "[on-stack/${stack}] DATABASE_URL=${db_url}"
echo "[on-stack/${stack}] TB_ADDRESS=${TB_ADDRESS}"
echo "[on-stack/${stack}] TB_DATA_FILE=${TB_DATA_FILE}"
echo "[on-stack/${stack}] script '${script}' -> ${clean} $*"

cd "${APP_DIR}"
# npm run injects node_modules/.bin into PATH; we bypass npm by running the script body
# ourselves, so we must inject it too — else every ts-node script dies with "command not found".
# TB_DATA_FILE (Task 12 fix): scripts/dev-tigerbeetle.sh (invoked by db:reset:business)
# now reads this to target the right stack's TB instance instead of always main's —
# see that script's header comment for the incident that made this necessary.
exec env PATH="${APP_DIR}/node_modules/.bin:${PATH}" DATABASE_URL="${db_url}" TB_ADDRESS="${TB_ADDRESS}" TB_DATA_FILE="${TB_DATA_FILE}" bash -c "${clean} \"\$@\"" _ "$@"
