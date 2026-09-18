#!/usr/bin/env bash
# scripts/cloud-bootstrap.sh — 开服（一次性；重装系统后重跑）：服务器装好 Node / TigerBeetle / Caddy，然后首次部署。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/cloud-env.sh"
echo "[bootstrap] → ${CLOUD_USER}@${CLOUD_HOST}"
cloud_ssh 'bash -s' < "${CLOUD_APP_DIR}/deploy/remote-bootstrap.sh"
echo "[bootstrap] 服务器装好了 → 首次部署"
exec bash "${SCRIPT_DIR}/cloud-deploy.sh"
