#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./stack-common.sh
source "${SCRIPT_DIR}/stack-common.sh"   # provides ROOT_DIR

port_state() {
  local port="$1"
  local pid
  pid="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -n "${pid}" ]]; then
    echo "up:${pid}"
  else
    echo "down"
  fi
}

print_row() {
  local label="$1" branch="$2" be="$3" ad="$4" cl="$5"
  printf "%-26s %-26s %-14s %-14s %-14s\n" \
    "${label}" "${branch}" \
    "${be}:$(port_state "${be}")" \
    "${ad}:$(port_state "${ad}")" \
    "${cl}:$(port_state "${cl}")"
}

printf "%-26s %-26s %-14s %-14s %-14s\n" "stack" "branch" "backend" "admin" "client"
printf "%s\n" "------------------------------------------------------------------------------------------------------"

# main stack — canonical, runs from the primary worktree on fixed ports 3000-3002.
main_branch="$(git -C "${ROOT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '(unknown)')"
print_row "main" "${main_branch}" 3000 3001 3002

# per-worktree 'self' stacks — one row per worktree that has been booted
# (i.e. has an allocated .stackports). Ports are auto-assigned; base+0/1/2.
for wt in "${ROOT_DIR}"/.claude/worktrees/*/; do
  [[ -d "${wt}" ]] || continue
  pf="${wt%/}/.stackports"
  [[ -f "${pf}" ]] || continue
  base="$(head -n 1 "${pf}" 2>/dev/null | tr -dc '0-9')"
  [[ -n "${base}" ]] || continue
  name="$(basename "${wt%/}")"
  branch="$(git -C "${wt%/}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '(unknown)')"
  print_row "${name}" "${branch}" "${base}" "$(( base + 1 ))" "$(( base + 2 ))"
done
