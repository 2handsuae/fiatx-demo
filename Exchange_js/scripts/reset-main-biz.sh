#!/usr/bin/env bash
# scripts/reset-main-biz.sh
#
# Business reset for the MAIN stack that ALSO reformats TigerBeetle, then
# restarts the stack so the backend reconnects to the fresh ledger.
#
# Why this exists: `db:biz:reset` only clears Prisma rows — it does NOT touch
# TB. Because seed capital injection uses DETERMINISTIC transfer ids, re-seeding
# against an un-formatted TB silently no-ops ("id exists") and balances keep the
# old amounts. A true reset must therefore reformat the TB data file BEFORE
# re-seeding.
#
# Why it restarts the stack: a TigerBeetle CLIENT is pinned to a cluster session.
# When the TB data file is reformatted (new process / empty ledger), a live
# backend's TB client gets stuck in a ConnectionRefused reconnect loop and every
# ledger read times out ("账本详情加载不出来"). The backend MUST be restarted to
# build a fresh client against the reformatted TB — there is no live-reconnect
# shortcut. Seeding runs with services DOWN so a flailing backend can't write
# stray transfers into the fresh ledger.
#
# Sequence:
#   1. stop the stack            (stack-stop: backend/admin/client/tb)
#   2. wipe + format + start TB  (standalone, just for the seed step)
#   3. clear business Prisma      (db:biz:reset)
#   4. re-seed business demo      (db:biz:init → seedCapitalInjection) + demo:setup
#   5. restart the stack          (stack-up: fresh backend TB client + admin + client)
#
# For a deeper reset that also re-runs migrations + base IAM sync, use
# `npm run stack:reset:main`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./stack-common.sh
source "${SCRIPT_DIR}/stack-common.sh"
# shellcheck source=./db-env.sh
source "${SCRIPT_DIR}/db-env.sh"

require_commands tigerbeetle npm npx lsof

load_stack_config main
assert_stack_paths
assert_branch_rule

db_url="$(read_database_url "${APP_DIR}" "${STACK}")"

# ── 1/5 — stop the stack so nothing holds a TB client during the reformat ──
echo "[main:reset:biz] 1/5 stopping stack"
bash "${SCRIPT_DIR}/stack-stop.sh" main >/dev/null 2>&1 || true

# ── 2/5 — reformat TigerBeetle, then start it standalone for the seed step ─
echo "[main:reset:biz] 2/5 reformatting TigerBeetle (wipe → format → start)"
ensure_port_free "${TB_PORT}" "tb" || true
if [ -f "${TB_DATA_FILE}" ]; then
  echo "[main:reset:biz] wiping TB data file: ${TB_DATA_FILE}"
  rm -f "${TB_DATA_FILE}"
fi
mkdir -p "$(dirname "${TB_DATA_FILE}")"
echo "[main:reset:biz] formatting fresh TB data file"
tigerbeetle format --cluster=0 --replica=0 --replica-count=1 "${TB_DATA_FILE}"
echo "[main:reset:biz] starting TigerBeetle at ${TB_ADDRESS}"
tigerbeetle start --development --addresses="${TB_ADDRESS}" "${TB_DATA_FILE}" \
  > "${TB_LOG}" 2>&1 &
echo $! > "${TB_PID_FILE}"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if lsof -ti:"${TB_PORT}" >/dev/null 2>&1; then
    echo "[main:reset:biz] TigerBeetle ready on ${TB_ADDRESS}"
    break
  fi
  sleep 1
done

# ── 3/5 — clear business-layer Prisma data ────────────────────────────────
echo "[main:reset:biz] 3/5 clearing business Prisma data"
( cd "${APP_DIR}" && DATABASE_URL="${db_url}" TB_ADDRESS="${TB_ADDRESS}" npm run db:biz:reset )

# ── 4/5 — re-seed business demo (capital injection on the fresh TB) ────────
echo "[main:reset:biz] 4/5 re-seeding business demo + demo:setup"
( cd "${APP_DIR}" && DATABASE_URL="${db_url}" TB_ADDRESS="${TB_ADDRESS}" npm run db:biz:init )
( cd "${APP_DIR}" && DATABASE_URL="${db_url}" TB_ADDRESS="${TB_ADDRESS}" \
    npx ts-node -r tsconfig-paths/register scripts/demo-setup.ts )

# ── 5/5 — restart the stack so the backend reconnects to the fresh TB ──────
# stack-up stops the standalone TB started above, restarts TB on the SAME
# (now-seeded) data file (no reformat — file exists), skips re-seed (DB already
# has data), then rebuilds + starts the backend with a fresh TB client.
echo "[main:reset:biz] 5/5 restarting stack (fresh backend TB client)"
bash "${SCRIPT_DIR}/stack-up.sh" main

echo "[main:reset:biz] done — TB reformatted, business reseeded, stack healthy."
