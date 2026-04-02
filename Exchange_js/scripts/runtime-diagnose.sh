#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
export LANG=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./db-env.sh
source "${SCRIPT_DIR}/db-env.sh"
# shellcheck source=./stack-common.sh
source "${SCRIPT_DIR}/stack-common.sh"

stack="${1:-main}"
if ! load_stack_config "${stack}" >/dev/null 2>&1; then
  usage_stack_name
  exit 1
fi

db_url="$(read_database_url "${APP_DIR}" "${STACK}")"
db_file="$(resolve_db_file_from_url "${APP_DIR}" "${db_url}")"
migrations_dir="${APP_DIR}/prisma/migrations"
tmp_dir="$(mktemp -d -t exchange-js-runtime-diagnose)"
local_rows="${tmp_dir}/local.tsv"
applied_rows="${tmp_dir}/applied.tsv"

cleanup() {
  rm -rf "${tmp_dir}"
}

trap cleanup EXIT

json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  printf '%s' "${value}"
}

json_array() {
  local first="true"
  printf '['
  for item in "$@"; do
    [[ -z "${item}" ]] && continue
    if [[ "${first}" == "false" ]]; then
      printf ','
    fi
    printf '"%s"' "$(json_escape "${item}")"
    first="false"
  done
  printf ']'
}

: >"${local_rows}"
: >"${applied_rows}"

pending_local=()
missing_local=()
checksum_mismatches=()
migration_metadata_error=""

while IFS= read -r migration_file; do
  migration_name="$(basename "$(dirname "${migration_file}")")"
  checksum="$(shasum -a 256 "${migration_file}" | awk '{print $1}')"
  printf '%s|%s\n' "${migration_name}" "${checksum}" >>"${local_rows}"
done < <(find "${migrations_dir}" -maxdepth 2 -name migration.sql | sort)

set_migration_metadata_error() {
  local detail="${1:-unknown sqlite error}"
  if [[ -z "${migration_metadata_error}" ]]; then
    migration_metadata_error="failed to read migration metadata from ${db_file}: ${detail}"
  fi
}

sqlite_scalar_or_note() {
  local __target_var="$1"
  local sql="$2"
  local output
  local error_output
  error_output="$(mktemp -t exchange-js-runtime-diagnose-sqlite-error)"

  if ! output="$(sqlite3 "${db_file}" "${sql}" 2>"${error_output}")"; then
    local detail
    detail="$(tr '\n' ' ' <"${error_output}" | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')"
    rm -f "${error_output}"
    set_migration_metadata_error "${detail:-unknown sqlite error}"
    return 1
  fi

  rm -f "${error_output}"
  printf -v "${__target_var}" '%s' "${output}"
}

sqlite_export_or_note() {
  local sql="$1"
  local output_file="$2"
  local error_output
  error_output="$(mktemp -t exchange-js-runtime-diagnose-sqlite-error)"

  if ! sqlite3 -separator '|' "${db_file}" "${sql}" >"${output_file}" 2>"${error_output}"; then
    local detail
    detail="$(tr '\n' ' ' <"${error_output}" | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')"
    rm -f "${error_output}"
    : >"${output_file}"
    set_migration_metadata_error "${detail:-unknown sqlite error}"
    return 1
  fi

  rm -f "${error_output}"
}

db_exists="false"
latest_applied=""

if [[ -f "${db_file}" ]]; then
  db_exists="true"
  migration_table_exists="0"
  sqlite_scalar_or_note \
    migration_table_exists \
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_prisma_migrations';" || true

  if [[ -n "${migration_table_exists}" && ! "${migration_table_exists}" =~ ^[0-9]+$ ]]; then
    set_migration_metadata_error "invalid migration_table_exists: ${migration_table_exists}"
    migration_table_exists="0"
  fi

  if [[ -z "${migration_metadata_error}" && "${migration_table_exists}" == "1" ]]; then
    sqlite_export_or_note \
      "SELECT migration_name, COALESCE(checksum, '') FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name ASC;" \
      "${applied_rows}"

    latest_applied=""
    sqlite_scalar_or_note \
      latest_applied \
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1;" || true
  fi
fi

lookup_checksum() {
  local rows_file="$1"
  local target_name="$2"
  awk -F'|' -v target="${target_name}" '$1 == target { print $2; exit }' "${rows_file}"
}

while IFS='|' read -r migration_name checksum; do
  [[ -z "${migration_name}" ]] && continue
  applied_checksum="$(lookup_checksum "${applied_rows}" "${migration_name}")"
  if [[ -z "${applied_checksum}" ]]; then
    pending_local+=("${migration_name}")
    continue
  fi

  if [[ "${applied_checksum}" != "${checksum}" ]]; then
    checksum_mismatches+=("${migration_name}")
  fi
done <"${local_rows}"

while IFS='|' read -r migration_name checksum; do
  [[ -z "${migration_name}" ]] && continue
  if [[ -z "$(lookup_checksum "${local_rows}" "${migration_name}")" ]]; then
    missing_local+=("${migration_name}")
  fi
done <"${applied_rows}"

latest_local=""
local_count="$(wc -l <"${local_rows}" | tr -d ' ')"
applied_count="$(wc -l <"${applied_rows}" | tr -d ' ')"
if [[ "${local_count}" -gt 0 ]]; then
  latest_local="$(tail -n 1 "${local_rows}" | cut -d'|' -f1)"
fi

approval_count="0"
change_ticket_count="0"
delete_request_count="0"
sla_timer_count="0"
evidence_package_count="0"

if [[ "${db_exists}" == "true" ]]; then
  approval_count="$(sqlite3 "${db_file}" "SELECT COUNT(*) FROM approval_cases;" 2>/dev/null || echo "0")"
  change_ticket_count="$(sqlite3 "${db_file}" "SELECT COUNT(*) FROM change_tickets;" 2>/dev/null || echo "0")"
  delete_request_count="$(sqlite3 "${db_file}" "SELECT COUNT(*) FROM delete_requests;" 2>/dev/null || echo "0")"
  sla_timer_count="$(sqlite3 "${db_file}" "SELECT COUNT(*) FROM sla_timers;" 2>/dev/null || echo "0")"
  evidence_package_count="$(sqlite3 "${db_file}" "SELECT COUNT(*) FROM audit_evidence_packages;" 2>/dev/null || echo "0")"
fi

cat <<EOF
{
  "stack": "$(json_escape "${STACK}")",
  "cwd": "$(json_escape "${APP_DIR}")",
  "databaseUrl": "$(json_escape "${db_url}")",
  "dbFile": "$(json_escape "${db_file}")",
  "dbExists": ${db_exists},
  "ports": {
    "backend": "${BACKEND_PORT}",
    "admin": "${ADMIN_PORT}",
    "client": "${CLIENT_PORT}"
  },
  "migration": {
    "latestLocal": "$(json_escape "${latest_local}")",
    "latestApplied": "$(json_escape "${latest_applied}")",
    "localCount": ${local_count},
    "appliedCount": ${applied_count},
    "metadataReadError": "$(json_escape "${migration_metadata_error}")",
    "pendingLocal": $(json_array "${pending_local[@]-}"),
    "missingLocal": $(json_array "${missing_local[@]-}"),
    "checksumMismatches": $(json_array "${checksum_mismatches[@]-}"),
    "driftDetected": $([[ -n "${migration_metadata_error}" || "${#pending_local[@]}" -gt 0 || "${#missing_local[@]}" -gt 0 || "${#checksum_mismatches[@]}" -gt 0 ]] && echo "true" || echo "false")
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
