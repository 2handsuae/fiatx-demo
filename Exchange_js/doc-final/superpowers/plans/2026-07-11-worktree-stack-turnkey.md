# Worktree 起栈防呆 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 worktree 的 `stack.sh up`(self)永远一次成——`ensure_env_files` 改「权威重写」自愈脏 `.env`、补齐漏写的 `TB_ADDRESS`、保留其它键;加 `.nvmrc` 兜 node;`.env.example` 加警示 banner;CLAUDE.md 强化 worktree 姿势。

**Architecture:** 纯脚本/配置层。核心是给 `scripts/stack-common.sh` 加一个幂等 `upsert_env_key()` 助手,把 `ensure_env_files()` 从"只建不更"改成"每次 up 按 `load_stack_config` 分到的端口权威 upsert stack 管理键"。附带两个静态文件(`.nvmrc`、`.env.example` banner)+ 一句文档。零业务代码。

**Tech Stack:** Bash(`set -euo pipefail`,BSD/GNU 兼容,用 awk 临时文件法而非 `sed -i`);现有 `stack.sh`/`stack-up.sh`/`stack-common.sh` 体系。

**执行前置(践行 spec ①):** 本改动**在一个 worktree 里做**——`.claude/worktrees/stack-turnkey/`,分支 `feat/worktree-stack-turnkey`。理由:改的是 `stack-common.sh`,正好在 worktree 里用 `stack.sh up self` 拿这套新逻辑**自测自验**,不碰主树 main 栈。开工先建 worktree 并把 spec+plan 提交上去。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `scripts/stack-common.sh` | 栈配置 + env 文件生成 | 改:加 `upsert_env_key()` + 重写 `ensure_env_files()` |
| `scripts/stack-env.test.sh` | env 自愈单测(可 `bash` 直跑) | 新建 |
| `.nvmrc` | 固定 node 版本给非 stack 命令 | 新建(内容 `20`) |
| `.env.example` | 裸 checkout 占位 + 警示 | 改:顶部加 banner |
| `重做版/CLAUDE.md` | worktree 姿势规范 | 改:补一句 |

---

## Task 1: `upsert_env_key` + 权威 `ensure_env_files` + 单测

**Files:**
- Create: `scripts/stack-env.test.sh`
- Modify: `scripts/stack-common.sh`（`ensure_env_files()` 约 240-276 行 + 前面加 `upsert_env_key()`）

- [ ] **Step 1: 写失败测试** — 新建 `scripts/stack-env.test.sh`:

```bash
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bash scripts/stack-env.test.sh`
Expected: FAIL —— 现有 `ensure_env_files` 见 `.env` 已存在即跳过,`API_PORT` 仍是 3000、`TB_ADDRESS` 仍 3503、`client-web/.env` 未建;多条 `✗` 后 `FAIL`。

- [ ] **Step 3: 加 `upsert_env_key()`** —— 在 `stack-common.sh` 的 `ensure_env_files()` **定义之前**插入:

```bash
# Upsert KEY=VALUE into an env file: replace the line in place if the key exists,
# else append. Creates the file if missing. BSD/GNU-portable (awk temp-file, no
# `sed -i`). VALUE is written literally. Only clean values (ports/URLs/paths).
upsert_env_key() {
  local file="$1" key="$2" value="$3"
  touch "${file}"
  if grep -qE "^${key}=" "${file}"; then
    awk -v k="${key}" -v line="${key}=${value}" \
      '$0 ~ "^"k"=" {print line; next} {print}' "${file}" >"${file}.tmp" \
      && mv "${file}.tmp" "${file}"
  else
    printf '%s=%s\n' "${key}" "${value}" >>"${file}"
  fi
}
```

- [ ] **Step 4: 重写 `ensure_env_files()`** —— 整体替换现有函数体为:

```bash
ensure_env_files() {
  local backend_env="${APP_DIR}/.env"
  local admin_env="${APP_DIR}/admin-web/.env"
  local client_env="${APP_DIR}/client-web/.env"
  local default_db_url
  default_db_url="$(default_database_url "${STACK}")"

  # 权威重写:每次 up 把 stack 管理键改成 load_stack_config 为「本栈」分到的端口/URL。
  # 其它键(密钥、MFA_ISSUER、SUMSUB_MOCK_MODE …)一律保留。自愈脏/陈旧 .env,
  # 令 worktree 前后端始终指向自己的栈(消除 vite 读 .env vs 注入 env 的优先级歧义)。
  upsert_env_key "${backend_env}" "API_PORT"     "${BACKEND_PORT}"
  upsert_env_key "${backend_env}" "ADMIN_PORT"   "${ADMIN_PORT}"
  upsert_env_key "${backend_env}" "CLIENT_PORT"  "${CLIENT_PORT}"
  upsert_env_key "${backend_env}" "API_URL"      "${BACKEND_URL}"
  upsert_env_key "${backend_env}" "ADMIN_URL"    "${ADMIN_URL}"
  upsert_env_key "${backend_env}" "CLIENT_URL"   "${CLIENT_URL}"
  upsert_env_key "${backend_env}" "DATABASE_URL" "\"${default_db_url}\""
  upsert_env_key "${backend_env}" "TB_ADDRESS"   "${TB_ADDRESS}"
  # 演示开关:仅在缺失时补默认,不覆盖操作者已设的值。
  grep -qE "^GOVERNANCE_DEMO_ENABLED=" "${backend_env}" \
    || printf 'GOVERNANCE_DEMO_ENABLED=true\n' >>"${backend_env}"

  upsert_env_key "${admin_env}"  "VITE_API_URL" "${BACKEND_URL}"
  upsert_env_key "${client_env}" "VITE_API_URL" "${BACKEND_URL}"

  echo "[${STACK}] env reconciled: API_PORT=${BACKEND_PORT} TB=${TB_ADDRESS} VITE_API_URL=${BACKEND_URL}"
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `bash scripts/stack-env.test.sh`
Expected: 全 `✓` + `PASS`(含幂等断言)。

- [ ] **Step 6: 提交**

```bash
git add scripts/stack-common.sh scripts/stack-env.test.sh
git commit -m "fix(stack): ensure_env_files authoritatively reconciles stack-managed keys (self-heal dirty .env, add TB_ADDRESS)"
```

---

## Task 2: `.nvmrc` + `.env.example` banner

**Files:**
- Create: `.nvmrc`
- Modify: `.env.example`（顶部加注释）

- [ ] **Step 1: 建 `.nvmrc`**

```bash
printf '20\n' > .nvmrc
```

- [ ] **Step 2: `.env.example` 顶部加 banner** —— 在文件**最上方**插入这几行(原有键值全部保留、不动):

```
# ⚠️ 端口 / *_URL / DATABASE_URL / TB_ADDRESS 由 `bash scripts/stack.sh up` 按栈权威生成
#    (main=3000-3003 固定;worktree self=自动分配)。此处仅裸 checkout 占位,勿依赖、勿手填端口。
#    起栈前不必编辑本文件——ensure_env_files 会在每次 up 时自愈 .env。
```

- [ ] **Step 3: 验证**

Run: `cat .nvmrc && head -3 .env.example`
Expected: `.nvmrc` 输出 `20`;`.env.example` 头 3 行是上面的 banner。

- [ ] **Step 4: 提交**

```bash
git add .nvmrc .env.example
git commit -m "chore(env): pin node via .nvmrc; annotate .env.example ports as stack-managed"
```

---

## Task 3: CLAUDE.md worktree 姿势强化

**Files:**
- Modify: `重做版/CLAUDE.md`（「并行工作 · Worktree 规范」节）

- [ ] **Step 1: 补一句** —— 在 `重做版/CLAUDE.md` 的「并行工作 · Worktree 规范」节 `**建**` 那条**下方**加一行:

```markdown
- **起分支服务铁律**:要为某分支起服务(验收/联调),**一律在它的 worktree 里 `bash scripts/stack.sh up`(self)**——绝不在主工作树 `git checkout -b` 起临时分支跑服务(会撞 `main` 分支守卫、被迫手搓,坑全回来)。`stack.sh up` 会自动分端口、自愈 `.env`、切 node20、重建后端。
```

**目标文件定位**(worktree 安全):项目 CLAUDE.md 在 **git 根**(`Exchange_js/` 之上),用 `CLAUDE_MD="$(git rev-parse --show-toplevel)/CLAUDE.md"` 取到;先 `grep -n "并行工作 · Worktree 规范" "$CLAUDE_MD"` 确认改对文件(它含该节,`Exchange_js/CLAUDE.md` 若存在则不是它)。

- [ ] **Step 2: 验证**

Run: `CLAUDE_MD="$(git rev-parse --show-toplevel)/CLAUDE.md"; grep -n "起分支服务铁律" "$CLAUDE_MD"`
Expected: 命中一行。

- [ ] **Step 3: 提交**

```bash
git add "$(git rev-parse --show-toplevel)/CLAUDE.md"
git commit -m "docs(claude): mandate worktree + stack.sh up for per-branch services"
```

---

## Task 4: 端到端验证(自愈 live + main 不回归)

**Files:** 无(纯验证)

- [ ] **Step 1: worktree self 自愈 live 验证** —— 在**本 worktree**(`.claude/worktrees/stack-turnkey/`)内:

先人为把 `.env` 弄脏,再起栈,确认自愈 + 前端指对:
```bash
cd <本 worktree 根>/Exchange_js
printf 'API_PORT=3000\nTB_ADDRESS=127.0.0.1:3503\nVITE_API_URL=http://localhost:3000\nMFA_ISSUER=KeepMe\n' > .env
printf 'VITE_API_URL=http://localhost:3000\n' > admin-web/.env
bash scripts/stack.sh up            # = up self
bash scripts/stack.sh status        # 记下本 worktree 分到的 base 端口(设为 B)
```
Expected: 四端在 `B / B+1 / B+2 / B+3` 起;随后核验自愈:
```bash
grep -E '^API_PORT=|^TB_ADDRESS=|^MFA_ISSUER=' .env      # API_PORT=B、TB_ADDRESS=127.0.0.1:(B+3)、MFA_ISSUER=KeepMe 仍在
grep VITE_API_URL admin-web/.env                          # =http://localhost:B(不是 3000)
curl -s -o /dev/null -w "admin B+1 → %{http_code}\n" http://localhost:$((B+1))/   # 200
```
收尾:`bash scripts/stack.sh down`

- [ ] **Step 2: main 不回归验证(铁约束)** —— 切回主工作树 main:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js   # 主树(需在 main 分支)
bash scripts/stack.sh up main
grep -E '^API_PORT=|^TB_ADDRESS=' .env      # 期望自愈为 API_PORT=3000、TB_ADDRESS=127.0.0.1:3003(修掉旧 3500/3503)
bash scripts/on-stack.sh main demo:all       # 8/8 PASS
bash scripts/on-stack.sh main recon:demo:reset && bash scripts/on-stack.sh main recon:demo:pass  # PASS
bash scripts/on-stack.sh main verify:coa     # ALL INVARIANTS PASS
```
Expected: main `.env` 被自愈为正确 3000-3003;`demo:all` 8/8、`recon:demo:pass`、`verify:coa` 全绿——证明 ②改动对 main 演示路径是改进、无回归。

> ⚠️ 若 `on-stack.sh` 报 `ts-node: command not found`(非交互 shell PATH 问题),改用 `DATABASE_URL="file:/tmp/exchange_js_main/dev.db" TB_ADDRESS="127.0.0.1:3003" npm run <script>` 等价跑(npm 会补 `node_modules/.bin` 到 PATH)。

- [ ] **Step 3: 记录结果**(无需提交;把两步的关键输出贴回作为验收证据)

---

## 完成判定(对齐 spec §4 验收)

- □ `stack-env.test.sh` 全绿(自愈 + 保留键 + 幂等)。
- □ worktree live:脏 .env 一 up 自愈,前端指向本栈后端(非 3000)。
- □ 端口隔离:本 worktree 用 B 段,不碰 main 的 3000-3003。
- □ `.nvmrc`=20;`.env.example` 有 banner。
- □ CLAUDE.md 有「起分支服务铁律」。
- □ **main 不回归**:`up main` 自愈 .env 为 3000-3003;`demo:all` 8/8、`recon:demo:pass`、`verify:coa` PASS。
