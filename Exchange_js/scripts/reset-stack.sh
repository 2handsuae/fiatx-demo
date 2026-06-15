#!/usr/bin/env bash
# Stack-parameterised business reset (template).
# Source pattern: reset-main.sh — this is the same flow with the stack name
# threaded through `load_stack_config "$1"` instead of hard-wired to `main`.
# For the branch stack, also reformat its dedicated TigerBeetle data file so
# the two-book (SQLite + TB) start from a synchronised clean slate.
#
# Call surface (use the safe wrappers, not this directly):
#   reset-branch.sh  → enforces 3-gate isolation, then `exec reset-stack.sh branch`
#   reset-main.sh    → existing entry; left untouched for backwards compatibility
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./stack-common.sh
source "${SCRIPT_DIR}/stack-common.sh"
# shellcheck source=./db-env.sh
source "${SCRIPT_DIR}/db-env.sh"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <stack>" >&2
  exit 1
fi

require_commands sqlite3 npm find git

STACK_NAME="$1"
load_stack_config "${STACK_NAME}"
assert_stack_paths
assert_branch_rule

db_url="$(read_database_url "${APP_DIR}" "${STACK}")"
db_file="$(resolve_db_file)"

echo "[${STACK}] stopping services before business reset"
bash "${SCRIPT_DIR}/stack-stop.sh" "${STACK}" >/dev/null 2>&1 || true

# Branch stack co-owns a dedicated TigerBeetle (3503, /tmp/exchange_js_branch/
# 0_0.tigerbeetle — both hardcoded in dev-tigerbeetle.sh, so no cross-stack
# risk). `format` stops it, removes the data file, and re-initialises — paired
# with the Prisma migrate/seed below, this puts both books back at the same
# zero point so F_FEE-from-0 reconciliation is exact.
if [[ "${STACK}" == "branch" ]]; then
  echo "[${STACK}] reformatting TigerBeetle (paired with SQLite reset)"
  bash "${SCRIPT_DIR}/dev-tigerbeetle.sh" format
fi

mkdir -p "$(dirname "${db_file}")"

echo "[${STACK}] applying pending migrations: ${db_file}"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" bash scripts/apply-local-migrations.sh "${APP_DIR}" "${STACK}"
)

echo "[${STACK}] syncing base IAM config"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" npm run db:base:sync
)

echo "[${STACK}] clearing business data"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" npm run db:biz:reset
)

echo "[${STACK}] re-seeding business demo"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" npm run db:seed:business
)

echo ""
echo "[${STACK}] business reset complete"
echo "Database: ${db_file}"
echo "Run next:"
echo "  npm run runtime:diagnose"
echo "  npm run dev:start"
