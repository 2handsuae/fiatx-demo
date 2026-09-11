#!/usr/bin/env bash
# deploy/remote-apply.sh — 每次部署在服务器上跑（由 scripts/cloud-deploy.sh 经 ssh 调用）
# 依赖清单变了才 npm ci → prisma generate → 渲染配置、装服务单元 → 启 / 重载 Caddy → 重启演示服务（= 新数据）
set -euo pipefail
HOST="${1:?用法: remote-apply.sh <公网IP>}"
ROOT=/opt/exchange-demo
APP="${ROOT}/app"
export PATH=/opt/node20/bin:/usr/local/bin:/usr/bin:/bin

cd "${APP}"
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [[ ! -f node_modules/.lock-hash ]] || [[ "$(cat node_modules/.lock-hash)" != "${LOCK_HASH}" ]]; then
  echo "[apply] 依赖清单有变 → npm ci"
  npm ci --no-audit --no-fund
  echo "${LOCK_HASH}" > node_modules/.lock-hash
else
  echo "[apply] 依赖清单未变 → 跳过 npm ci"
fi
echo "[apply] prisma generate"
npx prisma generate --schema ./prisma/schema.prisma >/dev/null

echo "[apply] 渲染配置 + 装服务单元"
sed "s/__HOST__/${HOST}/g" "${ROOT}/deploy/demo.env.template" > "${ROOT}/demo.env"
sed "s/__HOST__/${HOST}/g" "${ROOT}/deploy/Caddyfile.template" | sudo tee /etc/caddy/Caddyfile.new >/dev/null
sudo -u caddy /usr/local/bin/caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile >/dev/null
sudo mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
sudo install -m 0644 "${ROOT}/deploy/exchange-demo.service" /etc/systemd/system/exchange-demo.service
sudo install -m 0644 "${ROOT}/deploy/caddy.service" /etc/systemd/system/caddy.service
sudo systemctl daemon-reload
sudo systemctl enable --quiet caddy exchange-demo
if systemctl is-active --quiet caddy; then sudo systemctl reload caddy; else sudo systemctl start caddy; fi

echo "[apply] 重启演示服务（= 新数据）"
rm -f "${ROOT}/run/status"   # 先清状态：否则验收会读到上一轮留下的 READY（假绿）
sudo systemctl restart exchange-demo
