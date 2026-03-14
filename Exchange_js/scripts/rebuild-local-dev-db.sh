#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./db-env.sh
source "${SCRIPT_DIR}/db-env.sh"

DB_URL="$(read_database_url "${ROOT_DIR}" "audit_evidence")"
DB_FILE="$(resolve_db_file_from_url "${ROOT_DIR}" "${DB_URL}")"

echo "[wave1] stopping local services"
bash "${SCRIPT_DIR}/dev-stop-all.sh" >/dev/null 2>&1 || true

mkdir -p "$(dirname "${DB_FILE}")"

if [[ -f "${DB_FILE}" ]]; then
  backup_file="${DB_FILE}.bak-$(date +%Y%m%d%H%M%S)"
  cp "${DB_FILE}" "${backup_file}"
  echo "[wave1] database backup created: ${backup_file}"
fi

rm -f "${DB_FILE}" "${DB_FILE}-journal" "${DB_FILE}-wal" "${DB_FILE}-shm"

echo "[wave1] rebuilding local database from Prisma migrations"
(
  cd "${ROOT_DIR}"
  DATABASE_URL="${DB_URL}" bash scripts/apply-local-migrations.sh "${ROOT_DIR}" "audit_evidence"
)

echo "[wave1] syncing base IAM data"
(
  cd "${ROOT_DIR}"
  DATABASE_URL="${DB_URL}" npm run db:base:sync
)

echo "[wave1] rebuild complete"
echo "Run next:"
echo "  npm run runtime:diagnose"
echo "  npm run dev:start"
echo "Optional demo data:"
echo "  npm run governance:demo:seed"
