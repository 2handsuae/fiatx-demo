#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat >&2 <<USAGE
Usage:
  $0 up <main|codex|claude|trae|branch|audit-evidence|all>
  $0 down <main|codex|claude|trae|branch|audit-evidence|all>
  $0 status
  $0 reset-main
USAGE
}

is_valid_stack() {
  case "$1" in
    main|codex|claude|trae|branch|audit-evidence) return 0 ;;
    *) return 1 ;;
  esac
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

action="$1"

case "${action}" in
  up)
    if [[ $# -ne 2 ]]; then
      usage
      exit 1
    fi
    target="$2"
    if [[ "${target}" == "all" ]]; then
      for stack in main codex claude trae audit-evidence; do
        bash "${SCRIPT_DIR}/stack-up.sh" "${stack}"
      done
    else
      if ! is_valid_stack "${target}"; then
        usage
        exit 1
      fi
      bash "${SCRIPT_DIR}/stack-up.sh" "${target}"
    fi
    ;;
  down)
    if [[ $# -ne 2 ]]; then
      usage
      exit 1
    fi
    target="$2"
    if [[ "${target}" == "all" ]]; then
      for stack in audit-evidence trae claude codex main; do
        bash "${SCRIPT_DIR}/stack-stop.sh" "${stack}"
      done
    else
      if ! is_valid_stack "${target}"; then
        usage
        exit 1
      fi
      bash "${SCRIPT_DIR}/stack-stop.sh" "${target}"
    fi
    ;;
  status)
    if [[ $# -ne 1 ]]; then
      usage
      exit 1
    fi
    bash "${SCRIPT_DIR}/stack-status.sh"
    ;;
  reset-main)
    if [[ $# -ne 1 ]]; then
      usage
      exit 1
    fi
    bash "${SCRIPT_DIR}/reset-main.sh"
    ;;
  *)
    usage
    exit 1
    ;;
esac
