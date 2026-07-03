#!/usr/bin/env bash
# 容器启动编排：等账本端 → migrate → seed 底座 → 起后端 → seed 演示数据
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL required}"
: "${TB_ADDRESS:?TB_ADDRESS required}"
PORT="${API_PORT:-3000}"
TB_HOST="${TB_ADDRESS%%:*}"
TB_PORT="${TB_ADDRESS##*:}"

echo "[entrypoint] 等待账本端 TigerBeetle ${TB_ADDRESS} ..."
for _ in $(seq 1 60); do nc -z "$TB_HOST" "$TB_PORT" 2>/dev/null && break; sleep 1; done
sleep 2

# TigerBeetle 客户端只认 IP（会拒绝 Docker 服务名/主机名 → Invalid replica address），
# 把服务名解析成容器 IP 再喂给客户端；seed / 后端 / demo 后续都用这个 export 后的值。
TB_IP="$(getent hosts "$TB_HOST" | awk '{print $1}' | head -1)"
if [ -n "$TB_IP" ]; then
  export TB_ADDRESS="${TB_IP}:${TB_PORT}"
  echo "[entrypoint] 账本端 ${TB_HOST} 解析为 IP → ${TB_ADDRESS}"
else
  echo "[entrypoint] ⚠ 解析 ${TB_HOST} 失败，沿用 ${TB_ADDRESS}"
fi

echo "[entrypoint] prisma migrate deploy（建表）"
npx prisma migrate deploy --schema ./prisma/schema.prisma

echo "[entrypoint] seed 底座：角色权限 + 管理员账号"
npm run db:base:sync
echo "[entrypoint] seed 底座：资产 + 账本账户"
npm run db:biz:init

echo "[entrypoint] 启动后端 :${PORT}"
node dist/main &
BACK=$!

echo "[entrypoint] 等待后端就绪 ..."
for _ in $(seq 1 60); do nc -z 127.0.0.1 "$PORT" 2>/dev/null && break; sleep 1; done
sleep 3

echo "[entrypoint] seed 演示交易数据（demo:all）—— 失败不致命"
npm run demo:all || echo "[entrypoint] demo:all 失败（非致命）；后端仍在服务"

wait "$BACK"
