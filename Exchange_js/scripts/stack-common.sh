#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

STACK=""
WT_DIR=""
APP_DIR=""
BACKEND_PORT=""
ADMIN_PORT=""
CLIENT_PORT=""
BACKEND_URL=""
ADMIN_URL=""
CLIENT_URL=""
BRANCH_RULE=""

RUNTIME_DIR=""
BACKEND_LOG=""
ADMIN_LOG=""
CLIENT_LOG=""
BACKEND_PID_FILE=""
ADMIN_PID_FILE=""
CLIENT_PID_FILE=""

usage_stack_name() {
  echo "Usage: $0 <main|codex|claude|trae>" >&2
}

load_stack_config() {
  local stack="$1"
  case "$stack" in
    main)
      STACK="main"
      WT_DIR="${ROOT_DIR}"
      APP_DIR="${ROOT_DIR}/Exchange_js"
      BACKEND_PORT="3000"
      ADMIN_PORT="3001"
      CLIENT_PORT="3002"
      BRANCH_RULE="main"
      ;;
    codex)
      STACK="codex"
      WT_DIR="${ROOT_DIR}/.wt/codex"
      APP_DIR="${WT_DIR}/Exchange_js"
      BACKEND_PORT="3100"
      ADMIN_PORT="3101"
      CLIENT_PORT="3102"
      BRANCH_RULE="codex/*"
      ;;
    claude)
      STACK="claude"
      WT_DIR="${ROOT_DIR}/.wt/claude"
      APP_DIR="${WT_DIR}/Exchange_js"
      BACKEND_PORT="3200"
      ADMIN_PORT="3201"
      CLIENT_PORT="3202"
      BRANCH_RULE="claude/*"
      ;;
    trae)
      STACK="trae"
      WT_DIR="${ROOT_DIR}/.wt/trae"
      APP_DIR="${WT_DIR}/Exchange_js"
      BACKEND_PORT="3300"
      ADMIN_PORT="3301"
      CLIENT_PORT="3302"
      BRANCH_RULE="trae/*"
      ;;
    *)
      usage_stack_name
      return 1
      ;;
  esac

  BACKEND_URL="http://localhost:${BACKEND_PORT}"
  ADMIN_URL="http://localhost:${ADMIN_PORT}"
  CLIENT_URL="http://localhost:${CLIENT_PORT}"

  RUNTIME_DIR="/tmp/exchange_js_runtime_${STACK}"
  BACKEND_LOG="${RUNTIME_DIR}/backend.log"
  ADMIN_LOG="${RUNTIME_DIR}/admin.log"
  CLIENT_LOG="${RUNTIME_DIR}/client.log"
  BACKEND_PID_FILE="${RUNTIME_DIR}/backend.pid"
  ADMIN_PID_FILE="${RUNTIME_DIR}/admin.pid"
  CLIENT_PID_FILE="${RUNTIME_DIR}/client.pid"
}

require_commands() {
  local missing=0
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "Missing required command: $cmd" >&2
      missing=1
    fi
  done

  if [[ "$missing" -ne 0 ]]; then
    return 1
  fi
}

assert_stack_paths() {
  if [[ ! -d "${WT_DIR}" ]]; then
    echo "Missing worktree: ${WT_DIR}" >&2
    return 1
  fi

  if [[ ! -d "${APP_DIR}" ]]; then
    echo "Missing app directory: ${APP_DIR}" >&2
    return 1
  fi

  if [[ ! -f "${APP_DIR}/package.json" ]]; then
    echo "Missing backend package.json: ${APP_DIR}/package.json" >&2
    return 1
  fi

  if [[ ! -f "${APP_DIR}/admin-web/package.json" ]]; then
    echo "Missing admin package.json: ${APP_DIR}/admin-web/package.json" >&2
    return 1
  fi

  if [[ ! -f "${APP_DIR}/client-web/package.json" ]]; then
    echo "Missing client package.json: ${APP_DIR}/client-web/package.json" >&2
    return 1
  fi
}

stack_branch() {
  git -C "${WT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(unknown)"
}

assert_branch_rule() {
  local branch
  branch="$(stack_branch)"

  if [[ "${BRANCH_RULE}" == "main" ]]; then
    if [[ "${branch}" != "main" ]]; then
      echo "[${STACK}] expected branch main, got: ${branch}" >&2
      return 1
    fi
    return 0
  fi

  case "${branch}" in
    ${STACK}/*)
      return 0
      ;;
    *)
      echo "[${STACK}] expected branch prefix ${STACK}/, got: ${branch}" >&2
      return 1
      ;;
  esac
}

ensure_dependencies() {
  local name="$1"
  local dir="$2"

  if [[ -d "${dir}/node_modules" ]]; then
    return 0
  fi

  echo "[${STACK}/${name}] node_modules missing, installing dependencies..."
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

ensure_env_files() {
  local backend_env="${APP_DIR}/.env"
  local admin_env="${APP_DIR}/admin-web/.env"
  local client_env="${APP_DIR}/client-web/.env"

  if [[ ! -f "${backend_env}" ]]; then
    cat >"${backend_env}" <<ENV
API_PORT=${BACKEND_PORT}
ADMIN_PORT=${ADMIN_PORT}
CLIENT_PORT=${CLIENT_PORT}

API_URL=${BACKEND_URL}
ADMIN_URL=${ADMIN_URL}
CLIENT_URL=${CLIENT_URL}

DATABASE_URL="file:./dev.db"
ENV
    echo "[${STACK}] created ${backend_env}"
  fi

  if [[ ! -f "${admin_env}" ]]; then
    cat >"${admin_env}" <<ENV
VITE_API_URL=${BACKEND_URL}
ENV
    echo "[${STACK}] created ${admin_env}"
  fi

  if [[ ! -f "${client_env}" ]]; then
    cat >"${client_env}" <<ENV
VITE_API_URL=${BACKEND_URL}
ENV
    echo "[${STACK}] created ${client_env}"
  fi
}

resolve_db_file() {
  local db_url=""
  local env_file="${APP_DIR}/.env"
  local prisma_dir="${APP_DIR}/prisma"

  if [[ -f "${env_file}" ]]; then
    db_url="$(grep -E '^DATABASE_URL=' "${env_file}" | tail -n 1 | cut -d'=' -f2- | tr -d '"' || true)"
  fi

  if [[ -z "${db_url}" ]]; then
    db_url='file:./dev.db'
  fi

  if [[ "${db_url}" == file:* ]]; then
    local raw_path="${db_url#file:}"
    if [[ "${raw_path}" = /* ]]; then
      echo "${raw_path}"
    else
      echo "${prisma_dir}/${raw_path#./}"
    fi
    return 0
  fi

  echo "${prisma_dir}/dev.db"
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
  local should_seed_business="false"

  if ! db_has_required_tables "${db_file}"; then
    should_seed_business="true"
  fi

  mkdir -p "$(dirname "${db_file}")"
  : > "${db_file}"
  echo "[${STACK}] applying pending Prisma migrations to ${db_file}"
  (
    cd "${APP_DIR}"
    DATABASE_URL="file:${db_file}" npx prisma migrate deploy
  )

  if [[ "${should_seed_business}" == "true" ]]; then
    echo "[${STACK}] seeding minimal business dataset..."
    (
      cd "${APP_DIR}"
      DATABASE_URL="file:${db_file}" npm run db:biz:init
    )
  fi
}

ensure_port_free() {
  local port="$1"
  local name="$2"

  if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    local pid
    local command_line
    pid="$(lsof -tiTCP:"${port}" -sTCP:LISTEN | head -n 1 || true)"
    command_line="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
    echo "[${STACK}/${name}] port ${port} is already in use by pid ${pid}" >&2
    if [[ -n "${command_line}" ]]; then
      echo "[${STACK}/${name}] command: ${command_line}" >&2
    fi
    return 1
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
      echo "[${STACK}/${name}] listening on ${port} (pid ${pid})"
      return 0
    fi
    sleep 0.5
  done

  echo "[${STACK}/${name}] failed to detect listener on ${port}" >&2
  return 1
}

terminate_pid() {
  local name="$1"
  local pid="$2"

  if [[ -z "${pid}" ]]; then
    return 0
  fi

  if ! kill -0 "${pid}" 2>/dev/null; then
    return 0
  fi

  echo "[${STACK}/${name}] stopping pid ${pid}"
  kill "${pid}" 2>/dev/null || true

  for _ in {1..20}; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done

  if kill -0 "${pid}" 2>/dev/null; then
    kill -9 "${pid}" 2>/dev/null || true
  fi
}

stop_pid_file_process() {
  local name="$1"
  local pid_file="$2"

  if [[ ! -f "${pid_file}" ]]; then
    return 0
  fi

  local pid
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  terminate_pid "${name}" "${pid}"
  rm -f "${pid_file}"
}

cleanup_orphans_by_pattern() {
  local name="$1"
  local pattern="$2"
  local pids

  pids="$(pgrep -f "${pattern}" 2>/dev/null || true)"
  if [[ -z "${pids}" ]]; then
    return 0
  fi

  while IFS= read -r pid; do
    [[ -z "${pid}" ]] && continue
    terminate_pid "${name}" "${pid}"
  done <<<"${pids}"
}

service_state() {
  local port="$1"
  local pid_file="$2"

  local listen_pid
  listen_pid="$(lsof -tiTCP:"${port}" -sTCP:LISTEN | head -n 1 || true)"
  if [[ -n "${listen_pid}" ]]; then
    echo "up:${listen_pid}"
    return 0
  fi

  if [[ -f "${pid_file}" ]]; then
    local pid
    pid="$(cat "${pid_file}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      echo "booting:${pid}"
      return 0
    fi
  fi

  echo "down"
}
