#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MIGRATIONS_DIR="${ROOT_DIR}/prisma/migrations"
PRISMA_DIR="${ROOT_DIR}/prisma"

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
  local db_url="${DATABASE_URL:-}"
  if [[ -z "${db_url}" && -f "${ROOT_DIR}/.env" ]]; then
    db_url="$(grep -E '^DATABASE_URL=' "${ROOT_DIR}/.env" | tail -n 1 | cut -d'=' -f2- | tr -d '\"' || true)"
  fi

  if [[ -z "${db_url}" ]]; then
    echo "${ROOT_DIR}/dev.db"
    return 0
  fi

  if [[ "${db_url}" == file:* ]]; then
    local raw_path="${db_url#file:}"
    if [[ "${raw_path}" = /* ]]; then
      echo "${raw_path}"
    else
      echo "${PRISMA_DIR}/${raw_path#./}"
    fi
    return 0
  fi

  echo "${PRISMA_DIR}/dev.db"
}

db_has_required_tables() {
  local db_file="$1"
  if [[ ! -f "${db_file}" ]]; then
    return 1
  fi

  local tables
  tables="$(sqlite3 "${db_file}" '.tables' 2>/dev/null || true)"
  [[ "${tables}" == *"customer_main"* ]] && [[ "${tables}" == *"users"* ]]
}

bootstrap_database_if_needed() {
  local db_file
  db_file="$(resolve_db_file)"

  if db_has_required_tables "${db_file}"; then
    return 0
  fi

  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "[backend] sqlite3 is required to bootstrap database schema."
    exit 1
  fi

  if [[ ! -d "${MIGRATIONS_DIR}" ]]; then
    echo "[backend] Migrations directory not found: ${MIGRATIONS_DIR}"
    exit 1
  fi

  mkdir -p "$(dirname "${db_file}")"
  : > "${db_file}"
  echo "[backend] Database schema missing, applying migrations to ${db_file}..."

  while IFS= read -r migration; do
    sqlite3 "${db_file}" < "${migration}"
  done < <(find "${MIGRATIONS_DIR}" -name migration.sql | sort)
}

ensure_backend_dependencies
bootstrap_database_if_needed

cd "${ROOT_DIR}"
echo "Running business data reset..."
npm run db:biz:reset
echo "Business data reset finished."
