#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./stack-common.sh
source "${SCRIPT_DIR}/stack-common.sh"
# shellcheck source=./db-env.sh
source "${SCRIPT_DIR}/db-env.sh"

if [[ $# -ne 1 ]]; then
  usage_stack_name
  exit 1
fi

load_stack_config "$1"

require_commands node npm lsof sqlite3 git
assert_stack_paths
assert_branch_rule

mkdir -p "${RUNTIME_DIR}"

ensure_env_files
ensure_dependencies "backend" "${APP_DIR}"
ensure_dependencies "admin" "${APP_DIR}/admin-web"
ensure_dependencies "client" "${APP_DIR}/client-web"
bootstrap_database_if_needed
DB_URL="$(read_database_url "${APP_DIR}" "${STACK}")"

bash "${SCRIPT_DIR}/stack-stop.sh" "${STACK}" >/dev/null 2>&1 || true
rm -f "${BACKEND_PID_FILE}" "${ADMIN_PID_FILE}" "${CLIENT_PID_FILE}"

ensure_port_free "${BACKEND_PORT}" "backend"
ensure_port_free "${ADMIN_PORT}" "admin"
ensure_port_free "${CLIENT_PORT}" "client"

echo "[${STACK}] starting backend on ${BACKEND_PORT}"
nohup bash -lc \
  "cd \"${APP_DIR}\" && API_PORT=\"${BACKEND_PORT}\" ADMIN_URL=\"${ADMIN_URL}\" CLIENT_URL=\"${CLIENT_URL}\" DATABASE_URL=\"${DB_URL}\" GOVERNANCE_DEMO_ENABLED=\"${GOVERNANCE_DEMO_ENABLED:-true}\" npm run start" \
  >"${BACKEND_LOG}" 2>&1 &

echo "[${STACK}] starting admin on ${ADMIN_PORT}"
nohup bash -lc \
  "cd \"${APP_DIR}/admin-web\" && VITE_API_URL=\"${BACKEND_URL}\" npm run dev -- --port \"${ADMIN_PORT}\"" \
  >"${ADMIN_LOG}" 2>&1 &

echo "[${STACK}] starting client on ${CLIENT_PORT}"
nohup bash -lc \
  "cd \"${APP_DIR}/client-web\" && VITE_API_URL=\"${BACKEND_URL}\" npm run dev -- --port \"${CLIENT_PORT}\"" \
  >"${CLIENT_LOG}" 2>&1 &

capture_listener_pid "backend" "${BACKEND_PORT}" "${BACKEND_PID_FILE}"
capture_listener_pid "admin" "${ADMIN_PORT}" "${ADMIN_PID_FILE}"
capture_listener_pid "client" "${CLIENT_PORT}" "${CLIENT_PID_FILE}"

echo ""
echo "[${STACK}] all services started"
echo "Branch: $(stack_branch)"
echo "API:    ${BACKEND_URL}"
echo "Admin:  ${ADMIN_URL}"
echo "Client: ${CLIENT_URL}"
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
