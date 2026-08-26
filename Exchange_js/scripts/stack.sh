#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat >&2 <<USAGE
Usage:
  $0 up [main|self]       # self (default) = boot the worktree you're in
  $0 down [main|self]
  $0 status
  $0 reset [main|self]    # full business reset incl. TigerBeetle wipe (self = the worktree you're in)
  $0 reset-main           # alias of: reset main
USAGE
}

is_valid_stack() {
  case "$1" in
    main|self) return 0 ;;
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
    target="${2:-self}"
    if ! is_valid_stack "${target}"; then
      usage
      exit 1
    fi
    bash "${SCRIPT_DIR}/stack-up.sh" "${target}"
    ;;
  down)
    target="${2:-self}"
    if ! is_valid_stack "${target}"; then
      usage
      exit 1
    fi
    bash "${SCRIPT_DIR}/stack-stop.sh" "${target}"
    ;;
  status)
    if [[ $# -ne 1 ]]; then
      usage
      exit 1
    fi
    bash "${SCRIPT_DIR}/stack-status.sh"
    ;;
  reset)
    target="${2:-self}"
    if ! is_valid_stack "${target}"; then
      usage
      exit 1
    fi
    bash "${SCRIPT_DIR}/reset-stack.sh" "${target}"
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
