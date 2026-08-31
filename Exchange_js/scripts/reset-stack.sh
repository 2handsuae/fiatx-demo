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
assert_stack_is_local
assert_stack_paths
assert_branch_rule

db_url="$(read_database_url "${APP_DIR}" "${STACK}")"
db_file="$(resolve_db_file)"

echo "[${STACK}] stopping services before business reset"
# 必须传**原始入参**(main/self),不是 load_stack_config 解析后的 ${STACK}
# ——self 栈解析后是 wt_<worktree名>,而 stack-stop.sh 的 case 只认 main|self,
# 落进 usage 分支直接非零退出,外层 || true 把失败吞得干干净净。
# 后果:整个停止链(stop_pid_file_process ×4 / stop_listener_if_managed ×3 /
# stop_tb_if_managed / cleanup_orphans_by_pattern ×4)一行都没跑到,而本脚本
# 又没有 ensure_port_free 兜底(stack-up.sh 有)——旧 TB 活着占端口,下面 :39 的
# unlink 只是解链接、:48 format 出的新文件没人用、:51 起的新 TB 绑不上端口,
# 而 :55 的就绪循环看到的是**旧 TB**,照样宣布 ready。seed 于是写进带着上一轮
# 全部转账的旧账本 —— 这就是「重铺后余额累加、倍数 1→2→3→4」那个假警报。
# 2026-08-31 环境收口终审逮到:Task 8 修了 stop_tb_if_managed,却没接到这条路径上。
bash "${SCRIPT_DIR}/stack-stop.sh" "${STACK_NAME}" >/dev/null 2>&1 || true

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
