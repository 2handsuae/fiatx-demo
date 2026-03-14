#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./db-env.sh
source "${SCRIPT_DIR}/db-env.sh"

ensure_backend_dependencies() {
  if [[ -d "${ROOT_DIR}/node_modules" ]]; then
    return 0
  fi

  echo "[backend] node_modules missing, installing dependencies..."
  if [[ -f "${ROOT_DIR}/package-lock.json" ]]; then
    (
      cd "${ROOT_DIR}"
      npm ci
    )
  else
    (
      cd "${ROOT_DIR}"
      npm install
    )
  fi
}

resolve_db_file() {
  local db_url
  db_url="$(read_database_url "${ROOT_DIR}" "audit_evidence")"
  resolve_db_file_from_url "${ROOT_DIR}" "${db_url}"
}

bootstrap_database_if_needed() {
  local db_file
  local db_url
  db_file="$(resolve_db_file)"
  db_url="$(read_database_url "${ROOT_DIR}" "audit_evidence")"

  mkdir -p "$(dirname "${db_file}")"
  echo "[backend] Applying pending Prisma migrations to ${db_file}..."
  (
    cd "${ROOT_DIR}"
    DATABASE_URL="${db_url}" bash scripts/apply-local-migrations.sh "${ROOT_DIR}" "audit_evidence"
  )

  echo "[backend] Database schema ready: ${db_file}"
}

ensure_backend_dependencies
bootstrap_database_if_needed
DB_FILE="$(resolve_db_file)"
DB_URL="$(read_database_url "${ROOT_DIR}" "audit_evidence")"

cd "${ROOT_DIR}"
echo "Syncing base IAM data..."
DATABASE_URL="${DB_URL}" npm run db:base:sync
echo "Running business data reset..."
DATABASE_URL="${DB_URL}" npm run db:biz:reset
echo "Business data reset finished."
