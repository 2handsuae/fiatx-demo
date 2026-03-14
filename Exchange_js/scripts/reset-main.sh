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

bash "${SCRIPT_DIR}/stack-stop.sh" main

db_file="$(resolve_db_file)"
db_url="$(read_database_url "${APP_DIR}" "${STACK}")"

mkdir -p "$(dirname "${db_file}")"
if [[ -f "${db_file}" ]]; then
  backup_file="${db_file}.bak-$(date +%Y%m%d%H%M%S)"
  cp "${db_file}" "${backup_file}"
  echo "[main] backup created: ${backup_file}"
fi

rm -f "${db_file}"

echo "[main] rebuilding database schema: ${db_file}"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" bash scripts/apply-local-migrations.sh "${APP_DIR}" "${STACK}"
)

echo "[main] syncing base config"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" npm run db:base:sync
)

echo "[main] seeding business data"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" npm run db:biz:init
)

bash "${SCRIPT_DIR}/stack-up.sh" main

echo ""
echo "[main] reset complete"
echo "API:    ${BACKEND_URL}"
echo "Admin:  ${ADMIN_URL}"
echo "Client: ${CLIENT_URL}"
echo "Logs:"
echo "  ${BACKEND_LOG}"
echo "  ${ADMIN_LOG}"
echo "  ${CLIENT_LOG}"
