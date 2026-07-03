#!/usr/bin/env bash
# Stack-parameterised business reset (template).
# Same flow as reset-main.sh, with the stack name threaded through
# `load_stack_config "$1"` instead of hard-wired to `main`. Works for the
# `main` stack and per-worktree `self` stacks.
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
echo "  bash scripts/stack.sh up self   # (or 'up main' from the root worktree)"
