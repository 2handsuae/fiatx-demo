#!/usr/bin/env bash
set -euo pipefail

BACKEND_PORT="${BACKEND_PORT:-3500}"
ADMIN_PORT="${ADMIN_PORT:-3501}"
CLIENT_PORT="${CLIENT_PORT:-3502}"

RUNTIME_DIR="/tmp/exchange_js_dev_runtime_${BACKEND_PORT}"
BACKEND_PID_FILE="${RUNTIME_DIR}/backend.pid"
ADMIN_PID_FILE="${RUNTIME_DIR}/admin.pid"
CLIENT_PID_FILE="${RUNTIME_DIR}/client.pid"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

terminate_pid() {
  local name="$1"
  local pid="$2"

  if ! kill -0 "${pid}" 2>/dev/null; then
    echo "[${name}] Process ${pid} is not running."
    return 0
  fi

  echo "[${name}] Stopping pid ${pid}..."
  kill "${pid}" 2>/dev/null || true

  for _ in {1..20}; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done

  if kill -0 "${pid}" 2>/dev/null; then
    echo "[${name}] Still running, force kill ${pid}."
    kill -9 "${pid}" 2>/dev/null || true
  fi

  echo "[${name}] Stopped."
}

stop_process() {
  local name="$1"
  local pid_file="$2"
  local port="$3"
  local expected_hint="$4"

  local handled="false"
  if [[ -f "${pid_file}" ]]; then
    local pid
    pid="$(cat "${pid_file}")"
    if [[ -n "${pid}" ]]; then
      terminate_pid "${name}" "${pid}"
      handled="true"
    else
      echo "[${name}] Empty pid file."
    fi
    rm -f "${pid_file}"
  fi

  local fallback_pid
  fallback_pid="$(lsof -tiTCP:"${port}" -sTCP:LISTEN | head -n 1 || true)"
  if [[ -z "${fallback_pid}" ]]; then
    if [[ "${handled}" == "false" ]]; then
      echo "[${name}] No running listener on port ${port}, skip."
    fi
    return 0
  fi

  local command_line
  command_line="$(ps -p "${fallback_pid}" -o command= 2>/dev/null || true)"
  if [[ "${command_line}" == *"${expected_hint}"* ]]; then
    echo "[${name}] Found managed fallback pid ${fallback_pid} on port ${port}."
    terminate_pid "${name}" "${fallback_pid}"
  else
    echo "[${name}] Port ${port} is used by non-managed process (pid ${fallback_pid}), skip."
  fi
}

stop_process "backend" "${BACKEND_PID_FILE}" "${BACKEND_PORT}" "/Exchange_js/dist/main"
stop_process "admin" "${ADMIN_PID_FILE}" "${ADMIN_PORT}" "--port ${ADMIN_PORT}"
stop_process "client" "${CLIENT_PID_FILE}" "${CLIENT_PORT}" "--port ${CLIENT_PORT}"

cleanup_orphans_by_pattern() {
  local name="$1"
  local pattern="$2"
  local pids
  pids="$(pgrep -f "${pattern}" || true)"
  if [[ -z "${pids}" ]]; then
    return 0
  fi

  while IFS= read -r pid; do
    [[ -z "${pid}" ]] && continue
    terminate_pid "${name}" "${pid}"
  done <<< "${pids}"
}

# Catch watcher parent processes that may survive after listener process exits.
cleanup_orphans_by_pattern "backend-orphan" "/Exchange_js/node_modules/.bin/nest start --watch"
cleanup_orphans_by_pattern "admin-orphan" "/Exchange_js/admin-web/node_modules/.bin/vite --port ${ADMIN_PORT}"
cleanup_orphans_by_pattern "client-orphan" "/Exchange_js/client-web/node_modules/.bin/vite --port ${CLIENT_PORT}"

echo "All dev services stopped."
