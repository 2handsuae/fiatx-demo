#!/usr/bin/env bash
# scripts/dev-tigerbeetle.sh — TigerBeetle dev lifecycle helper
set -euo pipefail

TB_DATA="/tmp/exchange_js_branch/0_0.tigerbeetle"
TB_ADDR="127.0.0.1:3503"
ACTION="${1:-help}"

case "$ACTION" in
  start)
    if pgrep -f "tigerbeetle start" > /dev/null 2>&1; then
      echo "TigerBeetle already running."
      exit 0
    fi
    if [ ! -f "$TB_DATA" ]; then
      echo "Formatting TigerBeetle data file..."
      tigerbeetle format --cluster=0 --replica=0 --replica-count=1 "$TB_DATA"
    fi
    echo "Starting TigerBeetle at $TB_ADDR..."
    tigerbeetle start --development --addresses="$TB_ADDR" "$TB_DATA" &
    sleep 1
    echo "TigerBeetle started (PID: $!)."
    ;;
  stop)
    if pkill -f "tigerbeetle start" 2>/dev/null; then
      echo "TigerBeetle stopped."
    else
      echo "TigerBeetle not running."
    fi
    ;;
  format)
    "$0" stop
    rm -f "$TB_DATA"
    echo "Formatting fresh TigerBeetle data file..."
    tigerbeetle format --cluster=0 --replica=0 --replica-count=1 "$TB_DATA"
    echo "TigerBeetle data file formatted."
    ;;
  status)
    if pgrep -f "tigerbeetle start" > /dev/null 2>&1; then
      echo "TigerBeetle is running."
    else
      echo "TigerBeetle is not running."
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|format|status}"
    exit 1
    ;;
esac
