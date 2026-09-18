#!/usr/bin/env bash
# scripts/cloud-verify.sh — 等演示服务 READY，再跑 spec 2026-09-11 §5 自动验收；任一条红 → 退出码 1。兼容 bash 3.2。
# 调用方必须先在服务器上 rm -f run/status 再重启服务，否则这里会读到上一轮留下的 READY（假绿）。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/cloud-env.sh"

echo "[verify] 等演示服务 READY（最多 15 分钟）"
deadline=$(( $(date +%s) + 900 ))
last=""
while :; do
  st="$(cloud_ssh "cat ${CLOUD_ROOT}/run/status 2>/dev/null || echo MISSING")"
  if [[ "${st}" != "${last}" ]]; then echo "  状态：${st}"; last="${st}"; fi
  [[ "${st}" == "READY" ]] && break
  if [[ "${st}" == FAILED:* ]]; then
    echo "✖ 启动失败（${st}），boot.log 最后 60 行：" >&2
    cloud_ssh "tail -n 60 ${CLOUD_ROOT}/run/boot.log" >&2
    exit 1
  fi
  if (( $(date +%s) > deadline )); then echo "✖ 15 分钟内没到 READY" >&2; exit 1; fi
  sleep 5
done

LOG="$(cloud_ssh "cat ${CLOUD_ROOT}/run/boot.log")"
fails=0
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1 —— $2"; fails=$((fails + 1)); }
eq() { [[ "$1" =~ ([0-9]+)/([0-9]+) ]] && [[ "${BASH_REMATCH[1]}" == "${BASH_REMATCH[2]}" ]] && (( BASH_REMATCH[2] > 0 )); }

# 1. demo:all
if grep -q 'demo:all DONE ✅' <<<"${LOG}"; then
  pass "demo:all DONE（花名册逐条 + COA 四恒等式）"
else
  fail "demo:all" "boot.log 里没有 'demo:all DONE ✅'"
fi

# 2. recon:demo:break —— 三组数字两边相等且 > 0，且没有任何 BAD 断言
sc="$(grep -oE 'scenarios: [0-9]+/[0-9]+ DETECTED' <<<"${LOG}" | tail -1 || true)"
wl="$(grep -oE 'wallets: +[0-9]+/[0-9]+ bucket OK' <<<"${LOG}" | tail -1 || true)"
co="$(grep -oE 'casesOpened [0-9]+/[0-9]+' <<<"${LOG}" | tail -1 || true)"
if eq "${sc}" && eq "${wl}" && eq "${co}" && ! grep -qE '^ *BAD ' <<<"${LOG}"; then
  pass "recon:demo:break（${sc} · ${wl} · ${co}）"
else
  fail "recon:demo:break" "scenarios='${sc}' wallets='${wl}' cases='${co}'，或日志里有 BAD 断言"
fi

# 3. verify:coa —— 在服务器上用演示服务同一套环境变量跑
if cloud_ssh "cd ${CLOUD_ROOT}/app && set -a && . ${CLOUD_ROOT}/demo.env && set +a && PATH=/opt/node20/bin:\$PATH npm run -s verify:coa" | grep -q 'ALL INVARIANTS PASS'; then
  pass "verify:coa（恒等式 + 负余额断言）"
else
  fail "verify:coa" "输出里没有 ALL INVARIANTS PASS"
fi

# 4. 两个网址 HTTPS 200，且证书校验通过（curl 默认校验证书）
for u in "${CLOUD_ADMIN_URL}/" "${CLOUD_CLIENT_URL}/"; do
  code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "${u}" || true)"
  if [[ "${code}" == "200" ]]; then pass "HTTPS ${u}"; else fail "HTTPS ${u}" "返回 ${code:-无响应}（证书校验失败也会到这里）"; fi
done

# 5. 经 /api 反代登录（证明反代 + CORS 都通）
tok="$(curl -s -m 15 -H 'Content-Type: application/json' -d '{"email":"admin@fiatx.com","password":"123456"}' "${CLOUD_ADMIN_URL}/api/auth/login" | grep -oE '"access_token":"[^"]+"' || true)"
if [[ -n "${tok}" ]]; then pass "经 ${CLOUD_ADMIN_URL}/api 登录拿到 access_token"; else fail "登录" "没拿到 access_token"; fi

if (( fails > 0 )); then echo "[verify] ✖ ${fails} 项不通过" >&2; exit 1; fi
echo "[verify] ✅ 全部通过"
