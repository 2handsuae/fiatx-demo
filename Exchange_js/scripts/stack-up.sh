#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./stack-common.sh
source "${SCRIPT_DIR}/stack-common.sh"
# shellcheck source=./db-env.sh
source "${SCRIPT_DIR}/db-env.sh"

# Ensure Node.js >= 20 is on PATH (required by Vite 7).
# If the current node is < 20, try to find a compatible version via nvm.
_node_major="$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)"
if [[ -z "${_node_major}" || "${_node_major}" -lt 20 ]]; then
  _nvm_dir="${NVM_DIR:-${HOME}/.nvm}"
  _node20="$(ls -d "${_nvm_dir}/versions/node"/v20.*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
  _node22="$(ls -d "${_nvm_dir}/versions/node"/v22.*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
  _best_node="${_node22:-${_node20}}"
  if [[ -n "${_best_node}" ]]; then
    export PATH="$(dirname "${_best_node}"):${PATH}"
    echo "[stack] Node $(node --version) loaded from nvm (Vite requires >=20)"
  else
    echo "[stack] WARNING: Node.js >=20 not found; Vite may fail to start" >&2
  fi
fi

if [[ $# -ne 1 ]]; then
  usage_stack_name
  exit 1
fi

load_stack_config "$1"

require_commands node npm lsof sqlite3 git python3 tigerbeetle
assert_stack_paths
assert_branch_rule

mkdir -p "${RUNTIME_DIR}"

launch_detached_service() {
  local workdir="$1"
  local logfile="$2"
  local command_json="$3"
  local env_json="$4"

  python3 - "$workdir" "$logfile" "$command_json" "$env_json" <<'PY'
import json
import os
import subprocess
import sys

workdir, logfile, command_json, env_json = sys.argv[1:]
command = json.loads(command_json)
extra_env = json.loads(env_json)

env = os.environ.copy()
for key, value in extra_env.items():
    env[str(key)] = str(value)

with open(logfile, "ab", buffering=0) as log:
    proc = subprocess.Popen(
        command,
        cwd=workdir,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=log,
        start_new_session=True,
        close_fds=True,
    )

print(proc.pid)
PY
}

ensure_env_files
ensure_dependencies "backend" "${APP_DIR}"
ensure_dependencies "admin" "${APP_DIR}/admin-web"
ensure_dependencies "client" "${APP_DIR}/client-web"
bootstrap_database_if_needed
DB_URL="$(read_database_url "${APP_DIR}" "${STACK}")"

bash "${SCRIPT_DIR}/stack-stop.sh" "${STACK}" >/dev/null 2>&1 || true
rm -f "${BACKEND_PID_FILE}" "${ADMIN_PID_FILE}" "${CLIENT_PID_FILE}" "${TB_PID_FILE}"

ensure_port_free "${BACKEND_PORT}" "backend"
ensure_port_free "${ADMIN_PORT}" "admin"
ensure_port_free "${CLIENT_PORT}" "client"
ensure_port_free "${TB_PORT}" "tb"

echo "[${STACK}] starting TigerBeetle at ${TB_ADDRESS}"
mkdir -p "$(dirname "${TB_DATA_FILE}")"
if [ ! -f "${TB_DATA_FILE}" ]; then
  echo "[${STACK}] formatting new TigerBeetle data file..."
  tigerbeetle format --cluster=0 --replica=0 --replica-count=1 "${TB_DATA_FILE}"
fi
launch_detached_service \
  "/" \
  "${TB_LOG}" \
  "[\"tigerbeetle\",\"start\",\"--development\",\"--addresses=${TB_ADDRESS}\",\"${TB_DATA_FILE}\"]" \
  "{}" \
  >/dev/null
capture_listener_pid "tb" "${TB_PORT}" "${TB_PID_FILE}"

echo "[${STACK}] building backend runtime"
(
  cd "${APP_DIR}"
  npm run build >/dev/null
)

echo "[${STACK}] starting backend on ${BACKEND_PORT}"
launch_detached_service \
  "${APP_DIR}" \
  "${BACKEND_LOG}" \
  "[\"node\",\"dist/main\"]" \
  "{\"API_PORT\":\"${BACKEND_PORT}\",\"ADMIN_URL\":\"${ADMIN_URL}\",\"CLIENT_URL\":\"${CLIENT_URL}\",\"DATABASE_URL\":\"${DB_URL}\",\"TB_ADDRESS\":\"${TB_ADDRESS}\"}" \
  >/dev/null

echo "[${STACK}] starting admin on ${ADMIN_PORT}"
launch_detached_service \
  "${APP_DIR}/admin-web" \
  "${ADMIN_LOG}" \
  "[\"./node_modules/.bin/vite\",\"--host\",\"0.0.0.0\",\"--port\",\"${ADMIN_PORT}\"]" \
  "{\"VITE_API_URL\":\"${BACKEND_URL}\"}" \
  >/dev/null

echo "[${STACK}] starting client on ${CLIENT_PORT}"
launch_detached_service \
  "${APP_DIR}/client-web" \
  "${CLIENT_LOG}" \
  "[\"./node_modules/.bin/vite\",\"--host\",\"0.0.0.0\",\"--port\",\"${CLIENT_PORT}\"]" \
  "{\"VITE_API_URL\":\"${BACKEND_URL}\"}" \
  >/dev/null

capture_listener_pid "backend" "${BACKEND_PORT}" "${BACKEND_PID_FILE}"
capture_listener_pid "admin" "${ADMIN_PORT}" "${ADMIN_PID_FILE}"
capture_listener_pid "client" "${CLIENT_PORT}" "${CLIENT_PID_FILE}"

echo ""
echo "[${STACK}] all services started"
echo "Branch: $(stack_branch)"
echo "API:    ${BACKEND_URL}"
echo "Admin:  ${ADMIN_URL}"
echo "Client: ${CLIENT_URL}"
echo "TB:     ${TB_ADDRESS}"
echo ""
echo "Logs:"
echo "  ${BACKEND_LOG}"
echo "  ${ADMIN_LOG}"
echo "  ${CLIENT_LOG}"
echo "  ${TB_LOG}"
echo ""
echo "Tail logs:"
echo "  tail -f ${BACKEND_LOG}"
echo "  tail -f ${ADMIN_LOG}"
echo "  tail -f ${CLIENT_LOG}"
echo "  tail -f ${TB_LOG}"
