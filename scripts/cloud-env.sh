#!/usr/bin/env bash
# scripts/cloud-env.sh — 云端演示环境公共设置（被 scripts/cloud-*.sh source）。兼容 bash 3.2。
# 读 Exchange_js/.cloud.env（本机、未入库）：CLOUD_HOST(SSH 的 IP) / CLOUD_USER / CLOUD_KEY / CLOUD_ADMIN_HOST / CLOUD_CLIENT_HOST(对外域名)。
set -euo pipefail

CLOUD_APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # = Exchange_js/
CLOUD_ENV_FILE="${CLOUD_APP_DIR}/.cloud.env"
if [[ ! -f "${CLOUD_ENV_FILE}" ]]; then
  echo "✖ 缺 ${CLOUD_ENV_FILE}：照 .cloud.env.example 复制一份（CLOUD_HOST / CLOUD_USER / CLOUD_KEY / CLOUD_ADMIN_HOST / CLOUD_CLIENT_HOST）" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "${CLOUD_ENV_FILE}"
: "${CLOUD_HOST:?CLOUD_HOST 未设}"
: "${CLOUD_USER:?CLOUD_USER 未设}"
: "${CLOUD_KEY:?CLOUD_KEY 未设}"
: "${CLOUD_ADMIN_HOST:?CLOUD_ADMIN_HOST 未设（管理台对外域名，见 .cloud.env.example）}"
: "${CLOUD_CLIENT_HOST:?CLOUD_CLIENT_HOST 未设（客户端对外域名，见 .cloud.env.example）}"
CLOUD_KEY="${CLOUD_KEY/#\~/$HOME}"

CLOUD_ROOT=/opt/exchange-demo
# SSH 走 IP（CLOUD_HOST，不依赖域名解析）；对外网址走域名（Caddy 按域名发证 + 路由到两个前端）
CLOUD_ADMIN_URL="https://${CLOUD_ADMIN_HOST}"
CLOUD_CLIENT_URL="https://${CLOUD_CLIENT_HOST}"
CLOUD_SSH_OPTS=(-i "${CLOUD_KEY}" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

cloud_ssh() { ssh "${CLOUD_SSH_OPTS[@]}" "${CLOUD_USER}@${CLOUD_HOST}" "$@"; }
cloud_rsync() { rsync -az --delete -e "ssh ${CLOUD_SSH_OPTS[*]}" "$@"; }
