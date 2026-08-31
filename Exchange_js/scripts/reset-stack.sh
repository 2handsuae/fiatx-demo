#!/usr/bin/env bash
# Stack-parameterised business reset (template).
# Same flow as reset-main.sh, with the stack name threaded through
# `load_stack_config "$1"` instead of hard-wired to `main`. Works for the
# `main` stack and per-worktree `self` stacks.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./stack-common.sh
source "${SCRIPT_DIR}/stack-common.sh"
# shellcheck source=./db-env.sh
source "${SCRIPT_DIR}/db-env.sh"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <stack>" >&2
  exit 1
fi

require_commands sqlite3 npm find git

STACK_NAME="$1"
load_stack_config "${STACK_NAME}"
assert_stack_paths
assert_branch_rule

db_url="$(read_database_url "${APP_DIR}" "${STACK}")"
db_file="$(resolve_db_file)"

echo "[${STACK}] stopping services before business reset"
bash "${SCRIPT_DIR}/stack-stop.sh" "${STACK}" >/dev/null 2>&1 || true

# Wipe TigerBeetle data file alongside the SQLite reset (ported from
# reset-main.sh 2026-08-26 — this block was the missing piece that made
# self-stack resets break the COA identity: TB keeps every transfer ever
# written, so balances drift from a freshly-seeded dev.db).
if [ -n "${TB_DATA_FILE:-}" ] && [ -f "${TB_DATA_FILE}" ]; then
  echo "[${STACK}] wiping TigerBeetle data file: ${TB_DATA_FILE}"
  rm -f "${TB_DATA_FILE}"
fi

# Format + start a fresh TigerBeetle so TB-touching seed steps can connect
# (otherwise seed hangs on TB connect with infinite ConnectionRefused retry).
if [ -n "${TB_DATA_FILE:-}" ] && [ -n "${TB_ADDRESS:-}" ]; then
  mkdir -p "$(dirname "${TB_DATA_FILE}")" "${RUNTIME_DIR:-/tmp}"
  if [ ! -f "${TB_DATA_FILE}" ]; then
    echo "[${STACK}] formatting new TigerBeetle data file..."
    tigerbeetle format --cluster=0 --replica=0 --replica-count=1 "${TB_DATA_FILE}"
  fi
  echo "[${STACK}] starting TigerBeetle at ${TB_ADDRESS}"
  tigerbeetle start --development --addresses="${TB_ADDRESS}" "${TB_DATA_FILE}" \
    > "${TB_LOG:-/tmp/tb-reset-${STACK}.log}" 2>&1 &
  echo $! > "${TB_PID_FILE:-/tmp/tb-reset-${STACK}.pid}"
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if lsof -ti:"${TB_PORT}" >/dev/null 2>&1; then
      echo "[${STACK}] TigerBeetle ready on ${TB_ADDRESS}"
      break
    fi
    sleep 1
  done
fi

mkdir -p "$(dirname "${db_file}")"

echo "[${STACK}] applying pending migrations: ${db_file}"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" bash scripts/apply-local-migrations.sh "${APP_DIR}" "${STACK}"
)

echo "[${STACK}] syncing base IAM config"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" npm run db:base:sync
)

echo "[${STACK}] clearing business data"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" npm run db:biz:reset
)

echo "[${STACK}] re-seeding business demo"
(
  cd "${APP_DIR}"
  DATABASE_URL="${db_url}" npm run db:seed:business
)

echo ""
echo "[${STACK}] business reset complete"
echo "Database: ${db_file}"

echo "Run next:"
echo "  npm run runtime:diagnose"
echo "  bash scripts/stack.sh up self   # (or 'up main' from the root worktree)"
