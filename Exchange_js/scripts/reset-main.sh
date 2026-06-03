#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./stack-common.sh
source "${SCRIPT_DIR}/stack-common.sh"
# shellcheck source=./db-env.sh
source "${SCRIPT_DIR}/db-env.sh"

require_commands sqlite3 npm find git

load_stack_config main
assert_stack_paths
assert_branch_rule

db_url="$(read_database_url "${APP_DIR}" "${STACK}")"
db_file="$(resolve_db_file)"

echo "[main] stopping services before business reset"
bash "${SCRIPT_DIR}/stack-stop.sh" main >/dev/null 2>&1 || true

mkdir -p "$(dirname "${db_file}")"

echo "[main] applying pending migrations: ${db_file}"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" bash scripts/apply-local-migrations.sh "${APP_DIR}" "${STACK}"
)

echo "[main] syncing base IAM config"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" npm run db:base:sync
)

echo "[main] clearing business data"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" npm run db:biz:reset
)

echo "[main] re-seeding business demo"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" npm run db:seed:business
)

echo ""
echo "[main] business reset complete"
echo "Database: ${db_file}"
echo "Run next:"
echo "  npm run runtime:diagnose"
echo "  npm run dev:start"
