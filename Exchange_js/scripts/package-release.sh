#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# package-release.sh — 产出可移植 Docker 交付包 Exchange-demo-<时间戳>.zip
#
# 对面拿到后：装好 Docker Desktop → 解压 → docker compose up --build
# 用 `git archive HEAD:Exchange_js` 只取已提交源码，天然排除：
#   node_modules / .git / .env(真密钥) / worktree / doc-final(内部文档)
# 因此包里无密钥、无平台绑定的依赖、无内部资料，几十 MB。
#
#   npm run package:release      # 或双击仓库根的「打包.command」
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"   # = Exchange_js/
cd "${APP_DIR}"

command -v git >/dev/null || { echo "git not found" >&2; exit 1; }
command -v zip >/dev/null || { echo "zip not found" >&2; exit 1; }

STAMP="${RELEASE_STAMP:-$(date +%Y%m%d%H%M%S)}"
NAME="Exchange-demo-${STAMP}"
STAGE="$(mktemp -d)"
OUT="${STAGE}/${NAME}"
trap 'rm -rf "${STAGE}"' EXIT
mkdir -p "${OUT}"

echo "[package] git archive 已提交源码（Exchange_js 为包根，export-ignore 生效）"
# 从仓库顶层跑 archive：在子目录里对 HEAD:Exchange_js 归档会触发 git 的
# "current working directory is untracked"，用 -C 顶层规避。
TOPLEVEL="$(git rev-parse --show-toplevel)"
git -C "${TOPLEVEL}" archive --format=tar "HEAD:Exchange_js" | tar -x -C "${OUT}"

# 双保险：包里绝不能有真 .env（git archive 本就不含 gitignore 的 .env，这里再兜一次）
find "${OUT}" -name '.env' ! -name '.env.example' -type f -delete 2>/dev/null || true

echo "[package] 压 zip"
( cd "${STAGE}" && zip -rq "${APP_DIR}/${NAME}.zip" "${NAME}" )

SIZE="$(du -h "${APP_DIR}/${NAME}.zip" | cut -f1)"
echo "[package] 完成 ✅"
echo "  产物：${APP_DIR}/${NAME}.zip  (${SIZE})"
echo "  对面：解压 → docker compose up --build → 浏览器 http://localhost:18081 (admin@fiatx.com/123456)"
