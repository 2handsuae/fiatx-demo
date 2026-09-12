#!/usr/bin/env bash
# deploy/remote-bootstrap.sh — 服务器一次性安装（由 scripts/cloud-bootstrap.sh 经 ssh 'bash -s' 执行）。
# 装 Node / TigerBeetle / Caddy（版本钉死）+ caddy 用户 + 目录。重装系统后原样重跑即可恢复。
# 服务单元与 Caddyfile 不在这里装：由每次部署的 deploy/remote-apply.sh 装（配置只有一个出口）。
set -euo pipefail
NODE_VERSION=v20.20.2
TB_VERSION=0.17.3
CADDY_VERSION=2.11.4
ROOT=/opt/exchange-demo

for t in curl unzip tar xz rsync sha256sum; do
  command -v "$t" >/dev/null || { echo "✖ 服务器缺 $t" >&2; exit 1; }
done

echo "[bootstrap] 1/6 内核：io_uring 必须可用（TigerBeetle 没有替代路径）"
if [[ "$(cat /proc/sys/kernel/io_uring_disabled 2>/dev/null || echo 0)" != "0" ]]; then
  echo 'kernel.io_uring_disabled = 0' | sudo tee /etc/sysctl.d/60-io-uring.conf >/dev/null
  sudo sysctl -p /etc/sysctl.d/60-io-uring.conf
fi
echo "  io_uring_disabled=$(cat /proc/sys/kernel/io_uring_disabled)"

echo "[bootstrap] 2/6 Node ${NODE_VERSION}"
if [[ "$(/opt/node20/bin/node -v 2>/dev/null || true)" != "${NODE_VERSION}" ]]; then
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" | sudo tar -xJ -C /opt
  sudo ln -sfn "/opt/node-${NODE_VERSION}-linux-x64" /opt/node20
fi
echo "  node $(/opt/node20/bin/node -v)"

echo "[bootstrap] 3/6 TigerBeetle ${TB_VERSION}"
if [[ "$(tigerbeetle version 2>/dev/null | head -1 || true)" != *"${TB_VERSION}"* ]]; then
  tmp="$(mktemp -d)"
  curl -fsSL -o "${tmp}/tb.zip" "https://github.com/tigerbeetle/tigerbeetle/releases/download/${TB_VERSION}/tigerbeetle-x86_64-linux.zip"
  unzip -q -o "${tmp}/tb.zip" -d "${tmp}"
  sudo install -m 0755 "${tmp}/tigerbeetle" /usr/local/bin/tigerbeetle
  rm -rf "${tmp}"
fi
echo "  $(tigerbeetle version | head -1)"

echo "[bootstrap] 4/6 Caddy ${CADDY_VERSION}"
if [[ "$(caddy version 2>/dev/null || true)" != "v${CADDY_VERSION}"* ]]; then
  tmp="$(mktemp -d)"
  curl -fsSL -o "${tmp}/caddy.tgz" "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz"
  tar -xzf "${tmp}/caddy.tgz" -C "${tmp}" caddy
  sudo install -m 0755 "${tmp}/caddy" /usr/local/bin/caddy
  rm -rf "${tmp}"
fi
id caddy >/dev/null 2>&1 || sudo useradd --system --home /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy
echo "  caddy $(caddy version | cut -d' ' -f1)"

echo "[bootstrap] 5/6 目录（归 ubuntu；caddy 用户只读 web/）"
sudo mkdir -p "${ROOT}"/app "${ROOT}"/web/admin "${ROOT}"/web/client "${ROOT}"/deploy "${ROOT}"/data "${ROOT}"/run /etc/caddy
sudo chown -R ubuntu:ubuntu "${ROOT}"
sudo chmod 755 "${ROOT}" "${ROOT}/web"

echo "[bootstrap] 6/6 账本数据目录挂内存盘（1400 MB tmpfs）：云硬盘同步写约 4 ms/次，账本落盘会拖出数据库锁超时"
if ! mountpoint -q "${ROOT}/data"; then
  if systemctl is-active --quiet exchange-demo; then sudo systemctl stop exchange-demo; fi
  find "${ROOT}/data" -mindepth 1 -delete
  grep -qF "tmpfs ${ROOT}/data tmpfs" /etc/fstab || echo "tmpfs ${ROOT}/data tmpfs size=1400m,mode=0755,uid=$(id -u ubuntu),gid=$(id -g ubuntu) 0 0" | sudo tee -a /etc/fstab >/dev/null
  sudo mount "${ROOT}/data"
fi
echo "  $(findmnt -n -o SOURCE,FSTYPE,SIZE "${ROOT}/data")"
echo "[bootstrap] ✅ 完成"
