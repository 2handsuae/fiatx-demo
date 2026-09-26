#!/usr/bin/env bash
# 双击：本地主栈一键更新重铺——拉 GitHub 最新 main → 重启主栈（自动重建 dist）→
# 从零铺数据（含 TigerBeetle 重建 + 种子 + demo:all 演示数据）→ 重摆对账破口（recon:demo:break）。
# 任何一步失败当场停在红字处，窗口保留。
set -uo pipefail
cd "$(dirname "$0")" || exit 1

die() { echo; echo "✗ 失败：$1"; echo; read -r -p "按回车关闭窗口 " _; exit 1; }

# 本机默认 node18，前置 nvm 的 v20（判例：双击环境不 source nvm）
NODE20_BIN="$(ls -d "$HOME"/.nvm/versions/node/v20*/bin 2>/dev/null | tail -1)"
[ -n "$NODE20_BIN" ] || die "找不到 nvm 的 node v20（~/.nvm/versions/node/v20*）"
export PATH="$NODE20_BIN:$PATH"

echo "━━━ 0/6 前置检查 ━━━"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || die "主工作树当前在分支 $BRANCH，不是 main——先手动切回 main 再双击"
DIRTY="$(git status --porcelain)"
[ -z "$DIRTY" ] || die "工作树不干净（有未提交/未跟踪改动），先处理再来：
$DIRTY"

echo "━━━ 1/6 拉取 GitHub 最新 main ━━━"
git pull --ff-only origin main || die "git pull 非快进（本地 main 有未推提交或历史分叉），需手动处理"
echo "✓ main 现在位于：$(git log --oneline -1)"

echo "━━━ 2/6 重新生成 Prisma client（判例：旧 client 会撞 reset）━━━"
npx prisma generate >/dev/null || die "prisma generate"

echo "━━━ 3/6 停主栈 ━━━"
bash scripts/stack.sh down main || true

echo "━━━ 4/6 从零重铺主栈（迁移 + 权限字典 + 业务种子 + TigerBeetle 重建）━━━"
bash scripts/stack.sh reset main || die "stack.sh reset main"

echo "━━━ 5/6 起主栈（自动重建 dist）并等后端就绪 ━━━"
bash scripts/stack.sh up main || die "stack.sh up main"
CODE=""
for _i in $(seq 1 30); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api 2>/dev/null || true)"
  [ "$CODE" = "200" ] && break
  sleep 2
done
[ "$CODE" = "200" ] || die "后端 60 秒内未就绪（/api → ${CODE:-无响应}），看 /tmp/exchange_js_runtime_main/backend.log"
echo "✓ 后端就绪"

echo "━━━ 6/6 铺演示数据（demo:all）＋ 重摆对账破口（recon:demo:break）━━━"
bash scripts/on-stack.sh main demo:all || die "demo:all 未全绿"
bash scripts/on-stack.sh main recon:demo:break || die "recon:demo:break"

echo ""
echo "━━━ 全部完成 ✅ ━━━"
echo "管理台  http://localhost:3001"
echo "客户端  http://localhost:3002"
echo "后端    http://localhost:3000"
echo ""
read -r -p "按回车关闭窗口 " _
exit 0
