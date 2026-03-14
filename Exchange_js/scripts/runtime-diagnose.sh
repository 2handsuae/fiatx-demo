#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./db-env.sh
source "${SCRIPT_DIR}/db-env.sh"

db_url="$(read_database_url "${ROOT_DIR}" "audit_evidence")"
db_file="$(resolve_db_file_from_url "${ROOT_DIR}" "${db_url}")"
backend_port="$(grep -E '^API_PORT=' "${ROOT_DIR}/.env" | tail -n 1 | cut -d'=' -f2- || echo "3500")"
admin_port="$(grep -E '^DEV_SERVER_PORT=' "${ROOT_DIR}/admin-web/.env.local" | tail -n 1 | cut -d'=' -f2- || echo "3501")"
client_port="$(grep -E '^DEV_SERVER_PORT=' "${ROOT_DIR}/client-web/.env.local" | tail -n 1 | cut -d'=' -f2- || echo "3502")"

if [[ ! -f "${db_file}" ]]; then
  echo "{\"cwd\":\"${ROOT_DIR}\",\"databaseUrl\":\"${db_url}\",\"dbFile\":\"${db_file}\",\"dbExists\":false,\"backendPort\":\"${backend_port}\",\"adminPort\":\"${admin_port}\",\"clientPort\":\"${client_port}\"}"
  exit 0
fi

latest_migration="$(sqlite3 "${db_file}" "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC, migration_name DESC LIMIT 1;" 2>/dev/null || true)"
approval_count="$(sqlite3 "${db_file}" "SELECT COUNT(*) FROM approval_cases;" 2>/dev/null || echo "0")"
change_ticket_count="$(sqlite3 "${db_file}" "SELECT COUNT(*) FROM change_tickets;" 2>/dev/null || echo "0")"
delete_request_count="$(sqlite3 "${db_file}" "SELECT COUNT(*) FROM delete_requests;" 2>/dev/null || echo "0")"
sla_timer_count="$(sqlite3 "${db_file}" "SELECT COUNT(*) FROM sla_timers;" 2>/dev/null || echo "0")"
evidence_package_count="$(sqlite3 "${db_file}" "SELECT COUNT(*) FROM audit_evidence_packages;" 2>/dev/null || echo "0")"

cat <<EOF
{
  "cwd": "${ROOT_DIR}",
  "databaseUrl": "${db_url}",
  "dbFile": "${db_file}",
  "dbExists": true,
  "migrationHead": "${latest_migration}",
  "ports": {
    "backend": "${backend_port}",
    "admin": "${admin_port}",
    "client": "${client_port}"
  },
  "counts": {
    "approvalCases": ${approval_count},
    "changeTickets": ${change_ticket_count},
    "deleteRequests": ${delete_request_count},
    "slaTimers": ${sla_timer_count},
    "evidencePackages": ${evidence_package_count}
  }
}
EOF
