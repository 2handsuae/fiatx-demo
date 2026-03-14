#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./db-env.sh
source "${SCRIPT_DIR}/db-env.sh"

BACKEND_PORT="${BACKEND_PORT:-3500}"
ADMIN_PORT="${ADMIN_PORT:-3501}"
CLIENT_PORT="${CLIENT_PORT:-3502}"
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
  local db_url
  db_url="$(read_database_url "${ROOT_DIR}" "audit_evidence")"
  resolve_db_file_from_url "${ROOT_DIR}" "${db_url}"
}

db_needs_seed_data() {
  local db_file="$1"
  local required_tables=("users" "roles" "permissions")

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
  local db_url
  db_file="$(resolve_db_file)"
  db_url="$(read_database_url "${ROOT_DIR}" "audit_evidence")"

  mkdir -p "$(dirname "${db_file}")"
  echo "[backend] Applying pending Prisma migrations to ${db_file}..."
  (
    cd "${BACKEND_DIR}"
    DATABASE_URL="${db_url}" bash scripts/apply-local-migrations.sh "${BACKEND_DIR}" "audit_evidence"
  )

  if db_needs_seed_data "${db_file}"; then
    echo "[backend] Missing base IAM baseline. Running db:base:sync..."
    (
      cd "${BACKEND_DIR}"
      DATABASE_URL="${db_url}" npm run db:base:sync
    )

    if db_needs_seed_data "${db_file}"; then
      echo "[backend] FATAL: db:base:sync failed, base IAM baseline is still missing." >&2
      exit 1
    fi

    echo "[backend] Base IAM baseline sync completed."
  else
    echo "[backend] Base IAM baseline verified: ${db_file}"
  fi
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
DB_FILE="$(resolve_db_file)"
DB_URL="$(read_database_url "${ROOT_DIR}" "audit_evidence")"

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
