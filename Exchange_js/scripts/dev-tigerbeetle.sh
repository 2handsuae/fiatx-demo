#!/usr/bin/env bash
# scripts/dev-tigerbeetle.sh — TigerBeetle dev lifecycle helper
set -euo pipefail

# Task 12 fix (2026-08-13): this script used to hardcode the MAIN stack's data
# file/port unconditionally — db:reset:business (scripts/reset-business-complete.sh)
# calls it with NO way to redirect it to a different stack, so running
# `on-stack.sh self db:reset:business` from ANY non-main worktree silently
# stopped, reformatted (wiped), and restarted MAIN's TigerBeetle instead of the
# caller's own — a real incident hit while doing exactly that for this task.
# Worse, `pkill -f "tigerbeetle start"` matched every TigerBeetle process on the
# machine by command-line substring, killing OTHER worktrees' TB processes too
# (their data files were untouched — those just needed a restart, mirrors
# stack-common.sh's/stack-stop.sh's already-correct per-file-scoped pattern).
# Now honors TB_DATA_FILE/TB_ADDRESS from the environment (same variable names
# on-stack.sh already injects for every other npm script), falling back to the
# historic main-only defaults so a bare `bash dev-tigerbeetle.sh <action>` with
# no env still behaves exactly as before. pkill/pgrep now match the specific
# TB_DATA path, not just any "tigerbeetle start" process.
TB_DATA="${TB_DATA_FILE:-/tmp/exchange_js_main/0_0.tigerbeetle}"
TB_ADDR="${TB_ADDRESS:-127.0.0.1:3003}"
TB_MATCH="tigerbeetle start.*${TB_DATA}"
ACTION="${1:-help}"

case "$ACTION" in
  start)
    if pgrep -f "${TB_MATCH}" > /dev/null 2>&1; then
      echo "TigerBeetle already running for ${TB_DATA}."
      exit 0
    fi
    if [ ! -f "$TB_DATA" ]; then
      echo "Formatting TigerBeetle data file..."
      mkdir -p "$(dirname "$TB_DATA")"
      tigerbeetle format --cluster=0 --replica=0 --replica-count=1 "$TB_DATA"
    fi
    echo "Starting TigerBeetle at $TB_ADDR..."
    tigerbeetle start --development --addresses="$TB_ADDR" "$TB_DATA" &
    sleep 1
    echo "TigerBeetle started (PID: $!)."
    ;;
  stop)
    if pkill -f "${TB_MATCH}" 2>/dev/null; then
      echo "TigerBeetle stopped (${TB_DATA})."
    else
      echo "TigerBeetle not running (${TB_DATA})."
    fi
    ;;
  format)
    "$0" stop
    rm -f "$TB_DATA"
    echo "Formatting fresh TigerBeetle data file..."
    mkdir -p "$(dirname "$TB_DATA")"
    tigerbeetle format --cluster=0 --replica=0 --replica-count=1 "$TB_DATA"
    echo "TigerBeetle data file formatted."
    ;;
  status)
    if pgrep -f "${TB_MATCH}" > /dev/null 2>&1; then
      echo "TigerBeetle is running (${TB_DATA})."
    else
      echo "TigerBeetle is not running (${TB_DATA})."
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|format|status}"
    exit 1
    ;;
esac
