#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./stack-common.sh
source "${SCRIPT_DIR}/stack-common.sh"

print_stack_row() {
  local stack="$1"
  load_stack_config "${stack}"

  local branch
  if [[ -d "${WT_DIR}" ]]; then
    branch="$(stack_branch)"
  else
    branch="(missing worktree)"
  fi

  local backend_state admin_state client_state
  backend_state="$(service_state "${BACKEND_PORT}" "${BACKEND_PID_FILE}")"
  admin_state="$(service_state "${ADMIN_PORT}" "${ADMIN_PID_FILE}")"
  client_state="$(service_state "${CLIENT_PORT}" "${CLIENT_PID_FILE}")"

  printf "%-8s %-28s %-15s %-15s %-15s %s\n" \
    "${stack}" \
    "${branch}" \
    "${BACKEND_PORT}:${backend_state}" \
    "${ADMIN_PORT}:${admin_state}" \
    "${CLIENT_PORT}:${client_state}" \
    "${BACKEND_URL} | ${ADMIN_URL} | ${CLIENT_URL}"
}

printf "%-8s %-28s %-15s %-15s %-15s %s\n" "stack" "branch" "backend" "admin" "client" "urls"
printf "%s\n" "----------------------------------------------------------------------------------------------------------------------------------------"
print_stack_row main
print_stack_row codex
print_stack_row claude
print_stack_row trae
print_stack_row audit-evidence
