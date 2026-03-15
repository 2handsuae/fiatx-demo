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

echo "[main] stopping local services"
bash "${SCRIPT_DIR}/stack-stop.sh" main >/dev/null 2>&1 || true

db_file="$(resolve_db_file)"
db_url="$(read_database_url "${APP_DIR}" "${STACK}")"

mkdir -p "$(dirname "${db_file}")"

if [[ -f "${db_file}" ]]; then
  backup_file="${db_file}.bak-$(date +%Y%m%d%H%M%S)"
  cp "${db_file}" "${backup_file}"
  echo "[main] database backup created: ${backup_file}"
fi

rm -f "${db_file}" "${db_file}-journal" "${db_file}-wal" "${db_file}-shm"

echo "[main] rebuilding local database from versioned migrations"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" bash scripts/apply-local-migrations.sh "${APP_DIR}" "${STACK}"
)

echo "[main] syncing base IAM data"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" npm run db:base:sync
)

echo "[main] rebuild complete"
echo "Run next:"
echo "  npm run runtime:diagnose"
echo "  npm run dev:start"
echo "Optional demo data:"
echo "  DATABASE_URL=\"${db_url}\" npm run governance:demo:seed"
