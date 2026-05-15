#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./db-env.sh
source "${SCRIPT_DIR}/db-env.sh"
CURRENT_WT_DIR="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${CURRENT_WT_DIR}" ]]; then
  CURRENT_WT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
fi

GIT_COMMON_DIR="$(
  git -C "${SCRIPT_DIR}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null ||
    echo "${CURRENT_WT_DIR}/.git"
)"
ROOT_DIR="$(cd "${GIT_COMMON_DIR}/.." && pwd)"

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

TB_PORT=""
TB_DATA_FILE=""
TB_ADDRESS=""

RUNTIME_DIR=""
BACKEND_LOG=""
ADMIN_LOG=""
CLIENT_LOG=""
TB_LOG=""
BACKEND_PID_FILE=""
ADMIN_PID_FILE=""
CLIENT_PID_FILE=""
TB_PID_FILE=""

usage_stack_name() {
  echo "Usage: $0 <main|codex|claude|trae|audit-evidence>" >&2
}

load_stack_config() {
  local stack="$1"
  local current_branch
  current_branch="$(git -C "${CURRENT_WT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "*")"
  case "$stack" in
    main)
      STACK="main"
      if [[ "${CURRENT_WT_DIR}" == "${ROOT_DIR}" ]]; then
        WT_DIR="${ROOT_DIR}"
        APP_DIR="${ROOT_DIR}/Exchange_js"
        BRANCH_RULE="main"
      else
        WT_DIR="${CURRENT_WT_DIR}"
        APP_DIR="${WT_DIR}/Exchange_js"
        BRANCH_RULE="${current_branch}"
      fi
      BACKEND_PORT="3000"
      ADMIN_PORT="3001"
      CLIENT_PORT="3002"
      TB_PORT="3003"
      TB_DATA_FILE="/tmp/exchange_js_main/0_0.tigerbeetle"
      ;;
    codex)
      STACK="codex"
      WT_DIR="${ROOT_DIR}/.wt/codex"
      APP_DIR="${WT_DIR}/Exchange_js"
      BACKEND_PORT="3100"
      ADMIN_PORT="3101"
      CLIENT_PORT="3102"
      BRANCH_RULE="codex/*"
      TB_PORT="3103"
      TB_DATA_FILE="/tmp/exchange_js_codex/0_0.tigerbeetle"
      ;;
    claude)
      STACK="claude"
      WT_DIR="${ROOT_DIR}/.wt/claude"
      APP_DIR="${WT_DIR}/Exchange_js"
      BACKEND_PORT="3200"
      ADMIN_PORT="3201"
      CLIENT_PORT="3202"
      BRANCH_RULE="claude/*"
      TB_PORT="3203"
      TB_DATA_FILE="/tmp/exchange_js_claude/0_0.tigerbeetle"
      ;;
    trae)
      STACK="trae"
      WT_DIR="${ROOT_DIR}/.wt/trae"
      APP_DIR="${WT_DIR}/Exchange_js"
      BACKEND_PORT="3300"
      ADMIN_PORT="3301"
      CLIENT_PORT="3302"
      BRANCH_RULE="trae/*"
      TB_PORT="3303"
      TB_DATA_FILE="/tmp/exchange_js_trae/0_0.tigerbeetle"
      ;;
    branch)
      STACK="branch"
      WT_DIR="${ROOT_DIR}/.wt/branch"
      APP_DIR="${WT_DIR}/Exchange_js"
      BACKEND_PORT="3500"
      ADMIN_PORT="3501"
      CLIENT_PORT="3502"
      BRANCH_RULE="branch"
      TB_PORT="3503"
      TB_DATA_FILE="/tmp/exchange_js_branch/0_0.tigerbeetle"
      ;;
    audit-evidence)
      STACK="audit-evidence"
      WT_DIR="${ROOT_DIR}/.wt/codex/branch"
      APP_DIR="${WT_DIR}/Exchange_js"
      BACKEND_PORT="3500"
      ADMIN_PORT="3501"
      CLIENT_PORT="3502"
      BRANCH_RULE="codex/branch"
      TB_PORT="3503"
      TB_DATA_FILE="/tmp/exchange_js_branch/0_0.tigerbeetle"
      ;;
    *)
      usage_stack_name
      return 1
      ;;
  esac

  BACKEND_URL="http://localhost:${BACKEND_PORT}"
  ADMIN_URL="http://localhost:${ADMIN_PORT}"
  CLIENT_URL="http://localhost:${CLIENT_PORT}"
  TB_ADDRESS="127.0.0.1:${TB_PORT}"

  RUNTIME_DIR="/tmp/exchange_js_runtime_${STACK}"
  BACKEND_LOG="${RUNTIME_DIR}/backend.log"
  ADMIN_LOG="${RUNTIME_DIR}/admin.log"
  CLIENT_LOG="${RUNTIME_DIR}/client.log"
  TB_LOG="${RUNTIME_DIR}/tb.log"
  BACKEND_PID_FILE="${RUNTIME_DIR}/backend.pid"
  ADMIN_PID_FILE="${RUNTIME_DIR}/admin.pid"
  CLIENT_PID_FILE="${RUNTIME_DIR}/client.pid"
  TB_PID_FILE="${RUNTIME_DIR}/tb.pid"
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

  case "${branch}" in
    ${BRANCH_RULE})
      return 0
      ;;
    *)
      echo "[${STACK}] expected branch rule ${BRANCH_RULE}, got: ${branch}" >&2
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
  local default_db_url
  default_db_url="$(default_database_url "${STACK}")"

  if [[ ! -f "${backend_env}" ]]; then
    cat >"${backend_env}" <<ENV
API_PORT=${BACKEND_PORT}
ADMIN_PORT=${ADMIN_PORT}
CLIENT_PORT=${CLIENT_PORT}

API_URL=${BACKEND_URL}
ADMIN_URL=${ADMIN_URL}
CLIENT_URL=${CLIENT_URL}

DATABASE_URL="${default_db_url}"
GOVERNANCE_DEMO_ENABLED=true
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
  local db_url
  db_url="$(read_database_url "${APP_DIR}" "${STACK}")"
  resolve_db_file_from_url "${APP_DIR}" "${db_url}"
}

db_needs_seed_data() {
  local db_file="$1"
  local required_tables=("users" "roles" "permissions")

  if [[ ! -f "${db_file}" ]]; then
    echo "[${STACK}] seed check: database file is missing (${db_file})"
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
      echo "[${STACK}] seed check: required table '${table}' is missing"
      return 0
    fi

    local row_count
    row_count="$(sqlite3 "${db_file}" "SELECT COUNT(*) FROM ${table};" 2>/dev/null || echo "0")"
    if ! [[ "${row_count}" =~ ^[0-9]+$ ]] || [[ "${row_count}" -eq 0 ]]; then
      echo "[${STACK}] seed check: table '${table}' has no baseline rows"
      return 0
    fi
  done

  return 1
}

bootstrap_database_if_needed() {
  local db_file
  local db_url
  db_file="$(resolve_db_file)"
  db_url="$(read_database_url "${APP_DIR}" "${STACK}")"

  mkdir -p "$(dirname "${db_file}")"
  echo "[${STACK}] applying pending Prisma migrations to ${db_file}"
  (
    cd "${APP_DIR}"
    DATABASE_URL="${db_url}" bash scripts/apply-local-migrations.sh "${APP_DIR}" "${STACK}"
  )

  if db_needs_seed_data "${db_file}"; then
    echo "[${STACK}] missing base IAM baseline, running db:base:sync..."
    (
      cd "${APP_DIR}"
      DATABASE_URL="${db_url}" npm run db:base:sync
    )

    if db_needs_seed_data "${db_file}"; then
      echo "[${STACK}] FATAL: db:base:sync failed, base IAM baseline is still missing." >&2
      exit 1
    fi

    echo "[${STACK}] base IAM baseline sync completed."
  else
    echo "[${STACK}] base IAM baseline verified: ${db_file}"
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
