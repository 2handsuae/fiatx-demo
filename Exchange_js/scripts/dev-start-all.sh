#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

BACKEND_PORT="${BACKEND_PORT:-3100}"
ADMIN_PORT="${ADMIN_PORT:-3101}"
CLIENT_PORT="${CLIENT_PORT:-3102}"
BACKEND_URL="http://localhost:${BACKEND_PORT}"
ADMIN_URL="http://localhost:${ADMIN_PORT}"
CLIENT_URL="http://localhost:${CLIENT_PORT}"

RUNTIME_DIR="/tmp/exchange_js_dev_runtime_${BACKEND_PORT}"
BACKEND_LOG="${RUNTIME_DIR}/backend.log"
ADMIN_LOG="${RUNTIME_DIR}/admin.log"
CLIENT_LOG="${RUNTIME_DIR}/client.log"
BACKEND_PID_FILE="${RUNTIME_DIR}/backend.pid"
ADMIN_PID_FILE="${RUNTIME_DIR}/admin.pid"
CLIENT_PID_FILE="${RUNTIME_DIR}/client.pid"

BACKEND_DIR="${ROOT_DIR}"
ADMIN_DIR="${ROOT_DIR}/admin-web"
CLIENT_DIR="${ROOT_DIR}/client-web"
MIGRATIONS_DIR="${ROOT_DIR}/prisma/migrations"
PRISMA_DIR="${ROOT_DIR}/prisma"

ensure_dependencies() {
  local name="$1"
  local dir="$2"
  if [[ -d "${dir}/node_modules" ]]; then
    return 0
  fi

  if [[ ! -f "${dir}/package.json" ]]; then
    echo "[${name}] Missing package.json in ${dir}, cannot install dependencies."
    exit 1
  fi

  echo "[${name}] node_modules missing, installing dependencies..."
  if [[ -f "${dir}/package-lock.json" ]]; then
    (
      cd "${dir}"
      npm ci
    )
  else
    (
      cd "${dir}"
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
    echo "${PRISMA_DIR}/dev.db"
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

db_needs_seed_data() {
  local db_file="$1"
  local required_tables=("users" "roles" "permissions" "customer_main")

  if [[ ! -f "${db_file}" ]]; then
    echo "[backend] Seed check: database file is missing (${db_file})."
    return 0
  fi

  for table in "${required_tables[@]}"; do
    local table_exists
    table_exists="$(
      sqlite3 "${db_file}" \
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${table}';" \
        2>/dev/null || echo "0"
    )"
    if [[ "${table_exists}" != "1" ]]; then
      echo "[backend] Seed check: required table '${table}' is missing."
      return 0
    fi

    local row_count
    row_count="$(sqlite3 "${db_file}" "SELECT COUNT(*) FROM ${table};" 2>/dev/null || echo "0")"
    if ! [[ "${row_count}" =~ ^[0-9]+$ ]] || [[ "${row_count}" -eq 0 ]]; then
      echo "[backend] Seed check: table '${table}' has no baseline rows."
      return 0
    fi
  done

  return 1
}

bootstrap_database_if_needed() {
  local db_file
  db_file="$(resolve_db_file)"

  mkdir -p "$(dirname "${db_file}")"
  echo "[backend] Applying pending Prisma migrations to ${db_file}..."
  (
    cd "${BACKEND_DIR}"
    DATABASE_URL="file:${db_file}" npx prisma migrate deploy
  )

  if db_needs_seed_data "${db_file}"; then
    echo "[backend] Missing login baseline data. Running seed auto-heal..."
    (
      cd "${BACKEND_DIR}"
      DATABASE_URL="file:${db_file}" npm run db:biz:init
    )

    if db_needs_seed_data "${db_file}"; then
      echo "[backend] FATAL: seed auto-heal failed, login baseline data is still missing." >&2
      exit 1
    fi

    echo "[backend] Seed auto-heal completed."
  else
    echo "[backend] Login baseline data verified: ${db_file}"
  fi
}

ensure_audit_log_schema() {
  local db_file
  db_file="$(resolve_db_file)"
  local migration_file="${MIGRATIONS_DIR}/20260218172000_audit_log_subject_no_enhancement/migration.sql"

  if [[ ! -f "${db_file}" ]]; then
    return 0
  fi

  if [[ ! -f "${migration_file}" ]]; then
    return 0
  fi

  local has_actor_no
  has_actor_no="$(sqlite3 "${db_file}" "PRAGMA table_info('audit_log_events');" 2>/dev/null | grep -c '|actorNo|')"
  local has_subject_table
  has_subject_table="$(sqlite3 "${db_file}" ".tables" 2>/dev/null | grep -c 'audit_log_subject_nos')"

  if [[ "${has_actor_no}" -gt 0 && "${has_subject_table}" -gt 0 ]]; then
    return 0
  fi

  echo "[backend] Applying audit log subject-no migration to ${db_file}..."
  sqlite3 "${db_file}" < "${migration_file}"
}

assert_port_free() {
  local port="$1"
  local name="$2"
  if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[${name}] Port ${port} is already in use."
    echo "Run: npm run dev:stop"
    echo "Or stop the process currently using port ${port}."
    exit 1
  fi
}

capture_listener_pid() {
  local name="$1"
  local port="$2"
  local pid_file="$3"

  for _ in {1..120}; do
    local pid
    pid="$(lsof -tiTCP:"${port}" -sTCP:LISTEN | head -n 1 || true)"
    if [[ -n "${pid}" ]]; then
      echo "${pid}" >"${pid_file}"
      echo "[${name}] Listening on ${port} with pid ${pid}."
      return 0
    fi
    sleep 0.5
  done

  echo "[${name}] Failed to detect listener on port ${port}."
  echo "Check logs:"
  echo "  ${BACKEND_LOG}"
  echo "  ${ADMIN_LOG}"
  echo "  ${CLIENT_LOG}"
  exit 1
}

mkdir -p "${RUNTIME_DIR}"

ensure_dependencies "backend" "${BACKEND_DIR}"
ensure_dependencies "admin" "${ADMIN_DIR}"
ensure_dependencies "client" "${CLIENT_DIR}"
bootstrap_database_if_needed
ensure_audit_log_schema
DB_FILE="$(resolve_db_file)"

bash "${SCRIPT_DIR}/dev-stop-all.sh" >/dev/null 2>&1 || true
rm -f "${BACKEND_PID_FILE}" "${ADMIN_PID_FILE}" "${CLIENT_PID_FILE}"

assert_port_free "${BACKEND_PORT}" "backend"
assert_port_free "${ADMIN_PORT}" "admin"
assert_port_free "${CLIENT_PORT}" "client"

echo "Starting backend on ${BACKEND_PORT}..."
echo "Building backend artifacts..."
(
  cd "${BACKEND_DIR}"
  npm run build >"${BACKEND_LOG}" 2>&1
)
nohup env \
  API_PORT="${BACKEND_PORT}" \
  ADMIN_URL="${ADMIN_URL}" \
  CLIENT_URL="${CLIENT_URL}" \
  DATABASE_URL="file:${DB_FILE}" \
  node "${BACKEND_DIR}/dist/main" >>"${BACKEND_LOG}" 2>&1 &

echo "Starting admin on ${ADMIN_PORT}..."
nohup env \
  VITE_API_URL="${BACKEND_URL}" \
  npm --prefix "${ADMIN_DIR}" run dev -- --port "${ADMIN_PORT}" >"${ADMIN_LOG}" 2>&1 &

echo "Starting client on ${CLIENT_PORT}..."
nohup env \
  VITE_API_URL="${BACKEND_URL}" \
  npm --prefix "${CLIENT_DIR}" run dev -- --port "${CLIENT_PORT}" >"${CLIENT_LOG}" 2>&1 &

capture_listener_pid "backend" "${BACKEND_PORT}" "${BACKEND_PID_FILE}"
capture_listener_pid "admin" "${ADMIN_PORT}" "${ADMIN_PID_FILE}"
capture_listener_pid "client" "${CLIENT_PORT}" "${CLIENT_PID_FILE}"

echo "All services started."
echo "API:   ${BACKEND_URL}"
echo "Admin: ${ADMIN_URL}"
echo "Client:${CLIENT_URL}"
echo ""
echo "Logs:"
echo "  ${BACKEND_LOG}"
echo "  ${ADMIN_LOG}"
echo "  ${CLIENT_LOG}"
echo ""
echo "Tail logs:"
echo "  tail -f ${BACKEND_LOG}"
echo "  tail -f ${ADMIN_LOG}"
echo "  tail -f ${CLIENT_LOG}"
