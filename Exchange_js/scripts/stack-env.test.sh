#!/usr/bin/env bash
# 单测:ensure_env_files 权威重写——脏 .env 自愈 stack 管理键、保留其它键。
# 直跑:bash scripts/stack-env.test.sh  (退出码 0=全过)
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 临时 APP_DIR + 脏 .env(main 端口 + 一个必须被保留的自定义键)
TMP="$(mktemp -d)"; trap 'rm -rf "${TMP}"' EXIT
mkdir -p "${TMP}/admin-web" "${TMP}/client-web"
cat >"${TMP}/.env" <<'DIRTY'
API_PORT=3000
TB_ADDRESS=127.0.0.1:3503
DATABASE_URL="file:/tmp/wrong.db"
MFA_ISSUER=KeepMe
DIRTY
echo 'VITE_API_URL=http://localhost:3000' >"${TMP}/admin-web/.env"

# 加载被测函数;source 后继承 set -e,故断言前会 set +e
source "${SCRIPT_DIR}/stack-common.sh"
# 用 self 风格的端口装填 config 变量(绕过真实 git worktree 探测)
STACK="self-test"; APP_DIR="${TMP}"
BACKEND_PORT=3600; ADMIN_PORT=3601; CLIENT_PORT=3602; TB_PORT=3603
BACKEND_URL="http://localhost:3600"; ADMIN_URL="http://localhost:3601"; CLIENT_URL="http://localhost:3602"
TB_ADDRESS="127.0.0.1:3603"
default_database_url() { echo "file:/tmp/exchange_js_wt_self-test/dev.db"; }  # stub

ensure_env_files

set +e
fail=0
assert() { # assert <desc> <grep-pattern> <file>
  if grep -qE "$2" "$3"; then echo "  ✓ $1"; else echo "  ✗ $1 (missing: $2 in $3)"; fail=1; fi
}
assert "root API_PORT 自愈为 3600"            '^API_PORT=3600$'                       "${TMP}/.env"
assert "root TB_ADDRESS 自愈为 3603(补齐)"    '^TB_ADDRESS=127\.0\.0\.1:3603$'        "${TMP}/.env"
assert "root DATABASE_URL 自愈"                '^DATABASE_URL="file:/tmp/exchange_js_wt_self-test/dev.db"$' "${TMP}/.env"
assert "自定义键 MFA_ISSUER 被保留"            '^MFA_ISSUER=KeepMe$'                   "${TMP}/.env"
assert "admin VITE_API_URL 自愈为 3600"        '^VITE_API_URL=http://localhost:3600$'  "${TMP}/admin-web/.env"
assert "client VITE_API_URL 自愈(新建)"        '^VITE_API_URL=http://localhost:3600$'  "${TMP}/client-web/.env"
# 幂等:再跑一次不产生重复行
ensure_env_files >/dev/null 2>&1
dup="$(grep -c '^API_PORT=' "${TMP}/.env")"
[ "${dup}" = "1" ] && echo "  ✓ 幂等:API_PORT 仅一行" || { echo "  ✗ 幂等失败:API_PORT ${dup} 行"; fail=1; }

[ "${fail}" = "0" ] && { echo "PASS"; exit 0; } || { echo "FAIL"; exit 1; }
