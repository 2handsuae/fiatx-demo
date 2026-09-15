#!/usr/bin/env bash
# scripts/cloud-deploy.sh — 一条命令部署到云端演示服务器（spec 2026-09-11 §4）。兼容 bash 3.2。
# 预检（运行相关文件已提交）→ 本机构建（临时目录）→ rsync 只传改动 → 服务器 remote-apply → 等 READY + 验收
set -euo pipefail
START_TS=$(date +%s)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/cloud-env.sh"
source "${SCRIPT_DIR}/node-env.sh"
ensure_node20

cd "${CLOUD_APP_DIR}"
TOP="$(git rev-parse --show-toplevel)"
REL="$(git rev-parse --show-prefix)"
REL="${REL%/}"   # = Exchange_js
RUNTIME_PATHS=(src prisma scripts config admin-web client-web deploy package.json package-lock.json .npmrc tsconfig.json tsconfig.build.json)

echo "[deploy] 1/5 预检：运行相关文件必须已提交"
DIRTY="$(git status --porcelain -- "${RUNTIME_PATHS[@]}")"
if [[ -n "${DIRTY}" ]]; then
  echo "✖ 以下文件有未提交改动，先提交再部署：" >&2
  echo "${DIRTY}" >&2
  exit 1
fi
COMMIT="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "  部署 ${BRANCH}@${COMMIT} → ${CLOUD_HOST}"
cloud_ssh true || { echo "✖ SSH 连不上 ${CLOUD_HOST}" >&2; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT
mkdir -p "${STAGE}/app" "${STAGE}/web/admin" "${STAGE}/web/client"

echo "[deploy] 2/5 本机构建（输出进临时目录，不碰本机 dist/）"
git -C "${TOP}" archive "HEAD:${REL}" src prisma scripts config package.json package-lock.json .npmrc tsconfig.json | tar -x -C "${STAGE}/app"
npx tsc -p tsconfig.build.json --outDir "${STAGE}/app/dist" --declaration false --sourceMap false --incremental false
( cd admin-web && npx tsc -b tsconfig.app.json tsconfig.node.json && VITE_API_URL=/api npx vite build --outDir "${STAGE}/web/admin" --emptyOutDir )
( cd client-web && npx tsc -b tsconfig.app.json tsconfig.node.json && VITE_API_URL=/api npx vite build --outDir "${STAGE}/web/client" --emptyOutDir )
echo "${BRANCH}@${COMMIT} $(date '+%F %T')" > "${STAGE}/app/DEPLOYED_VERSION"

echo "[deploy] 3/5 上传（rsync 只传改动；服务器上的 node_modules 不动）"
cloud_rsync --exclude node_modules "${STAGE}/app/" "${CLOUD_USER}@${CLOUD_HOST}:${CLOUD_ROOT}/app/"
cloud_rsync "${STAGE}/web/" "${CLOUD_USER}@${CLOUD_HOST}:${CLOUD_ROOT}/web/"
cloud_rsync "${CLOUD_APP_DIR}/deploy/" "${CLOUD_USER}@${CLOUD_HOST}:${CLOUD_ROOT}/deploy/"

echo "[deploy] 4/5 服务器：装依赖 / 刷新配置 / 重启演示服务"
cloud_ssh "bash ${CLOUD_ROOT}/deploy/remote-apply.sh ${CLOUD_ADMIN_HOST} ${CLOUD_CLIENT_HOST}"

echo "[deploy] 5/5 等 READY + 验收"
bash "${SCRIPT_DIR}/cloud-verify.sh"
echo "[deploy] ✅ 完成：${BRANCH}@${COMMIT}，总用时 $(( $(date +%s) - START_TS )) 秒"
echo ""
sed -e "s#__ADMIN_URL__#${CLOUD_ADMIN_URL}#g" -e "s#__CLIENT_URL__#${CLOUD_CLIENT_URL}#g" "${CLOUD_APP_DIR}/deploy/colleague-message.txt"
