#!/usr/bin/env bash
# scripts/cloud-reset.sh — 重铺：重启演示服务（= 新数据）→ 等 READY + 验收（spec 2026-09-11 §4）。兼容 bash 3.2。
set -euo pipefail
START_TS=$(date +%s)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/cloud-env.sh"
echo "[reset] 线上版本：$(cloud_ssh "cat ${CLOUD_ROOT}/app/DEPLOYED_VERSION 2>/dev/null || echo 未知")"
cloud_ssh "rm -f ${CLOUD_ROOT}/run/status && sudo systemctl restart exchange-demo"   # 先清状态，防假绿
bash "${SCRIPT_DIR}/cloud-verify.sh"
echo "[reset] ✅ 完成，用时 $(( $(date +%s) - START_TS )) 秒"
