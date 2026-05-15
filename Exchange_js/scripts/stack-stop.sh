#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./stack-common.sh
source "${SCRIPT_DIR}/stack-common.sh"

if [[ $# -ne 1 ]]; then
  usage_stack_name
  exit 1
fi

load_stack_config "$1"
mkdir -p "${RUNTIME_DIR}"

stop_pid_file_process "backend" "${BACKEND_PID_FILE}"
stop_pid_file_process "admin" "${ADMIN_PID_FILE}"
stop_pid_file_process "client" "${CLIENT_PID_FILE}"
stop_pid_file_process "tb" "${TB_PID_FILE}"

stop_listener_if_managed() {
  local name="$1"
  local port="$2"

  local pid
  local command_line
  pid="$(lsof -tiTCP:"${port}" -sTCP:LISTEN | head -n 1 || true)"
  if [[ -z "${pid}" ]]; then
    return 0
  fi

  command_line="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
  if [[ "${command_line}" == *"${APP_DIR}"* ]]; then
    terminate_pid "${name}" "${pid}"
  else
    echo "[${STACK}/${name}] port ${port} owned by non-managed process pid ${pid}, skip"
  fi
}

stop_listener_if_managed "backend" "${BACKEND_PORT}"
stop_listener_if_managed "admin" "${ADMIN_PORT}"
stop_listener_if_managed "client" "${CLIENT_PORT}"

cleanup_orphans_by_pattern "backend-orphan" "${APP_DIR}/dist/main"
cleanup_orphans_by_pattern "admin-orphan" "${APP_DIR}/admin-web/node_modules/.bin/vite --host 0.0.0.0 --port ${ADMIN_PORT}"
cleanup_orphans_by_pattern "client-orphan" "${APP_DIR}/client-web/node_modules/.bin/vite --host 0.0.0.0 --port ${CLIENT_PORT}"
cleanup_orphans_by_pattern "tb-orphan" "tigerbeetle start.*${TB_DATA_FILE}"

echo "[${STACK}] services stopped"
