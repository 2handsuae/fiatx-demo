#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
export LANG=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./db-env.sh
source "${SCRIPT_DIR}/db-env.sh"

APP_DIR="${1:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
DB_SCOPE="${2:-main}"
DB_URL="${DATABASE_URL:-$(read_database_url "${APP_DIR}" "${DB_SCOPE}")}"
DB_FILE="$(resolve_db_file_from_url "${APP_DIR}" "${DB_URL}")"
SCHEMA_FILE="${APP_DIR}/prisma/schema.prisma"
MIGRATIONS_DIR="${APP_DIR}/prisma/migrations"
PRISMA_BIN="${APP_DIR}/node_modules/.bin/prisma"

if [[ ! -x "${PRISMA_BIN}" ]]; then
  echo "Missing Prisma CLI binary: ${PRISMA_BIN}" >&2
  exit 1
fi

if [[ ! -f "${SCHEMA_FILE}" ]]; then
  echo "Missing Prisma schema: ${SCHEMA_FILE}" >&2
  exit 1
fi

mkdir -p "$(dirname "${DB_FILE}")"

fail_migration_metadata() {
  local migration_name="$1"
  local detail="${2:-unknown sqlite error}"
  echo "[migrate] ERROR ${migration_name}: migration metadata read failed for ${DB_FILE}" >&2
  echo "[migrate] ${detail}" >&2
  exit 1
}

sqlite_scalar_or_fail() {
  local migration_name="$1"
  local sql="$2"
  local output
  local error_output
  error_output="$(mktemp -t exchange-js-sqlite-error)"

  if ! output="$(sqlite3 "${DB_FILE}" "${sql}" 2>"${error_output}")"; then
    local detail
    detail="$(tr '\n' ' ' <"${error_output}" | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')"
    rm -f "${error_output}"
    fail_migration_metadata "${migration_name}" "${detail:-unknown sqlite error}"
  fi

  rm -f "${error_output}"
  printf '%s' "${output}"
}

ensure_integer_or_fail() {
  local migration_name="$1"
  local value="$2"
  local label="$3"

  if [[ ! "${value}" =~ ^[0-9]+$ ]]; then
    fail_migration_metadata "${migration_name}" "invalid ${label}: ${value}"
  fi
}

run_sql_file() {
  local sql_file="$1"
  DATABASE_URL="${DB_URL}" "${PRISMA_BIN}" db execute --file "${sql_file}" --schema "${SCHEMA_FILE}" >/dev/null
}

create_migration_table() {
  local temp_sql
  temp_sql="$(mktemp -t exchange-js-migration-table)"
  cat >"${temp_sql}" <<'SQL'
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "checksum" TEXT NOT NULL,
  "finished_at" DATETIME,
  "migration_name" TEXT NOT NULL UNIQUE,
  "logs" TEXT,
  "rolled_back_at" DATETIME,
  "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);
SQL
  run_sql_file "${temp_sql}"
  rm -f "${temp_sql}"
}

escape_sql_literal() {
  printf "%s" "$1" | sed "s/'/''/g"
}

create_wrapped_sql() {
  local migration_name="$1"
  local migration_file="$2"
  local checksum="$3"
  local temp_sql="$4"

  {
    echo "BEGIN IMMEDIATE;"
    cat "${migration_file}"
    echo
    echo "INSERT INTO \"_prisma_migrations\" ("
    echo "  \"id\","
    echo "  \"checksum\","
    echo "  \"finished_at\","
    echo "  \"migration_name\","
    echo "  \"logs\","
    echo "  \"rolled_back_at\","
    echo "  \"started_at\","
    echo "  \"applied_steps_count\""
    echo ") VALUES ("
    echo "  lower(hex(randomblob(16))),"
    echo "  '$(escape_sql_literal "${checksum}")',"
    echo "  CURRENT_TIMESTAMP,"
    echo "  '$(escape_sql_literal "${migration_name}")',"
    echo "  '',"
    echo "  NULL,"
    echo "  CURRENT_TIMESTAMP,"
    echo "  1"
    echo ");"
    echo "COMMIT;"
  } >"${temp_sql}"
}

create_migration_table

while IFS= read -r migration_file; do
  migration_name="$(basename "$(dirname "${migration_file}")")"
  checksum="$(shasum -a 256 "${migration_file}" | awk '{print $1}')"
  applied_count="$(
    sqlite_scalar_or_fail \
      "${migration_name}" \
      "SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name='${migration_name}' AND finished_at IS NOT NULL;"
  )"
  ensure_integer_or_fail "${migration_name}" "${applied_count}" "applied_count"
  if [[ "${applied_count}" != "0" ]]; then
    applied_checksum="$(
      sqlite_scalar_or_fail \
        "${migration_name}" \
        "SELECT checksum FROM _prisma_migrations WHERE migration_name='${migration_name}' AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1;"
    )"
    if [[ -z "${applied_checksum}" ]]; then
      echo "[migrate] ERROR ${migration_name}: applied migration is missing checksum metadata" >&2
      exit 1
    fi
    if [[ "${applied_checksum}" != "${checksum}" ]]; then
      echo "[migrate] ERROR ${migration_name}: checksum drift detected." >&2
      echo "[migrate] expected applied checksum: ${applied_checksum}" >&2
      echo "[migrate] current file checksum:   ${checksum}" >&2
      echo "[migrate] add a new migration instead of editing an applied migration." >&2
      exit 1
    fi
    echo "[migrate] skip ${migration_name}"
    continue
  fi

  wrapped_sql="$(mktemp -t exchange-js-migration-apply)"
  create_wrapped_sql "${migration_name}" "${migration_file}" "${checksum}" "${wrapped_sql}"

  echo "[migrate] apply ${migration_name}"
  run_sql_file "${wrapped_sql}"
  rm -f "${wrapped_sql}"
done < <(find "${MIGRATIONS_DIR}" -maxdepth 2 -name migration.sql | sort)

echo "[migrate] schema ready: ${DB_FILE}"
