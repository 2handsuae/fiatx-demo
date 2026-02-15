#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

RUNTIME_DIR="/tmp/exchange_js_dev_runtime"
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
    echo "[backend] Database schema exists: ${db_file}"
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

  echo "[backend] Seeding minimal business dataset..."
  (
    cd "${BACKEND_DIR}"
    DATABASE_URL="file:${db_file}" npm run db:biz:init
  )
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

bash "${SCRIPT_DIR}/dev-stop-all.sh" >/dev/null 2>&1 || true
rm -f "${BACKEND_PID_FILE}" "${ADMIN_PID_FILE}" "${CLIENT_PID_FILE}"

assert_port_free "3000" "backend"
assert_port_free "3001" "admin"
assert_port_free "3002" "client"

echo "Starting backend on 3000..."
(
  cd "${BACKEND_DIR}"
  API_PORT=3000 \
  ADMIN_URL="http://localhost:3001" \
  CLIENT_URL="http://localhost:3002" \
  npm run start:dev >"${BACKEND_LOG}" 2>&1
) &

echo "Starting admin on 3001..."
(
  cd "${ADMIN_DIR}"
  VITE_API_URL="http://localhost:3000" \
  npm run dev -- --port 3001 >"${ADMIN_LOG}" 2>&1
) &

echo "Starting client on 3002..."
(
  cd "${CLIENT_DIR}"
  VITE_API_URL="http://localhost:3000" \
  npm run dev -- --port 3002 >"${CLIENT_LOG}" 2>&1
) &

capture_listener_pid "backend" "3000" "${BACKEND_PID_FILE}"
capture_listener_pid "admin" "3001" "${ADMIN_PID_FILE}"
capture_listener_pid "client" "3002" "${CLIENT_PID_FILE}"

echo "All services started."
echo "API:   http://localhost:3000"
echo "Admin: http://localhost:3001"
echo "Client:http://localhost:3002"
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
