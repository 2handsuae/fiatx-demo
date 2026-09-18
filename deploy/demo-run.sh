#!/usr/bin/env bash
# deploy/demo-run.sh — 演示服务启动序列（exchange-demo.service 的 ExecStart；spec 2026-09-11 §3）
# 每次启动：清空 → 账本 → 建表 → 底座 → 业务数据 → 接口 → demo:all → recon:demo:break → READY
# 状态写 run/status（STARTING… / READY / FAILED:<步骤>），全量输出同时进 journal 与 run/boot.log。
# 账本文件在 data/（内存盘，这里清空内容）；SQLite 在 /run/exchange-demo（exchange-demo.service 的 RuntimeDirectory，systemd 每次启动新建）。
set -uo pipefail

ROOT=/opt/exchange-demo
DATA="${ROOT}/data"
RUN="${ROOT}/run"
STATUS="${RUN}/status"
LOG="${RUN}/boot.log"
mkdir -p "${RUN}"
exec > >(tee "${LOG}") 2>&1

TB_PID=""
API_PID=""
say() { echo "[demo-run $(date +%H:%M:%S)] $*"; }
mark() { echo "$1" > "${STATUS}"; }
hold_failed() {
  # 失败：标记后原地停住——API 若已起就继续服务、便于排查；不退出，免得 systemd 反复重启重铺
  say "✖ FAILED @ $1"
  mark "FAILED:$1"
  sleep infinity
}
wait_port() {   # $1=端口 $2=超时秒
  local i
  for ((i = 0; i < $2; i++)); do
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0
    sleep 1
  done
  return 1
}
run_step() {    # $1=步骤名，其余=命令
  local name="$1"
  shift
  mark "STARTING:${name}"
  say "▶ ${name}"
  "$@" || hold_failed "${name}"
}

mark "STARTING"
say "清空数据目录 ${DATA}（每次启动都从零来）"
mkdir -p "${DATA}" && find "${DATA}" -mindepth 1 -delete   # data/ 是内存盘挂载点：清内容，不删目录本身

run_step "1 格式化账本" tigerbeetle format --development --cluster=0 --replica=0 --replica-count=1 "${DATA}/0_0.tigerbeetle"

mark "STARTING:2 启动账本"
say "▶ 2 启动账本"
tigerbeetle start --development --addresses=127.0.0.1:3003 "${DATA}/0_0.tigerbeetle" &
TB_PID=$!
wait_port 3003 60 || hold_failed "2 启动账本"

run_step "3 建表" npx prisma migrate deploy --schema ./prisma/schema.prisma
run_step "4 铺底座" npm run db:base:sync
run_step "5 铺业务数据" npm run db:seed:business

mark "STARTING:6 起接口"
say "▶ 6 起接口"
node dist/main &
API_PID=$!
wait_port "${API_PORT:-3000}" 120 || hold_failed "6 起接口"

run_step "7 demo:all" npm run demo:all
run_step "8 recon:demo:break" npm run recon:demo:break

mark "READY"
say "✅ READY  管理台 ${ADMIN_URL}  客户端 ${CLIENT_URL}"

# 守护：账本或接口任一退出 → 本服务非 0 退出，systemd 重启 = 重新从零来
wait -n "${TB_PID}" "${API_PID}"
say "✖ 账本或接口进程退出，服务退出（systemd 将重启并重铺）"
exit 1
