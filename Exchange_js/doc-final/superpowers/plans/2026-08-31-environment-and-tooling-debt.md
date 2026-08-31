# 环境与工具债收口 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Node 版本分裂、检查覆盖盲区、红名单积压、跨栈默认值、栈脚本三处失效一次性堵上，并给工具/环境债开一个「要读要清」的去处。

**Architecture:** 六类问题里五类直接改根因（改完就不存在，不进任何文件）；只有"孤儿进程/残留目录"这类每日变化的运行时状态，挂到 `stack.sh up` 这条本来就必跑的命令上报告。剩下真修不了、机器也查不出来的，才进新建的 `TOOLING-DEBT.md`。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle ｜ jest（后端 + admin-web）／ vitest（client-web）｜ bash 栈脚本 ｜ nvm

**设计稿：** `doc-final/superpowers/specs/2026-08-31-environment-and-tooling-debt-design.md`（commit `70f1e8a6`）

---

## Global Constraints

以下为全局要求，**每个任务隐含包含**，不再逐条重复：

1. **Node 版本**：目标 `>=20`。本机可用 `v20.20.2`（`~/.nvm/versions/node/v20.20.2/bin/node`）。执行任何闸门前先确认 `node -v`；Task B1 之后可依赖自动垫片。
2. **在 worktree 内做**（`CLAUDE.md §10`）：本轮改 `tsconfig` / `package.json` / 栈脚本并删 10 个文件，直接在 main 上做会打断两个并行会话（`act1-permissions` 端口块 3100、`recon-adj1` 端口块 3110）。栈命令一律用 `self`。
3. **禁做清单**（`CLAUDE.md §2`）：幂等 ｜ 去重 ｜ 重试与回放 ｜ 补偿与 repair ｜ 并发锁 ｜ 兼容层 ｜ 权限加固 ｜ 输入防御性校验 ｜ 性能优化 ｜ 边界防御 ｜ 为让测试通过而修测试框架。
4. **测试的绿必须来自行为**；**禁止写「扫源码文本」型断言**（`toContain('某字符串')` 扫源码一律不算）。
5. **不动 schema**、不写 backfill / 兼容层。
6. **改完代码跑随手闸**：`npx tsc --noEmit -p tsconfig.json` ／ `cd admin-web && npx tsc -b --noEmit` ／ `cd client-web && npx tsc -b --noEmit`。
7. **每个任务开场必须列「本任务做 / 不做」**（`CLAUDE.md §6`）。
8. **跨栈铁律**：只碰自己 worktree 的端口段和 DB，禁止访问 `3000-3003`（main）、`3100-3103`、`3110-3113`（两个并行会话）。

---

## 文件结构

**删除（10 个，1310 行）**
```
scripts/backfill-internal-fund-keys.ts              69
scripts/e2e-confiscation-async.ts                  297
scripts/verify-swap-self-heal.ts                   248
scripts/verify-swap-redesign-happy.ts              163
scripts/repair-duplicate-deposit-final-decisions.ts 161
scripts/verify-p6-lock-release.ts                  147
scripts/t7-autoheal-test.ts                        110
scripts/t7-idempotency-test.ts                      82
scripts/probe-tb-pending.ts                         26
scripts/dev-start-all.sh                             7
tsconfig.test.json                              （冗余，A2 删）
```

**新建**
```
.npmrc                             engine-strict=true
scripts/node-env.sh                Node>=20 垫片(从 stack-up.sh 提取,唯一副本)
scripts/require-node.js            jest setupFiles 用的版本断言
scripts/require-stack-env.ts       缺 DATABASE_URL/TB_ADDRESS 时 fail-fast
scripts/check-stack-residue.sh     孤儿进程 + 残留目录报告(只报不删)
doc-final/TOOLING-DEBT.md          第三个桶
```

**修改**
```
package.json                       engines / 剥 23 处内联默认值 / 加 sumsub:smoke 入口
tsconfig.json                      include 加 test,scripts,prisma
jest.config.js                     roots 摘 client-web/src + setupFiles
admin-web/tsconfig.app.json        exclude 去掉 src/**/*.spec.ts
scripts/stack-up.sh                source node-env.sh / 绝对路径启动 / 端口自愈 / 调 residue
scripts/stack-common.sh            ensure_port_free 自愈 / load_stack_config 拒绝跨树操作 main
scripts/stack-stop.sh              补 tb 兜底
scripts/on-stack.sh                source node-env.sh
scripts/reset-stack.sh             去掉 ${TB_PORT:-3003}
scripts/demo-lib.ts                import require-stack-env(覆盖 7 个入口)
scripts/recon-rerun.ts             同上(独立入口)
scripts/verify-demo-data.ts        同上(独立入口)
18 个文件                          删 webcrypto 垫片
src/.../system-wallet.util.spec.ts 改陈旧断言
src/.../wallets.service.spec.ts    改陈旧断言
CLAUDE.md                          §4 债的分流 / §7 闸门清单
doc-final/demo/baseline.md         判据改全绿 / 红名单整节退役
doc-final/PRODUCTION-NOTES.md      迁出 24 条工具类
```

---

## 任务依赖

```
Task 1 [A1] 删死码 ──> Task 2 [A2] 检查覆盖补齐

Task 3 [B1] Node三入口 ──┬─> Task 4  [B2] 清 18 个垫片
                          └─> Task 5  [C1] 红名单前三条 ──> Task 6 [C2] 判据改全绿

Task 7  [D1] 默认值        （独立）
Task 8  [D2] 栈脚本四洞 ──> Task 9 [D3] 残留检查 + 闸门补两条
Task 10 [E1] TOOLING-DEBT （独立，但需 1-9 的结果来判哪些条目销账）

                        全部完成 ──> Task 11 [E2] 收尾验收
```

---

### Task 1: [A1] 删死码（10 个文件，1310 行）

**本任务做：** 删除 10 个已证死的脚本文件，并清掉文档里对它们的引用。
**本任务不做：** 不删 `stack-env.test.sh` 和 `sumsub-deposit-smoke.ts`（这两个是活的，D3 会给它们入口）；不动 `tsconfig`（A2 做）；不清其它"未被调用但能跑"的脚本。

**Files:**
- Delete: `scripts/backfill-internal-fund-keys.ts`
- Delete: `scripts/e2e-confiscation-async.ts`
- Delete: `scripts/verify-swap-self-heal.ts`
- Delete: `scripts/verify-swap-redesign-happy.ts`
- Delete: `scripts/repair-duplicate-deposit-final-decisions.ts`
- Delete: `scripts/verify-p6-lock-release.ts`
- Delete: `scripts/t7-autoheal-test.ts`
- Delete: `scripts/t7-idempotency-test.ts`
- Delete: `scripts/probe-tb-pending.ts`
- Delete: `scripts/dev-start-all.sh`
- Modify: `doc-final/PRODUCTION-NOTES.md`（划掉指向已删文件的条目）

**Interfaces:**
- Produces: A2 依赖"删完后 `tsconfig.json` 加 `scripts/**/*` 报 0 错"这个事实。

- [ ] **Step 1: 删前取证——确认这 10 个确实无人调用**

```bash
cd /path/to/worktree/Exchange_js
for f in backfill-internal-fund-keys e2e-confiscation-async verify-swap-self-heal \
         verify-swap-redesign-happy repair-duplicate-deposit-final-decisions \
         verify-p6-lock-release t7-autoheal-test t7-idempotency-test probe-tb-pending; do
  npm_ref=$(node -p "Object.values(require('./package.json').scripts).filter(v=>v.includes('$f')).length")
  imp=$(grep -rl "$f" --include='*.ts' src test prisma 2>/dev/null | wc -l | tr -d ' ')
  sh_ref=$(grep -rl "$f" --include='*.sh' scripts 2>/dev/null | wc -l | tr -d ' ')
  printf "%-46s npm=%s import=%s sh=%s\n" "$f" "$npm_ref" "$imp" "$sh_ref"
done
grep -c "branch" scripts/stack.sh   # dev-start-all.sh 委托的栈
```

Expected：每一行 `npm=0 import=0 sh=0`；最后一行 `0`（`stack.sh` 已无 `branch` 栈）。
**任一行不为 0 就停下报告，不要删。**

- [ ] **Step 2: 记录基线——删之前 jest 的数字**

```bash
npx jest --silent 2>&1 | tail -5
```

Expected（Node 20 下）：`Test Suites: 3 failed, 163 passed, 166 total` / `Tests: 4 failed, 2 skipped, 4 todo, 2053 passed, 2063 total`
把这两行抄下来，Step 5 要比。

- [ ] **Step 3: 删除**

```bash
git rm scripts/backfill-internal-fund-keys.ts \
       scripts/e2e-confiscation-async.ts \
       scripts/verify-swap-self-heal.ts \
       scripts/verify-swap-redesign-happy.ts \
       scripts/repair-duplicate-deposit-final-decisions.ts \
       scripts/verify-p6-lock-release.ts \
       scripts/t7-autoheal-test.ts \
       scripts/t7-idempotency-test.ts \
       scripts/probe-tb-pending.ts \
       scripts/dev-start-all.sh
```

- [ ] **Step 4: 清掉 PRODUCTION-NOTES 里指向已删文件的条目**

用 grep 找出来（会命中 2 条：约 100 行的 `e2e-confiscation-async`、约 220 行的 `backfill-internal-fund-keys`）：

```bash
grep -n "e2e-confiscation-async\|backfill-internal-fund-keys" doc-final/PRODUCTION-NOTES.md
```

把这两条整条删掉（不是打勾），并在文件末尾追加一行：

```markdown
- [x] ~~上述 2 条随 `scripts/` 死码清理一并销账（2026-08-31 环境收口 Task A1）：`e2e-confiscation-async.ts` 的没收覆盖已由 3 个 e2e + 7 个单测承接；`backfill-internal-fund-keys.ts` 引用的 `InternalFund` 表早已 DROP~~
```

- [ ] **Step 5: 验证——jest 数字不变、tsc 全绿**

```bash
npx tsc --noEmit -p tsconfig.json && echo "tsc OK"
npx jest --silent 2>&1 | tail -5
```

Expected：`tsc OK`；jest 两行数字与 Step 2 **逐字相同**（删的是无人调用的脚本，不该影响任何测试）。

- [ ] **Step 6: Commit**

```bash
git add -A scripts doc-final/PRODUCTION-NOTES.md
git commit -m "chore(scripts): 删 10 个已证死脚本(1310 行)

四项全零判定:npm 引用 0 / 被 import 0 / 被 sh 调 0 / 现行文档引用 0。
其中 4 个直接命中禁做清单(幂等/自愈/repair+去重);
e2e-confiscation-async 的没收覆盖已由 3 e2e + 7 单测承接;
dev-start-all.sh 委托的 branch 栈 2026-06-25 已删除。
jest 数字删前删后逐字相同。"
```

---

### Task 2: [A2] 检查覆盖补齐（scripts 1/29 → 20/20）

**本任务做：** 把 `test/` `scripts/` `prisma/` 纳入后端 tsc；删冗余的 `tsconfig.test.json`；把 admin-web 的 `.spec.ts` 纳入前端 tsc；同步 `CLAUDE.md §7` 与 `baseline.md` 绿名单。
**本任务不做：** 不改任何被新纳入文件的实现（若报错说明有真问题，停下报告）；不加 `.spec.tsx` 支持；不动 jest 配置（C1 做）。

**Files:**
- Modify: `tsconfig.json:22`
- Delete: `tsconfig.test.json`
- Modify: `admin-web/tsconfig.app.json:29`
- Modify: `../CLAUDE.md`（§7 随手闸清单）
- Modify: `doc-final/demo/baseline.md:12`（绿名单"编译"行）

**Interfaces:**
- Consumes: Task A1 已删的 10 个文件（否则 `backfill-internal-fund-keys.ts` 会报 2 个错）。
- Produces: 此后 `npx tsc --noEmit -p tsconfig.json` 覆盖 `src/ test/ scripts/ prisma/` 四个目录。

- [ ] **Step 1: 先证明现在照不到——插一个故意的类型错**

```bash
cp scripts/demo-all.ts /tmp/demo-all.bak
printf '\nconst __probe: number = "字符串塞进 number";\nvoid __probe;\n' >> scripts/demo-all.ts
npx tsc --noEmit -p tsconfig.json; echo "exit=$?"
```

Expected：`exit=0` —— **闸①对 `scripts/demo-all.ts` 完全无感**。这就是要修的东西。

- [ ] **Step 2: 改 `tsconfig.json` 的 include**

`tsconfig.json` 第 22 行：

```json
  "include": ["src/**/*", "test/**/*", "scripts/**/*", "prisma/**/*"],
```

- [ ] **Step 3: 再跑一次——现在必须照到**

```bash
npx tsc --noEmit -p tsconfig.json; echo "exit=$?"
```

Expected：`exit=2`，且输出含 `scripts/demo-all.ts(...): error TS2322: Type 'string' is not assignable to type 'number'.`

- [ ] **Step 4: 还原探针，确认干净基线是 0 错**

```bash
cp /tmp/demo-all.bak scripts/demo-all.ts && rm /tmp/demo-all.bak
git diff --stat scripts/demo-all.ts   # 必须无输出
npx tsc --noEmit -p tsconfig.json && echo "全绿 0 错"
```

Expected：`git diff --stat` 无输出；`全绿 0 错`。
**若有错，停下报告——说明 A1 没删干净或有真问题。**

- [ ] **Step 5: 删冗余的 `tsconfig.test.json`**

它的 `include` 是 `["src/**/*","test/**/*"]`，已被 Step 2 完全覆盖。

```bash
grep -rn "tsconfig.test" package.json jest.config.js test/jest-e2e.json doc-final --exclude-dir=archive
```

先看引用点（预期只有 `doc-final/demo/baseline.md` 一处），然后：

```bash
git rm tsconfig.test.json
```

- [ ] **Step 6: admin-web 的 `.spec.ts` 纳入 tsc**

`admin-web/tsconfig.app.json` 最后一行，把 `.spec.ts` 从 exclude 里去掉（`.spec.tsx` 保留——本仓库不支持组件测试，留着免得空跑报错）：

```json
  "exclude": ["src/**/*.spec.tsx"]
```

- [ ] **Step 7: 验证 admin-web**

```bash
cd admin-web && npx tsc -b --noEmit; echo "exit=$?"; cd ..
```

Expected：`exit=0`。若报错，说明 admin-web 的 spec 里有真类型错（PRODUCTION-NOTES:101 预告过），**修那个类型错，不要退回 exclude**。

- [ ] **Step 8: 同步两份文档的闸门定义**

`CLAUDE.md §7` 的代码块改为（① 的注释说明覆盖范围）：

```bash
npx tsc --noEmit -p tsconfig.json               # ① 后端（含 src / test / scripts / prisma）
cd admin-web  && npx tsc -b --noEmit && cd ..    # ② 管理台（.tsx 与 .spec.ts 只有②③编译得到）
cd client-web && npx tsc -b --noEmit && cd ..    # ③ 客户端
```

`doc-final/demo/baseline.md` 第 12 行（绿名单"编译"行）改为：

```markdown
| 编译 | tsc 后端（src / test / scripts / prisma 四目录）｜ tsc 管理台（含 .spec.ts）｜ tsc 客户端 |
```

（原文里的"tsc test 配置（tsconfig.test.json）"删掉——该配置已随本任务移除。）

- [ ] **Step 9: 三道随手闸全跑一遍**

```bash
npx tsc --noEmit -p tsconfig.json && \
(cd admin-web && npx tsc -b --noEmit) && \
(cd client-web && npx tsc -b --noEmit) && echo "三闸全绿"
```

Expected：`三闸全绿`

- [ ] **Step 10: Commit**

```bash
git add -A tsconfig.json admin-web/tsconfig.app.json ../CLAUDE.md doc-final/demo/baseline.md
git commit -m "build(tsc): 闸①覆盖 src/test/scripts/prisma 四目录,scripts 从 1/29 到 20/20

收尾闸⑥⑦⑧的执行体(demo-all/demo-lib/recon-demo/verify-*)此前不受任何
类型检查——2026-08-29 demo-lib 的 export-from 误用即因此闸①全绿放行、
跑 demo:all 才炸。删冗余的 tsconfig.test.json(include 已被覆盖),
admin-web 的 .spec.ts 纳入 tsc,并同步 CLAUDE.md §7 与 baseline 绿名单
此前对'闸门是什么'的不一致定义。"
```

---

### Task 3: [B1] Node 20 归一 —— 三个入口各堵一处

**本任务做：** 加 `engines` + `.npmrc`；把 `stack-up.sh` 里的 nvm 垫片提取为唯一副本 `scripts/node-env.sh` 并让 `on-stack.sh` 也用；给 jest 加版本断言。
**本任务不做：** 不清 webcrypto 垫片（B2 做）；不改 Dockerfile（本来就是 node:20）；不动 `.nvmrc`（本来就是 20）。

**Files:**
- Create: `.npmrc`
- Create: `scripts/node-env.sh`
- Create: `scripts/require-node.js`
- Modify: `package.json`（加 `engines`）
- Modify: `scripts/stack-up.sh:10-24`（换成 source）
- Modify: `scripts/on-stack.sh`（加 source）
- Modify: `jest.config.js`（加 `setupFiles`）

**Interfaces:**
- Produces: `scripts/node-env.sh` 提供函数 `ensure_node20()`（无参，无返回值，副作用是把 Node≥20 的 bin 目录前置进 `PATH`）。B2 依赖"跑测试和脚本时 Node ≥20"这个前提。

- [ ] **Step 1: 先证明现在是分裂的**

```bash
echo "shell:   $(node -v)"
for p in $(cat .stackports 2>/dev/null | head -1); do
  pid=$(lsof -tiTCP:$p -sTCP:LISTEN 2>/dev/null | head -1)
  [ -n "$pid" ] && echo "服务:    $(lsof -p $pid -a -d txt -Fn 2>/dev/null | grep '^n/' | head -1 | cut -c2- | xargs -I{} sh -c '{} -v')"
done
node -p "require('./package.json').engines || '(engines 未声明)'"
node -p "require('./node_modules/@nestjs/core/package.json').engines.node"
```

Expected：shell 是 `v18.20.8`（若已被垫片影响则可能是 v20）；`engines 未声明`；`@nestjs/core` 要求 `>= 20`。

- [ ] **Step 2: 提取垫片为唯一副本**

新建 `scripts/node-env.sh`：

```bash
#!/usr/bin/env bash
# Node >= 20 的唯一垫片副本。
#
# 为什么需要：本仓库声明层全部指向 Node 20（.nvmrc / Dockerfile ×3 /
# @nestjs/core 的 engines.node = ">= 20"），但从 2026-04-08 起实际跑在 18 上，
# 靠 21 个文件手写 webcrypto 垫片绕过 `globalThis.crypto`（Node ≥19 才有）。
# 此前这段逻辑只在 stack-up.sh 里、且只对服务生效，于是形成
# 「服务跑 20 / 一切验证工具跑 18」的分裂。
#
# 用法：source 本文件后调用 ensure_node20。幂等，可重复 source。
ensure_node20() {
  local major nvm_dir n20 n22 best
  major="$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)"
  if [[ -n "${major}" && "${major}" -ge 20 ]]; then
    return 0
  fi
  nvm_dir="${NVM_DIR:-${HOME}/.nvm}"
  n20="$(ls -d "${nvm_dir}/versions/node"/v20.*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
  n22="$(ls -d "${nvm_dir}/versions/node"/v22.*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
  best="${n22:-${n20}}"
  if [[ -n "${best}" ]]; then
    export PATH="$(dirname "${best}"):${PATH}"
    echo "[node-env] Node $(node --version) loaded from nvm (仓库要求 >=20)"
  else
    echo "[node-env] ERROR: 找不到 Node >=20。请先 'nvm install 20'。" >&2
    return 1
  fi
}
```

- [ ] **Step 3: `stack-up.sh` 换成 source**

删掉 `scripts/stack-up.sh` 第 10–24 行那整段（从 `# Ensure Node.js >= 20 is on PATH` 到对应的 `fi`），换成：

```bash
# shellcheck source=./node-env.sh
source "${SCRIPT_DIR}/node-env.sh"
ensure_node20
```

（`SCRIPT_DIR` 在第 4 行已定义，这两行放在 `source stack-common.sh` 之后。）

- [ ] **Step 4: `on-stack.sh` 加同款 source**

`scripts/on-stack.sh` 在 `source "${SCRIPT_DIR}/stack-common.sh"` 那行之后插入：

```bash
# shellcheck source=./node-env.sh
source "${SCRIPT_DIR}/node-env.sh"
ensure_node20
```

- [ ] **Step 5: 验证脚本入口已自动切**

```bash
node -v                                             # 你的 shell，可能还是 18
bash scripts/on-stack.sh self verify:audit 2>&1 | head -6
```

Expected：输出里出现 `[node-env] Node v20.x loaded from nvm (仓库要求 >=20)`。

- [ ] **Step 6: 加 `engines` + `.npmrc`**

`package.json` 顶层加（放在 `"version"` 之后）：

```json
  "engines": {
    "node": ">=20"
  },
```

新建 `.npmrc`：

```
engine-strict=true
```

- [ ] **Step 7: 验证装依赖入口会拒绝**

```bash
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" npm ls --depth=0 >/dev/null 2>&1
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" npm install --dry-run 2>&1 | grep -i "engine\|EBADENGINE" | head -3
```

Expected：出现 `EBADENGINE` 或 `Unsupported engine` 字样。

- [ ] **Step 8: 给 jest 加版本断言**

新建 `scripts/require-node.js`：

```javascript
// jest setupFiles 用的版本断言。
//
// 为什么：Node 18 缺 globalThis.crypto（Node ≥19 才有），在 18 上跑测试会得到
// 一片 "crypto is not defined" 的红——那是验收台的问题，不是代码的问题。
// 本仓库 2026-08-31 把 21 个手写 webcrypto 垫片清掉后，这类红会更多更散，
// 所以这里 fail-fast，给一句能看懂的话，而不是一屏红。
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  throw new Error(
    `本仓库要求 Node >= 20，当前 v${process.versions.node}。\n` +
      `修法：nvm use 20（或 nvm install 20）。\n` +
      `说明：.nvmrc / Dockerfile / @nestjs/core 均要求 20；Node 18 缺 globalThis.crypto。`,
  );
}
```

`jest.config.js` 加一行（放在 `testEnvironment` 之后）：

```javascript
  setupFiles: ['<rootDir>/scripts/require-node.js'],
```

- [ ] **Step 9: 验证测试入口会给可读报错**

```bash
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" npx jest src/common/utils/demo-roster.spec.ts 2>&1 | grep -A3 "Node >= 20" | head -6
```

Expected：出现 `本仓库要求 Node >= 20，当前 v18.20.8` 以及 `修法：nvm use 20`。

- [ ] **Step 10: 验证 Node 20 下一切正常，且红名单少一条**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
node -v
npx jest --silent 2>&1 | tail -5
```

Expected：`v20.20.2`；`Test Suites: 3 failed, 163 passed, 166 total` / `Tests: 4 failed, ...`
—— 比 Node 18 少 1 套 4 例，少的正是 `role-definition-create-workflow.service.spec.ts`（**没改一行生产代码**）。

- [ ] **Step 11: Commit**

```bash
git add -A .npmrc package.json jest.config.js scripts/node-env.sh scripts/require-node.js scripts/stack-up.sh scripts/on-stack.sh
git commit -m "build(node): Node 20 归一——三个入口各堵一处

此前：服务跑 v20.20.2(stack-up.sh 里有只对服务生效的 nvm 垫片),
而 shell/tsc/jest/ts-node/on-stack 全跑 v18.20.8——我们在 18 上验证、
在 20 上演示。声明层(.nvmrc/Dockerfile×3/@nestjs/core engines)全指向 20,
唯独 package.json 无 engines,无任何强制。

装依赖 → engines + .npmrc engine-strict,版本不对直接拒绝
跑脚本 → 垫片提取为 scripts/node-env.sh 唯一副本,stack-up + on-stack 共用
跑测试 → jest setupFiles 断言,给一句可读报错而非一屏红

副作用:红名单 role-definition-create-workflow 一套 4 例自动转绿,零代码改动。"
```

---

### Task 4: [B2] 清 18 个 webcrypto 垫片

**本任务做：** 删掉 18 个文件里手写的 `globalThis.crypto = webcrypto` 垫片及其 import。
**本任务不做：** 不改这些文件的任何其它行为；不动 `src/main.ts` 之外的启动顺序；不删 `node:crypto` 里**真正被用到**的其它导入（如 `createHash`）。

**Files（18 个）:**
- Modify: `src/main.ts:6`
- Modify: `scripts/demo-in-transit.ts`, `scripts/demo-lib.ts`, `scripts/recon-demo.ts`, `scripts/recon-rerun.ts`, `scripts/verify-demo-data.ts`（5 个）
- Modify: `test/customer-restrictions.e2e-spec.ts`, `test/demo-roster.e2e-spec.ts`, `test/deposit-money-arcs.e2e-spec.ts`, `test/deposit-sumsub-verdicts.e2e-spec.ts`, `test/kyt-verdict-landing.e2e-spec.ts`, `test/material-requests.e2e-spec.ts`, `test/sanction-subject-split.e2e-spec.ts`, `test/sla.e2e-spec.ts`, `test/swap-money-arc.e2e-spec.ts`, `test/swap-sumsub-scenarios.e2e-spec.ts`, `test/withdraw-money-arcs.e2e-spec.ts`, `test/withdraw-sumsub-scenarios.e2e-spec.ts`（12 个）

**Interfaces:**
- Consumes: Task B1 保证的 Node ≥20（有 `globalThis.crypto`）+ jest 版本断言（跑错版本时给可读报错）。

- [ ] **Step 1: 列出全部垫片位置**

```bash
grep -rn "webcrypto" --include='*.ts' src scripts test | sed 's/^/  /'
echo "文件数: $(grep -rl webcrypto --include='*.ts' src scripts test | wc -l | tr -d ' ')"
```

Expected：文件数 `18`（A1 已删掉带垫片的 3 个）。

- [ ] **Step 2: 先证明 Node 20 下不需要它们**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
node -p "typeof globalThis.crypto + ' / randomUUID: ' + typeof globalThis.crypto.randomUUID"
```

Expected：`object / randomUUID: function` —— 原生就有，垫片是纯死码。

- [ ] **Step 3: 逐个文件删除**

两种写法各删各的。

`src/main.ts` 第 6 行整行删除：

```typescript
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }
```

其余 17 个文件删两处：
1. `import { webcrypto } from 'node:crypto';` 整行删
   —— **例外**：若该行形如 `import { webcrypto, createHash } from 'node:crypto';`，只删 `webcrypto, `，保留其余导入
2. `if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;` 整行删
3. 紧邻的解释性注释（含 "Node 18 polyfill" / "Must precede every other import" / "Must run before any import that pulls AppModule" 等）一并删

- [ ] **Step 4: 确认清干净**

```bash
grep -rn "webcrypto" --include='*.ts' src scripts test; echo "剩余命中: $?"
```

Expected：无输出，`剩余命中: 1`（grep 无匹配返回 1）。

- [ ] **Step 5: 随手闸 + 全量 jest**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx tsc --noEmit -p tsconfig.json && echo "tsc OK"
npx jest --silent 2>&1 | tail -5
```

Expected：`tsc OK`；jest 仍是 `3 failed / 163 passed`、`4 failed / 2053 passed`（与 B1 Step 10 逐字相同）。
**特别注意**：`noUnusedLocals` 不在后端 tsconfig 里，所以残留的未用 import 不会报错——必须靠 Step 4 的 grep 确认。

- [ ] **Step 6: 行为验证——真跑一次造数**

垫片删对没有，`tsc` 证明不了，必须真跑（`@nestjs/schedule` 在模块加载期就调 `crypto.randomUUID()`）：

```bash
bash scripts/stack.sh reset self
bash scripts/on-stack.sh self demo:all 2>&1 | tail -30
```

Expected：跑完出现花名册答案键，**21/21 逐条符合预期**；无 `crypto is not defined`。

- [ ] **Step 7: Commit**

```bash
git add -A src/main.ts scripts test
git commit -m "chore(node): 清 18 个手写 webcrypto 垫片(Node 20 下是死码)

首次引入 dfcc0e04(2026-04-08),此后 145 天 51 次提交碰过它——
每个新脚本/新 e2e 都要粘同两行。Node 20 原生有 globalThis.crypto,
B1 已把三个入口都堵成 >=20,故全部退役。

验证不靠 tsc(后端 tsconfig 无 noUnusedLocals,残留 import 不报错):
靠 grep 清零 + demo:all 花名册 21/21 实跑(@nestjs/schedule 在模块
加载期就调 crypto.randomUUID,垫片删错必当场炸)。"
```

---

### Task 5: [C1] 红名单剩余三条清零

**本任务做：** 更新两个钱包 spec 的陈旧断言；把 `client-web/src` 从 jest 的 `roots` 里摘掉。
**本任务不做：** **不改任何生产代码**（这三条全是测试侧问题，代码是对的）；不给 admin-web 引入 vitest；不改 `baseline.md` 判据（C2 做）。

**Files:**
- Modify: `src/modules/asset-treasury/wallets/system-wallet.util.spec.ts:14-16, 26-27, 36`
- Modify: `src/modules/asset-treasury/wallets/wallets.service.spec.ts:56-73`
- Modify: `jest.config.js`（`roots`）
- Modify: `package.json`（`test:client` 无需改，只是进闸门清单——C2 做）

**Interfaces:**
- Consumes: Task B1 已让第 1 条（`role-definition-create-workflow`）转绿。
- Produces: `npx jest` 退出码 0，C2 依赖这个事实把判据改成"全绿"。

- [ ] **Step 1: 确认这三条的成因，并确认代码是对的**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx jest src/modules/asset-treasury/wallets 2>&1 | grep -E "●|Expected|Received|-   \"" | head -20
sed -n '1,25p' src/modules/asset-treasury/wallets/system-wallet.util.ts
```

Expected：报错是 `Expected - "C_MAIN", "C_OUT"` 而 `Received + 0`；实现文件的注释写明 C_MAIN/C_OUT 是 V7 时代的平台归集池、`no longer provisioned`。
**结论：实现是对的，测试的期望是 2026-06-27（`790a6685`）之后没跟着改的旧账。**

- [ ] **Step 2: 改 `system-wallet.util.spec.ts` 的三处陈旧断言**

第 13–17 行改为：

```typescript
    it('CRYPTO_SYSTEM_WALLET_ROLES contains correct roles', () => {
      // C_MAIN / C_OUT 是 V7 延迟结算时代的平台归集池，realtime 1:1 改造后
      // 加密提现直接从客户自己的 C_DEP 出金，两者已于 790a6685 退役。
      expect(CRYPTO_SYSTEM_WALLET_ROLES).toEqual([
        WalletRole.F_LIQ, WalletRole.F_OPS, WalletRole.F_FEE,
      ]);
    });
```

第 25–31 行改为：

```typescript
    it('PROTECTED_SYSTEM_WALLET_ROLES is union of both', () => {
      // 三个已退役的池角色都不该在保护集里：C_MAIN/C_OUT(790a6685)、C_CMA(b7b67405)
      expect(PROTECTED_SYSTEM_WALLET_ROLES).not.toContain(WalletRole.C_MAIN);
      expect(PROTECTED_SYSTEM_WALLET_ROLES).not.toContain(WalletRole.C_OUT);
      expect(PROTECTED_SYSTEM_WALLET_ROLES).not.toContain(WalletRole.C_CMA);
      expect(PROTECTED_SYSTEM_WALLET_ROLES).toContain(WalletRole.F_LIQ);
      expect(PROTECTED_SYSTEM_WALLET_ROLES).toContain(WalletRole.F_OPS);
      expect(PROTECTED_SYSTEM_WALLET_ROLES).toContain(WalletRole.F_SET);
      expect(PROTECTED_SYSTEM_WALLET_ROLES).toContain(WalletRole.F_FEE);
    });
```

第 34–38 行改为：

```typescript
  describe('isProtectedSystemWalletRole', () => {
    it('returns true for system roles', () => {
      expect(isProtectedSystemWalletRole(WalletRole.F_LIQ)).toBe(true);
      expect(isProtectedSystemWalletRole(WalletRole.F_SET)).toBe(true);
    });

    it('returns false for retired pool roles', () => {
      expect(isProtectedSystemWalletRole(WalletRole.C_MAIN)).toBe(false);
      expect(isProtectedSystemWalletRole(WalletRole.C_OUT)).toBe(false);
      expect(isProtectedSystemWalletRole(WalletRole.C_CMA)).toBe(false);
    });
```

（原有的 `returns false for customer roles`（C_DEP / C_VIBAN）保留不动。）

- [ ] **Step 3: 改 `wallets.service.spec.ts` 那条**

第 56–73 行：把 fixture 的 `walletRole` 从已退役的 `C_MAIN` 换成仍受保护的 `F_LIQ`，报错文案跟着换（服务端是 `` `${before.walletRole} wallets are system-provisioned and cannot be manually disabled` ``）：

```typescript
    it('should reject status changes for protected system wallet roles', async () => {
      (prisma as any).wallet.findUnique.mockResolvedValue({
        id: 'wallet-protected',
        walletNo: 'WA-SYS-001',
        walletRole: WalletRole.F_LIQ,
        ownerType: OwnerType.PLATFORM,
        ownerId: null,
        ownerNo: null,
        status: WalletStatus.ACTIVE,
      });

      await expect(
        service.changeStatus('wallet-protected', WalletStatus.DISABLED, mockActor),
      ).rejects.toThrow(
        'F_LIQ wallets are system-provisioned and cannot be manually disabled',
      );
      expect((prisma as any).wallet.update).not.toHaveBeenCalled();
    });
```

- [ ] **Step 4: 变异测试——证明这两个 spec 是真在盯着行为**

把生产代码人为改坏，测试必须变红：

```bash
cp src/modules/asset-treasury/wallets/system-wallet.util.ts /tmp/swu.bak
# 把 F_LIQ 从保护集里摘掉
sed -i '' 's/WalletRole.F_LIQ, WalletRole.F_OPS, WalletRole.F_FEE,/WalletRole.F_OPS, WalletRole.F_FEE,/' src/modules/asset-treasury/wallets/system-wallet.util.ts
npx jest src/modules/asset-treasury/wallets --silent 2>&1 | tail -4
cp /tmp/swu.bak src/modules/asset-treasury/wallets/system-wallet.util.ts && rm /tmp/swu.bak
```

Expected：改坏时**必须红**（两个 suite 都报失败）。若仍绿，说明断言是自证型的，**停下重写断言**。
还原后确认 `git diff --stat src/modules/asset-treasury/wallets/system-wallet.util.ts` 无输出。

- [ ] **Step 5: 证明 client-web 那条只是跑错运行器**

```bash
(cd client-web && npx vitest run 2>&1 | tail -6)
```

Expected：`Test Files 4 passed (4)` / `Tests 83 passed (83)` —— 包含 `restrictedCapabilities.spec.ts` 的 6 例。**它在正确的运行器下全绿。**

- [ ] **Step 6: 把 `client-web/src` 从 jest roots 摘掉**

`jest.config.js` 的 `roots` 改为：

```javascript
  // client-web 用 vitest（见 client-web/package.json 的 test 脚本）。此前它在
  // roots 里，于是 jest 会捡起 client-web/src 下的 *.spec.ts：写法用裸全局的
  // 3 个被重复跑一遍，显式 import vitest 的 restrictedCapabilities.spec.ts
  // 当场失败——这就是常年挂在红名单里那条。admin-web 无 vitest，保留在这里。
  roots: ['<rootDir>/src', '<rootDir>/admin-web/src'],
```

- [ ] **Step 7: 验证全绿**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx jest --silent 2>&1 | tail -5; echo "jest exit=$?"
npm run test:client 2>&1 | tail -5
```

Expected：
- jest：`Test Suites: 162 passed, 162 total`（166 减去摘掉的 4 个 client-web），**0 failed**，`jest exit=0`
- vitest：`Test Files 4 passed (4)` / `Tests 83 passed (83)`

- [ ] **Step 8: Commit**

```bash
git add -A src/modules/asset-treasury/wallets jest.config.js
git commit -m "test: 红名单剩余三条清零——两处陈旧断言 + 一处跑错运行器

零生产代码改动。三条成因各不相同,此前被'净新失败 0'的判据一并豁免:

- system-wallet.util.spec / wallets.service.spec: 断言仍期望 C_MAIN/C_OUT,
  而这两个角色 790a6685(2026-06-27)就随 realtime 1:1 改造退役了,红了 64 天。
  C_CMA 退役那轮改过其中一个文件第 28 行却没动同文件的旧断言——因为规矩
  只要求'别添新红'。已补齐三个退役角色的反向断言,并做变异测试确认非自证型。
- client-web/restrictedCapabilities.spec: vitest 文件被 jest 捡起。
  单跑 vitest 是 83/83 全绿。已把 client-web/src 从 jest roots 摘掉,
  同目录另 3 个裸全局写法的 spec 也不再被重复跑两遍。admin-web 无 vitest,保留。

至此 npx jest 退出码 0。"
```

---

### Task 6: [C2] 判据从「净新失败 0」改成「全绿」

**本任务做：** 改 `baseline.md` 判据、退役红名单整节、把 `test:client` 与 e2e 口径写清；核实 `swap-sumsub-scenarios.e2e-spec.ts` 到底红不红；同步 `CLAUDE.md §7` 的 ④。
**本任务不做：** 不改任何代码；**不修 e2e**（若核实确红，登记后另开一轮）；不动 e2e 的判据。

**Files:**
- Modify: `doc-final/demo/baseline.md`（判据铁律行、绿名单、红名单整节、e2e 节）
- Modify: `../CLAUDE.md §7`（④ 那条）
- Modify: `doc-final/PRODUCTION-NOTES.md`（第 91 条核实结果）

**Interfaces:**
- Consumes: Task C1 产出的 `npx jest` 退出码 0。

- [ ] **Step 1: 核实 e2e 那条疑似陈账**

`baseline.md` 说 e2e 11 套 83/83 全绿；`PRODUCTION-NOTES:91` 说 `swap-sumsub-scenarios.e2e-spec.ts` 常年 9/9 全红。**两者必有一错。**

```bash
grep -n "swap-sumsub-scenarios" doc-final/PRODUCTION-NOTES.md | head -2
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
bash scripts/on-stack.sh self test:e2e --runInBand test/swap-sumsub-scenarios.e2e-spec.ts 2>&1 | tail -20
```

（e2e 跑法三要素见 `baseline.md`：私库先铺、串行跑、干净态起跑。若因私库未铺而挂，先按 `baseline.md` 的步骤铺库再跑。）

记下结果：**全绿 → 第 91 条是陈账，删掉；仍红 → 第 91 条属实，`baseline.md` 的 83/83 是错的，改 baseline 并把这条迁进 Task E1 的 TOOLING-DEBT。**

- [ ] **Step 2: 改判据铁律**

`doc-final/demo/baseline.md` 第 4 行改为：

```markdown
> **判据铁律：一切验证以「全绿」为准。** 2026-08-31 环境收口把红名单清零后，判据从
> 「净新失败 = 0」（相对，需人工比对上一轮数字）升级为「全绿」（绝对，机器可判：
> `npx jest` 退出码 0）。**任何红都是事故**，没有"这条是旧账"的退路；真有一时修不了的，
> 须当场决定修或由业主正式豁免并记入 `TOOLING-DEBT.md`，不得默留。
```

- [ ] **Step 3: 退役红名单整节**

删掉 `## 红名单（已知旧账，允许持续红）` 整节（含那 4 条列表），换成：

```markdown
## 红名单 —— 已于 2026-08-31 清零并退役

原有 4 条，实为四种互不相干的成因，被"净新失败 0"的判据一并豁免了最久 64 天：

| 原条目 | 真实成因 | 处置 |
|---|---|---|
| `role-definition-create-workflow.service.spec.ts` | Node 18 缺 `globalThis.crypto` | Node 20 归一后自动转绿，零代码改动 |
| `system-wallet.util.spec.ts` | 断言仍期望 790a6685 退役的 `C_MAIN`/`C_OUT` | 改断言（代码是对的），并补三个退役角色的反向断言 |
| `wallets.service.spec.ts` | 同上 | fixture 换成仍受保护的 `F_LIQ` |
| `client-web/.../restrictedCapabilities.spec.ts` | vitest 文件被 jest 捡起 | `client-web/src` 从 jest `roots` 摘除；vitest 下本来就 83/83 全绿 |

**此后本节不再接受新条目。** 工具/环境类的已知问题去 `doc-final/TOOLING-DEBT.md`。
```

- [ ] **Step 4: 绿名单补 vitest 与栈脚本单测**

`baseline.md` 绿名单表格加两行：

```markdown
| 单测 | `npx jest` **全绿**（162 套，退出码 0）｜ `npm run test:client`（vitest 4 套 83 例） |
| 栈 | `bash scripts/stack-env.test.sh`（`ensure_env_files` 权威重写的 5 项断言） |
```

- [ ] **Step 5: 同步 `CLAUDE.md §7` 的 ④**

把 ④ 那条改为：

```markdown
- ④ jest 只跑本任务相关目录，判据 = **全绿**（红名单 2026-08-31 已清零退役）；改了 client-web 另跑 `npm run test:client`（vitest）；改了栈脚本另跑 `bash scripts/stack-env.test.sh`
```

- [ ] **Step 6: 落 Step 1 的核实结果**

若 e2e 全绿：删掉 `PRODUCTION-NOTES.md` 第 91 条，并在文末追加：

```markdown
- [x] ~~`swap-sumsub-scenarios.e2e-spec.ts` 常年 9/9 全红——2026-08-31 环境收口实跑核实**已不复现**（应是第二批 FROZEN 口径落地后被某轮顺带修好，条目未回收）。此为本轮核实出的第三处陈账~~
```

若仍红：把该条**原样迁入** `TOOLING-DEBT.md`（Task E1 建立），并把 `baseline.md` e2e 节的 `83/83` 改成实测数字。

- [ ] **Step 7: 验证判据可执行**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx jest --silent >/dev/null 2>&1; echo "jest exit=$?"
npm run test:client >/dev/null 2>&1; echo "vitest exit=$?"
bash scripts/stack-env.test.sh >/dev/null 2>&1; echo "stack-env exit=$?"
```

Expected：三行都是 `exit=0` —— 新判据机器可判，不需要人工比对。

- [ ] **Step 8: Commit**

```bash
git add -A doc-final/demo/baseline.md doc-final/PRODUCTION-NOTES.md ../CLAUDE.md
git commit -m "docs(baseline): 判据从'净新失败 0'升级为'全绿',红名单整节退役

相对判据需人工比对上一轮数字,且已比错过——2026-08-30 差点把一个真问题
当旧账放过。绝对判据机器可判(npx jest 退出码 0)。

代价明示写进铁律:此后任何红都是事故,没有'这条是旧账'的退路;
真修不了的须当场决定修或由业主正式豁免并记入 TOOLING-DEBT.md。

顺带核实 PRODUCTION-NOTES:91 的 swap e2e 那条(baseline 说全绿、
待办说常年全红,两者必有一错)。"
```

---

### Task 7: [D1] 默认值不再偷偷指向主账本

**本任务做：** 剥掉 12 个 npm 脚本里的 23 处内联默认值；加 fail-fast 守卫；删 `reset-stack.sh` 的 `${TB_PORT:-3003}`。
**本任务不做：** 不改 `on-stack.sh` 的剥离逻辑（它本来就剥）；不给守卫加"自动推断该用哪个栈"的智能（那是猜，猜错更糟）。

**Files:**
- Create: `scripts/require-stack-env.ts`
- Modify: `package.json`（12 个脚本）
- Modify: `scripts/demo-lib.ts`（顶部 import，覆盖 7 个入口）
- Modify: `scripts/recon-rerun.ts`（独立入口）
- Modify: `scripts/verify-demo-data.ts`（独立入口）
- Modify: `scripts/reset-stack.sh:54`

**Interfaces:**
- Produces: `scripts/require-stack-env.ts` 是**副作用模块**（import 即执行，无导出）。缺 `DATABASE_URL` 或 `TB_ADDRESS` 时 `process.exit(1)`。`verify-demo-data.ts` 不需要 TB，故该模块只在 `TB_ADDRESS` 缺失时警告而非退出——见 Step 2 的 `requireTb` 参数。

- [ ] **Step 1: 先证明现在会连上 main 的账本**

```bash
node -e "
const s=require('./package.json').scripts;
const hit=Object.entries(s).filter(([k,v])=>/DATABASE_URL:-|TB_ADDRESS:-/.test(v));
console.log('命中脚本:', hit.length);
console.log('其中默认到 main TB(3003) 的:', hit.filter(([k,v])=>v.includes('127.0.0.1:3003')).length);
console.log('样例:', hit[0][0], '=>', hit[0][1].slice(0,110));
"
grep -n 'TB_PORT:-3003' scripts/reset-stack.sh
```

Expected：`命中脚本: 12`；`默认到 main TB(3003) 的: 11`；`reset-stack.sh:54` 命中一处。
**含义**：worktree 内漏用 `on-stack.sh` 直接 `npm run demo:all` → 读自己的空库、写 main 的账本，且不报错。

- [ ] **Step 2: 建守卫**

新建 `scripts/require-stack-env.ts`：

```typescript
// scripts/require-stack-env.ts
//
// 副作用模块：import 即执行。缺栈环境变量时 fail-fast。
//
// 为什么：本仓库有多套并行的栈（main + 每个 worktree 一套），各有各的 DB 和账本。
// 此前 12 个 npm 脚本写着 DATABASE_URL="${DATABASE_URL:-file:./dev.db}" 与
// TB_ADDRESS="${TB_ADDRESS:-127.0.0.1:3003}" —— 后者是 **main 的 TigerBeetle**。
// 于是在 worktree 里漏套 on-stack.sh 直接跑造数，结果是"读自己的空库、
// 写 main 的账本"，而且**不报错**。那些默认值已于 2026-08-31 全部剥除，
// 这个守卫负责把"没设置"变成一句能看懂的话。
//
// 不做自动推断：猜错栈比报错更糟。

function fail(missing: string[]): never {
  const script = process.argv[1]?.split('/').pop() ?? '(unknown)';
  console.error(
    [
      '',
      `✗ ${script} 缺少栈环境变量: ${missing.join(', ')}`,
      '',
      '  这些脚本必须绑定到某一个栈的 DB + TigerBeetle 上跑。正确用法：',
      '',
      '    bash scripts/on-stack.sh main <npm-script>    # 主工作树',
      '    bash scripts/on-stack.sh self <npm-script>    # worktree 内',
      '',
      '  包装器会解析该栈的 DATABASE_URL / TB_ADDRESS / TB_DATA_FILE 再执行。',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

export function requireStackEnv(opts: { requireTb: boolean }): void {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (opts.requireTb && !process.env.TB_ADDRESS) missing.push('TB_ADDRESS');
  if (missing.length > 0) fail(missing);
}
```

- [ ] **Step 3: 三处入口接上守卫**

`scripts/demo-lib.ts` —— 在文件顶部注释块之后、其它 import 之前插入（它被 7 个入口 import：demo-all / demo-setup / demo-deposit / demo-swap / demo-withdraw / demo-in-transit / recon-demo）：

```typescript
import { requireStackEnv } from './require-stack-env';
requireStackEnv({ requireTb: true });
```

`scripts/recon-rerun.ts` —— 同样两行插在最前面的 import 之前。

`scripts/verify-demo-data.ts` —— 该脚本只读 SQLite、不连 TB，故：

```typescript
import { requireStackEnv } from './require-stack-env';
requireStackEnv({ requireTb: false });
```

- [ ] **Step 4: 剥掉 12 个脚本的内联默认值**

`package.json` 里这 12 个脚本，把开头的 `DATABASE_URL="..." TB_ADDRESS="..."` 前置赋值整段删掉，只留命令本体：

```json
    "recon:demo": "ts-node -r tsconfig-paths/register scripts/recon-demo.ts",
    "recon:demo:pass": "ts-node -r tsconfig-paths/register scripts/recon-demo.ts --mode=pass",
    "recon:demo:break": "ts-node -r tsconfig-paths/register scripts/recon-demo.ts --mode=break",
    "recon:demo:reset": "ts-node -r tsconfig-paths/register scripts/recon-demo.ts --mode=reset",
    "recon:rerun": "ts-node -r tsconfig-paths/register scripts/recon-rerun.ts",
    "demo:in-transit": "ts-node -r tsconfig-paths/register scripts/demo-in-transit.ts",
    "demo:setup": "ts-node -r tsconfig-paths/register scripts/demo-setup.ts",
    "demo:deposit": "ts-node -r tsconfig-paths/register scripts/demo-deposit.ts",
    "demo:swap": "ts-node -r tsconfig-paths/register scripts/demo-swap.ts",
    "demo:withdraw": "ts-node -r tsconfig-paths/register scripts/demo-withdraw.ts",
    "demo:all": "ts-node -r tsconfig-paths/register scripts/demo-all.ts",
    "verify:demo-data": "ts-node -r tsconfig-paths/register scripts/verify-demo-data.ts",
```

- [ ] **Step 5: 删 `reset-stack.sh` 的 3003 默认**

`scripts/reset-stack.sh` 第 54 行：

```bash
    if lsof -ti:"${TB_PORT}" >/dev/null 2>&1; then
```

（`TB_PORT` 由第 22 行的 `load_stack_config` 必然设好；回落到 3003 会让本栈误判 main 的 TB 为"自己已就绪"。）

- [ ] **Step 6: 反向验证——不套包装器必须当场报错**

```bash
env -u DATABASE_URL -u TB_ADDRESS npm run demo:all 2>&1 | head -14; echo "exit=${PIPESTATUS[0]}"
```

Expected：出现 `✗ demo-all.ts 缺少栈环境变量: DATABASE_URL, TB_ADDRESS` 以及 `bash scripts/on-stack.sh self <npm-script>`，**且没有任何 TigerBeetle 连接尝试**。

- [ ] **Step 7: 正向验证——套了包装器照常跑**

```bash
bash scripts/stack.sh reset self
bash scripts/on-stack.sh self demo:all 2>&1 | tail -30
bash scripts/on-stack.sh self verify:coa 2>&1 | tail -12
bash scripts/on-stack.sh self verify:demo-data 2>&1 | tail -8
```

Expected：`demo:all` 花名册 **21/21**；`verify:coa` 四恒等式 + 49 科目无负余额；`verify:demo-data` 全过。

- [ ] **Step 8: 确认没碰别人的账本**

```bash
lsof -nP -iTCP:3003 -sTCP:LISTEN | tail -n +2 | awk '{print "  main TB 仍在:", $1, $2}'
sqlite3 /tmp/exchange_js_main/dev.db "SELECT COUNT(*) FROM funds_orders;" 2>/dev/null | sed 's/^/  main 库资金单数: /'
```

把这个数字与本任务开始前对照（若不知道，至少确认命令跑得通且数字稳定）。

- [ ] **Step 9: Commit**

```bash
git add -A package.json scripts/require-stack-env.ts scripts/demo-lib.ts scripts/recon-rerun.ts scripts/verify-demo-data.ts scripts/reset-stack.sh
git commit -m "fix(scripts): 剥掉 23 处指向 main 账本的内联默认值,改 fail-fast

11 个脚本默认 TB_ADDRESS=127.0.0.1:3003(main 的 TigerBeetle),
12 个默认 DATABASE_URL=file:./dev.db(CWD 相对)。worktree 内漏套
on-stack.sh 直接跑造数 → 读自己的空库、写 main 的账本,且不报错。

剥除对正常用法零影响(on-stack.sh:37 本来就用 sed 把前置赋值剥掉再跑);
新增 require-stack-env 守卫把'没设置'变成一句能看懂的话。
不做自动推断——猜错栈比报错更糟。
reset-stack.sh 的 \${TB_PORT:-3003} 同族默认一并删。"
```

---

### Task 8: [D2] 栈脚本四个洞

> **超出设计稿一处**：写计划时复核 `stack-up.sh:82` 的调用链，发现**第四个洞**——`RUNTIME_DIR` 只按栈名分，从 worktree 跑 `stack.sh up main` 会杀掉主工作树正在跑的服务（Step 4b 有活体复现）。与 D1 的跨栈默认值同一家族，同批修掉。

**本任务做：** backend 改绝对路径启动（同时修好停止端的查找）；端口被自家残留占用时自愈；补 tb 的停止兜底；**禁止从 worktree 操作 main 栈**。
**本任务不做：** 不改端口分配逻辑；**不杀非本栈的进程**（跨栈误杀会毁掉并行会话的验收库）；不加自动清理残留目录（D3 只报告）。

**Files:**
- Modify: `scripts/stack-up.sh:114`（绝对路径启动）
- Modify: `scripts/stack-common.sh:360-375`（`ensure_port_free` 自愈自家残留）
- Modify: `scripts/stack-stop.sh:40-42`（补 tb 兜底）
- Modify: `scripts/stack-common.sh:96-113`（`load_stack_config` 的 `main)` 分支拒绝非主工作树）

**Interfaces:**
- Consumes: `stack-common.sh` 现有的 `terminate_pid(name, pid)` 与 `stop_listener_if_managed(name, port)`（判据：占用进程的命令行含 `${APP_DIR}`）。
- Produces: D3 依赖"`stack.sh down` 后本栈无残留 tb"这个事实。

- [ ] **Step 1: 活体证明孤儿清理从未生效**

```bash
grep -n 'dist/main' scripts/stack-up.sh scripts/stack-stop.sh
for p in $(cat .stackports 2>/dev/null); do
  pid=$(lsof -tiTCP:$p -sTCP:LISTEN 2>/dev/null | head -1)
  [ -n "$pid" ] && ps -p $pid -o command= | sed 's/^/  实际命令行: /'
done
APP="$(pwd)"
echo "  pgrep -f '${APP}/dist/main' → $(pgrep -f "${APP}/dist/main" 2>/dev/null | wc -l | tr -d ' ') 个命中"
```

Expected：启动是 `["node","dist/main"]`（相对），停止查的是 `${APP_DIR}/dist/main`（绝对）；实际命令行是 `node dist/main`；**pgrep 命中 0 个**。

- [ ] **Step 2: 改成绝对路径启动**

`scripts/stack-up.sh` 第 111–116 行的 backend 启动块，命令数组改为绝对路径：

```bash
launch_detached_service \
  "${APP_DIR}" \
  "${BACKEND_LOG}" \
  "[\"node\",\"${APP_DIR}/dist/main\"]" \
  "{\"API_PORT\":\"${BACKEND_PORT}\",\"ADMIN_URL\":\"${ADMIN_URL}\",\"CLIENT_URL\":\"${CLIENT_URL}\",\"DATABASE_URL\":\"${DB_URL}\",\"TB_ADDRESS\":\"${TB_ADDRESS}\"}" \
  >/dev/null
```

**`stack-stop.sh:44` 不用改** —— 它查的 `${APP_DIR}/dist/main` 现在就对上了。

- [ ] **Step 3: `ensure_port_free` 改成自愈自家残留**

`scripts/stack-common.sh` 的 `ensure_port_free` 整个函数替换为：

```bash
# 端口被占时：占用者是本栈自己的残留（命令行含 APP_DIR）→ 杀掉继续；
# 是别人的 → 打印占用者并返回非零（调用方在 set -e 下会中止，这是对的：
# 跨栈误杀会毁掉并行会话的验收库）。
#
# 此前无条件返回非零，于是 admin/client 端口被上次会话遗留的 vite 占着时，
# 整个 up 中止、后续服务全不起，且看着不像出错（PRODUCTION-NOTES:382，
# 登记 50 天，两个实施者各撞一次）。
ensure_port_free() {
  local port="$1"
  local name="$2"

  if ! lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    return 0
  fi

  local pid command_line
  pid="$(lsof -tiTCP:"${port}" -sTCP:LISTEN | head -n 1 || true)"
  command_line="$(ps -p "${pid}" -o command= 2>/dev/null || true)"

  if [[ -n "${command_line}" && "${command_line}" == *"${APP_DIR}"* ]]; then
    echo "[${STACK}/${name}] port ${port} 被本栈残留占用 (pid ${pid})，清理后继续"
    terminate_pid "${name}" "${pid}"
    for _ in {1..20}; do
      lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1 || return 0
      sleep 0.2
    done
    echo "[${STACK}/${name}] port ${port} 清理后仍被占用，放弃" >&2
    return 1
  fi

  echo "[${STACK}/${name}] port ${port} 被非本栈进程占用 (pid ${pid})，拒绝启动" >&2
  [[ -n "${command_line}" ]] && echo "[${STACK}/${name}] command: ${command_line}" >&2
  echo "[${STACK}/${name}] 本栈 APP_DIR=${APP_DIR}；跨栈杀进程会毁掉并行会话的库，故不自动清理" >&2
  return 1
}
```

- [ ] **Step 4: 补 tb 的停止兜底**

不能直接复用 `stop_listener_if_managed`——它的判据是"命令行含 `APP_DIR`"，而 tigerbeetle 的命令行里没有 `APP_DIR`，有的是 `TB_DATA_FILE`。所以在 `scripts/stack-stop.sh` 的三行 `stop_listener_if_managed` **之后**，插入一个 tb 专用的：

```bash
# tb 的判据与另外三个不同：tigerbeetle 的命令行里没有 APP_DIR，有的是数据文件路径。
# 此前 tb 只靠 PID 文件 + pattern 两条路，PID 文件一旦丢失（例如 reset-stack.sh
# 在自己的 shell 里 & 起 TB、脚本退出后 PID 文件被下一轮覆盖），旧 TB 就会活着
# 继续占端口，新 TB 起不来，应用连上的是**带着上一轮全部转账的旧账本**——
# 这正是 2026-08-30「重铺后余额累加、倍数 1→2→3→4」那次假警报的成因。
stop_tb_if_managed() {
  local pid command_line
  pid="$(lsof -tiTCP:"${TB_PORT}" -sTCP:LISTEN | head -n 1 || true)"
  [[ -z "${pid}" ]] && return 0
  command_line="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
  if [[ "${command_line}" == *"${TB_DATA_FILE}"* ]]; then
    terminate_pid "tb" "${pid}"
  else
    echo "[${STACK}/tb] port ${TB_PORT} owned by non-managed process pid ${pid}, skip"
  fi
}
stop_tb_if_managed
```

- [ ] **Step 4b: 第四个洞——从 worktree 跑 `up main` 会杀掉 main 的服务**

`stack-common.sh:147` 的 `RUNTIME_DIR="/tmp/exchange_js_runtime_${STACK}"` **只按栈名分，不按工作树分**。于是从任何 worktree 执行 `stack.sh up main`：

1. `assert_branch_rule`（`stack-up.sh:35`）对 `main` 栈在非主工作树下会把 `BRANCH_RULE` 设成**当前分支**，所以**放行**
2. `stack-up.sh:82` 调 `stack-stop.sh main`，第一件事就是 `stop_pid_file_process "backend" /tmp/exchange_js_runtime_main/backend.pid`
3. 该文件里是 **main 正在跑的后端 pid** → 被杀

先复现：

```bash
cat /tmp/exchange_js_runtime_main/backend.pid
ps -p "$(cat /tmp/exchange_js_runtime_main/backend.pid)" -o command=
```

Expected：pid 存在，命令行是 main 的后端。**这个 pid 就是从 worktree 跑 `up main` 会杀掉的东西。**

修法：`stack-common.sh` 的 `load_stack_config` 在 `main` 分支里，非主工作树时直接拒绝。把 `case "$stack" in` 的 `main)` 分支开头改为：

```bash
    main)
      STACK="main"
      # main 栈的运行态（RUNTIME_DIR / PID 文件 / DB / TB）是全局唯一的，只按栈名分、
      # 不按工作树分。从 worktree 操作 main 栈，会让 stack-up.sh:82 的 stack-stop
      # 读到 /tmp/exchange_js_runtime_main/*.pid 并杀掉主工作树正在跑的服务。
      # CLAUDE.md §10 已有铁律"绝不在主工作树切分支跑服务"，这里补上反向的一半。
      if [[ "${CURRENT_WT_DIR}" != "${ROOT_DIR}" ]]; then
        echo "[stack] 拒绝：不能从 worktree 操作 main 栈。" >&2
        echo "[stack]   当前工作树: ${CURRENT_WT_DIR}" >&2
        echo "[stack]   主工作树:   ${ROOT_DIR}" >&2
        echo "[stack]   要起本树的栈用 'self'；要动 main 栈请到主工作树执行。" >&2
        return 1
      fi
      WT_DIR="${ROOT_DIR}"
      APP_DIR="${ROOT_DIR}/Exchange_js"
      BRANCH_RULE="main"
```

（原来的 `if [[ "${CURRENT_WT_DIR}" == "${ROOT_DIR}" ]] ... else ... fi` 整段被上面替代——那个 else 分支正是允许 worktree 冒充 main 栈的入口。）

**注意**：`load_stack_config main` 也被 `self` 分支在主工作树下调用（`stack-common.sh:120`），那条路径上 `CURRENT_WT_DIR == ROOT_DIR`，不受影响。

- [ ] **Step 4c: 验证拒绝生效、且 main 毫发无损**

```bash
MAIN_PID=$(cat /tmp/exchange_js_runtime_main/backend.pid 2>/dev/null)
bash scripts/stack.sh up main 2>&1 | tail -6; echo "exit=${PIPESTATUS[0]}"
kill -0 "$MAIN_PID" 2>/dev/null && echo "  ✅ main 后端 pid $MAIN_PID 仍活着" || echo "  ⚠️ main 后端被杀了"
for p in 3000 3001 3002 3003; do lsof -tiTCP:$p -sTCP:LISTEN >/dev/null 2>&1 || echo "  ⚠️ main 的 $p 掉了"; done
```

Expected：`拒绝：不能从 worktree 操作 main 栈` + 非零退出码；`✅ main 后端 pid ... 仍活着`；**四个端口一个 ⚠️ 都没有**。

同理验证 `reset`：

```bash
bash scripts/stack.sh reset main 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
```

Expected：同样被拒（`reset-stack.sh` 也走 `load_stack_config`）。

- [ ] **Step 5: 栈脚本单测必须仍绿**

```bash
bash scripts/stack-env.test.sh; echo "exit=$?"
```

Expected：`PASS` / `exit=0`（本任务没碰 `ensure_env_files`，但它与 `ensure_port_free` 同文件，回归必须确认）。

- [ ] **Step 6: 行为验证——起停一整轮**

```bash
bash scripts/stack.sh down self
bash scripts/stack.sh up self 2>&1 | tail -14
```

Expected：四个服务全部 `listening on <port> (pid ...)`。

```bash
APP="$(pwd)"
echo "  pgrep 绝对路径命中: $(pgrep -f "${APP}/dist/main" | wc -l | tr -d ' ') 个"
```

Expected：**1 个**（此前是 0）—— 停止端的孤儿清理从此真的能命中。

- [ ] **Step 7: 行为验证——端口自愈**

```bash
BASE=$(cat .stackports); ADMIN=$((BASE+1))
# 杀掉 PID 文件，制造"PID 文件丢了但进程还在"的残留态
rm -f /tmp/exchange_js_runtime_wt_*/admin.pid
bash scripts/stack.sh up self 2>&1 | grep -E "被本栈残留占用|listening on ${ADMIN}"
```

Expected：出现 `port <admin> 被本栈残留占用 (pid ...)，清理后继续`，随后 `admin` 正常 `listening`。
**关键**：整个 `up` **没有中止**，四个服务都起来了。

- [ ] **Step 8: 行为验证——非本栈的占用者不杀，只拒绝**

不要用 `stack.sh up main` 来测这条（那会走 Step 4b 的拒绝，测不到 `ensure_port_free` 的分支）。用一个**本栈端口上的非栈进程**来测：

```bash
BASE=$(cat .stackports); CLIENT=$((BASE+2))
bash scripts/stack.sh down self
python3 -m http.server "${CLIENT}" >/dev/null 2>&1 &
SQUATTER=$!
sleep 1
bash scripts/stack.sh up self 2>&1 | tail -8; echo "exit=${PIPESTATUS[0]}"
kill -0 "$SQUATTER" 2>/dev/null && echo "  ✅ 占用者 pid $SQUATTER 没被杀" || echo "  ⚠️ 占用者被杀了"
kill "$SQUATTER" 2>/dev/null
```

Expected：输出含 `port <client> 被非本栈进程占用 (pid ...)，拒绝启动` 与 `跨栈杀进程会毁掉并行会话的库，故不自动清理`；退出码非零；**`✅ 占用者 pid ... 没被杀`**。

**任何"占用者被杀了"都必须停下**——跨栈误杀是本任务最严重的失败模式。

- [ ] **Step 9: 行为验证——tb 停得干净**

```bash
bash scripts/stack.sh down self
TBFILE=$(grep -o '/tmp/exchange_js_wt_[a-z0-9_]*' .stackports 2>/dev/null || echo "")
pgrep -f "tigerbeetle start" | while read -r pid; do ps -p "$pid" -o command= | sed 's/^/  剩余 TB: /'; done
```

Expected：剩余 TB 里**没有本 worktree 的那个**（main 的 3003、其它 worktree 的照常活着）。

- [ ] **Step 10: Commit**

```bash
git add -A scripts/stack-up.sh scripts/stack-common.sh scripts/stack-stop.sh
git commit -m "fix(stack): 补上四个洞——孤儿清理失效 / 端口连锁中止 / tb 无兜底 / 跨树杀 main

① 孤儿 backend 清理: up 用相对路径 ['node','dist/main'] 启动,
   stop 用绝对路径 pgrep,活体实测 0/3 命中——从写下来那天起没起过作用。
   改绝对路径启动,一处改动同时修好查找端。
② ensure_port_free 无条件返回非零,在 set -e 下让整个 up 中止、后续服务
   全不起且看着不像出错(PRODUCTION-NOTES:382,登记 50 天,两人各撞一次)。
   改为:占用者是本栈残留就清掉继续,是别人的才拒绝——跨栈误杀会毁掉
   并行会话的验收库。
③ tb 缺 stop_listener_if_managed 兜底(判据与另三个不同:命令行里是
   TB_DATA_FILE 不是 APP_DIR)。补上。这是 2026-08-30'重铺后余额累加、
   倍数 1→2→3→4'那次假警报的成因。

④ RUNTIME_DIR 只按栈名分不按工作树分,从任何 worktree 跑 stack.sh up main,
   stack-up.sh:82 的 stack-stop 会读 /tmp/exchange_js_runtime_main/*.pid
   并杀掉主工作树正在跑的服务(assert_branch_rule 在这条路径上会放行,
   因为它把 BRANCH_RULE 设成了当前分支)。改为 load_stack_config 直接拒绝。
   写计划时复核调用链发现,超出设计稿范围,与 D1 跨栈默认值同一家族。

含两条反向验证:非本栈的端口占用者不能被杀;从 worktree 操作 main 栈
必须被拒且 main 四个端口毫发无损。"
```

---

### Task 9: [D3] 残留检查挂到 `stack.sh up` + 闸门补两条

**本任务做：** 新建残留检查脚本（只报告不删）并挂到 `stack.sh up` 开头；把 `stack-env.test.sh` 与 `sumsub-deposit-smoke.ts` 接进正式入口。
**本任务不做：** **不自动删除任何进程或目录**；不改端口分配；不给 sumsub 冒烟脚本配凭据。

**Files:**
- Create: `scripts/check-stack-residue.sh`
- Modify: `scripts/stack-up.sh`（起服务前调一次）
- Modify: `package.json`（加 `stack:test` 与 `sumsub:smoke` 两个入口）
- Modify: `scripts/sumsub-deposit-smoke.ts`（头注释补"非死码"）

**Interfaces:**
- Consumes: `stack-common.sh` 的 `ROOT_DIR`（主工作树根）。
- Produces: `scripts/check-stack-residue.sh` 退出码恒为 0（**只报告，不阻断起栈**）。

- [ ] **Step 1: 先看当前残留有多少**

```bash
ls -d /tmp/exchange_js_wt_* /tmp/exchange_js_runtime_wt_* 2>/dev/null | while read -r d; do
  n=$(basename "$d" | sed 's/^exchange_js_//; s/^runtime_//; s/^wt_//' | tr '_' '-')
  root="$(git rev-parse --path-format=absolute --git-common-dir)/.."
  if [ -d "$root/.claude/worktrees/$n" ]; then echo "  $d  ← 工作树还在"
  else echo "  $d  ⚠️ 残留 ($(du -sh "$d" 2>/dev/null | cut -f1))"; fi
done
```

Expected：至少列出 `/tmp/exchange_js_wt_demo_kit`（约 1.1 G）等三处残留。

- [ ] **Step 2: 写检查脚本**

新建 `scripts/check-stack-residue.sh`：

```bash
#!/usr/bin/env bash
# 运行时状态巡检：孤儿进程 + 残留目录。**只报告，不删。**
#
# 为什么挂在 stack.sh up 上而不是做成独立命令：本仓库已经证伪过一次
# "独立自检命令"——scripts/runtime-diagnose.sh 写得没问题，
# 而 PRODUCTION-NOTES:394 自己写着"它不在 stack.sh 的路径上，没人会主动跑"。
# 检查必须挂在本来就必跑的命令上。
#
# 为什么不自动删：残留目录可到 1.1 G 且删了不可逆；跨栈误删会毁掉
# 并行会话正在验收的库。判断该不该删是人的事。
#
# 退出码恒为 0 —— 这是巡检，不是闸门，不该阻断起栈。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIT_COMMON_DIR="$(git -C "${SCRIPT_DIR}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [[ -z "${GIT_COMMON_DIR}" ]]; then
  echo "[residue] 不在 git 仓库内，跳过巡检"
  exit 0
fi
ROOT_DIR="$(cd "${GIT_COMMON_DIR}/.." && pwd)"

# ── 活栈端口块：main 的 3000 + 每个存在的 worktree 的 .stackports ──
live_bases=" 3000 "
for f in "${ROOT_DIR}"/.claude/worktrees/*/.stackports; do
  [[ -f "${f}" ]] || continue
  b="$(head -n 1 "${f}" 2>/dev/null | tr -dc '0-9')"
  [[ -n "${b}" ]] && live_bases="${live_bases}${b} "
done

is_live_port() {
  local port="$1" base
  for base in ${live_bases}; do
    if [[ "${port}" -ge "${base}" && "${port}" -le $(( base + 3 )) ]]; then
      return 0
    fi
  done
  return 1
}

orphan_procs=0
while IFS= read -r pid; do
  [[ -z "${pid}" ]] && continue
  port="$(lsof -nP -p "${pid}" -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {sub(/.*:/,"",$9); print $9; exit}')"
  [[ -z "${port}" ]] && continue
  if ! is_live_port "${port}"; then
    if [[ "${orphan_procs}" -eq 0 ]]; then
      echo ""
      echo "[residue] ⚠️ 孤儿进程（监听端口不属于任何活着的栈）："
    fi
    echo "[residue]   pid ${pid} port ${port} — $(ps -p "${pid}" -o command= 2>/dev/null | cut -c1-96)"
    orphan_procs=$(( orphan_procs + 1 ))
  fi
done < <(pgrep -f 'tigerbeetle start|dist/main|node_modules/.bin/vite' 2>/dev/null || true)

orphan_dirs=0
for d in /tmp/exchange_js_wt_* /tmp/exchange_js_runtime_wt_*; do
  [[ -d "${d}" ]] || continue
  name="$(basename "${d}" | sed 's/^exchange_js_//; s/^runtime_//; s/^wt_//' | tr '_' '-')"
  [[ -d "${ROOT_DIR}/.claude/worktrees/${name}" ]] && continue
  if [[ "${orphan_dirs}" -eq 0 ]]; then
    echo ""
    echo "[residue] ⚠️ 残留目录（对应工作树已不存在）："
  fi
  echo "[residue]   ${d}  ($(du -sh "${d}" 2>/dev/null | cut -f1))"
  orphan_dirs=$(( orphan_dirs + 1 ))
done

if [[ "${orphan_procs}" -gt 0 || "${orphan_dirs}" -gt 0 ]]; then
  echo ""
  echo "[residue] 共 ${orphan_procs} 个孤儿进程 / ${orphan_dirs} 个残留目录。"
  echo "[residue] 只报告不自动清理——确认无人在用后手工处理："
  echo "[residue]   kill <pid>        # 孤儿进程"
  echo "[residue]   rm -rf <目录>      # 残留目录（不可逆，先看清楚名字）"
  echo ""
fi

exit 0
```


- [ ] **Step 3: 挂到 `stack.sh up`**

`scripts/stack-up.sh` 在 `mkdir -p "${RUNTIME_DIR}"` 那行之后插入：

```bash
bash "${SCRIPT_DIR}/check-stack-residue.sh" || true
```

（`|| true` 是双保险：巡检本身绝不能因为自己出错而挡住起栈。）

- [ ] **Step 4: 验证巡检真的报出来**

```bash
bash scripts/check-stack-residue.sh
```

Expected：列出 Step 1 看到的那几处残留目录；退出码 0。

```bash
bash scripts/stack.sh down self && bash scripts/stack.sh up self 2>&1 | grep -A6 "residue"
```

Expected：起栈过程中打印巡检结果，**且四个服务照常起来**。

- [ ] **Step 5: 反向验证——巡检不误报活栈**

```bash
bash scripts/check-stack-residue.sh 2>&1 | grep -c "3000\|$(cat .stackports)" || echo "  0 —— 活栈没被误报为孤儿"
```

Expected：`0`（main 的 3000 块和本 worktree 的端口块都不该出现在孤儿列表里）。

- [ ] **Step 6: 把两个活脚本接进正式入口**

`package.json` 的 `scripts` 加两条：

```json
    "stack:test": "bash scripts/stack-env.test.sh",
    "sumsub:smoke": "ts-node -r tsconfig-paths/register scripts/sumsub-deposit-smoke.ts",
```

`scripts/sumsub-deposit-smoke.ts` 头注释加一行（在"用法"之前）：

```typescript
// ⚠️ 非死码，勿清。它没有被任何脚本/测试调用，看着像死码，但这是**唯一**
//    打真 Sumsub 沙盒的工具（其余全在 SUMSUB_MOCK_MODE=true 下跑）。
//    2026-08-31 环境收口清 scripts/ 死码时特意留下，并加了 npm run sumsub:smoke 入口。
```

- [ ] **Step 7: 验证两个入口**

```bash
npm run stack:test; echo "exit=$?"
npm run sumsub:smoke 2>&1 | head -4
```

Expected：`stack:test` 打印 5 项 `✓` 并 `PASS` / `exit=0`；`sumsub:smoke` 因缺 `SUMSUB_APP_TOKEN` / `SUMSUB_SECRET_KEY` 报缺凭据（**这是对的**——它要真凭据才跑，说明入口通了）。

- [ ] **Step 8: Commit**

```bash
git add -A scripts/check-stack-residue.sh scripts/stack-up.sh scripts/sumsub-deposit-smoke.ts package.json
git commit -m "feat(stack): 起栈时巡检孤儿进程与残留目录(只报不删) + 两个活脚本接入口

挂在 stack.sh up 而不做成独立命令,因为本仓库已证伪过一次:
runtime-diagnose.sh 写得没问题,而 PRODUCTION-NOTES:394 自己写着
'它不在 stack.sh 的路径上,没人会主动跑'。检查必须挂在必跑的命令上。

只报不删:残留目录可到 1.1G 且不可逆,跨栈误删会毁并行会话的验收库。
退出码恒 0——巡检不是闸门,不阻断起栈。

顺带把两个被埋没的活脚本接进正式入口:
- stack-env.test.sh → npm run stack:test(全仓唯一测栈脚本的东西,5 项断言)
- sumsub-deposit-smoke.ts → npm run sumsub:smoke(唯一打真沙盒的工具),
  并在头注释标注'非死码,勿清'免得下轮又被当垃圾清掉。"
```

---

### Task 10: [E1] 建 `TOOLING-DEBT.md` 并从 PRODUCTION-NOTES 迁账

**本任务做：** 新建第三个桶；把 `PRODUCTION-NOTES.md` 里的工具/环境类条目**逐条核实**后迁入，陈的直接删；改 `CLAUDE.md §4` 的分流规则。
**本任务不做：** 不修迁过来的任何条目（这轮只搬家 + 核实）；不动兜底类条目（它们留在 PRODUCTION-NOTES，规矩不变）。

**Files:**
- Create: `doc-final/TOOLING-DEBT.md`
- Modify: `doc-final/PRODUCTION-NOTES.md`
- Modify: `../CLAUDE.md`（§4、§8 路由表）

**Interfaces:**
- Consumes: Task A1/A2/B1/B2/C1/C2/D1/D2/D3 已修掉的问题——这些条目**销账，不迁**。

- [ ] **Step 1: 捞出候选条目**

```bash
grep -nE '^- (\[ \]|🟡|🔴).*(jest|tsc|tsconfig|stack\.sh|on-stack|stack-|node_modules|Node|端口|孤儿|栈|PATH|vitest|spec\.tsx|roots|webcrypto)' doc-final/PRODUCTION-NOTES.md | cut -c1-150
```

Expected：约 24 条。**逐条**判断三档：
- **已被本轮修掉** → 销账（在 PRODUCTION-NOTES 里删掉，E1 Step 4 统一记一笔）
- **仍成立且机器查不出来** → 迁入 `TOOLING-DEBT.md`
- **陈账（早修好没划掉）** → 直接删，不迁

已知必销的（本轮各任务已修）：`scripts/**` 不在 tsc 覆盖 ／ `ensure_port_free` 整脚本中止 ／ 孤儿 pattern 不匹配 ／ client-web vitest 被 jest 捡起 ／ `scripts/` 下 spec 静默 0 匹配 ／ admin-web spec 不在 tsc 闸门 ／ `backfill-internal-fund-keys.ts` 是死码。
已知的陈账（复核已确认修好）：`on-stack.sh` 缺 PATH（第 384 行）／ `stack.sh` 从不跑迁移（第 394 行）。

- [ ] **Step 2: 建桶**

新建 `doc-final/TOOLING-DEBT.md`：

```markdown
# 工具与环境债

> 建立：2026-08-31（环境收口）｜ 设计稿：`superpowers/specs/2026-08-31-environment-and-tooling-debt-design.md`

## 这个文件装什么

**只装三样都满足的**：① 工具链 / 环境 / 闸门的问题；② 这轮决定不修；③ 机器查不出来。

不满足的去别处：
- 能直接修的 → **就直接修**，不写在任何文件里
- 每日变化的运行时状态（孤儿进程、残留目录）→ 已挂在 `bash scripts/stack.sh up` 的开头自动巡检
- 业务缺口 → `BACKLOG.md`
- 技术兜底（幂等 / 并发 / 攻击面 / 故障恢复）→ `PRODUCTION-NOTES.md`（只写不读，规矩不变）

## 两条规矩

1. **进来时必须写清怎么复现** —— 一条能跑的命令 + 期望看到什么。写不出复现步骤的，说明还没查清楚，先查。
2. **修好必须回来划掉** —— 用 `- [x] ~~原文~~` 划掉并注明修它的 commit。

第 2 条是这个文件存在的理由。`PRODUCTION-NOTES.md` 没有这条规矩，于是 2026-08-31 抽查 9 条命中 2 条陈账（22%）——**一个不回收的清单，读它的人是在读已经解决的问题**。

## 债

<!-- 格式：- [ ] **一句话标题**：说明 ｜ **复现**：`命令` → 期望现象 ｜来源: 日期/出处 -->
```

- [ ] **Step 3: 逐条迁入**

按 Step 1 的判断，把"仍成立"的条目搬进 `## 债` 节。**搬的时候必须补上「复现」段**——原条目多数没有。示例（`.spec.tsx` 那条）：

```markdown
- [ ] **`admin-web` 的 React 组件无法单测**：`jest.config.js` 的 `testRegex` 是 `.*\.spec\.ts$`（不匹配 `.spec.tsx`），`moduleFileExtensions` 也没有 `tsx`，且未装 `jest-environment-jsdom` / `@testing-library`。admin 组件目前只能靠 preview 渲染截图验证 ｜ **复现**：`node -p "String(require('./jest.config.js').testRegex)"` → 输出 `.*\.spec\.ts$`；`ls node_modules/jest-environment-jsdom` → 不存在 ｜来源: 2026-08-22 第四批 B5，2026-08-31 核实仍在
```

- [ ] **Step 4: PRODUCTION-NOTES 记一笔搬家**

在 `PRODUCTION-NOTES.md` 顶部说明段之后加：

```markdown
> **2026-08-31 分流**：工具 / 环境 / 闸门类条目已迁往 `TOOLING-DEBT.md`（那个文件**要读要清**）。
> 本文件此后只装技术兜底——幂等 / 去重 / 重试回放 / 补偿 repair / 并发锁 / 攻击面 / 故障恢复，
> 规矩不变：**只许追加，不许读它来找活干**。
> 本轮销账 N 条（已随环境收口修掉）、删除 M 条陈账（早修好没划掉）、迁出 K 条。
```

（N / M / K 填 Step 1 的实际计数。）

- [ ] **Step 5: 改 `CLAUDE.md` 的分流规则**

§4 改为：

```markdown
## 4. 出口（债往哪放）

| 发现什么 | 放哪 | 规矩 |
|---|---|---|
| 业务缺口 | `doc-final/BACKLOG.md` | 正常待办 |
| **技术兜底**（幂等 / 去重 / 重试回放 / 补偿 repair / 并发锁 / 攻击面 / 故障恢复） | `doc-final/PRODUCTION-NOTES.md` | **追加一行，然后放下**：不修、不讨论、不进 plan。只许追加，不许读它来找活干 |
| **工具 / 环境 / 闸门** | `doc-final/TOOLING-DEBT.md` | **要读要清**。进来写清怎么复现，修好回来划掉 |

第三类是 2026-08-31 拆出来的：此前它跟技术兜底同桶，于是也变成按设计不可读——
`scripts/**` 不在 tsc 覆盖那条 2026-07-31 就登记了、还自称"防复发闸"，31 天后原样复发一次。
```

§8 路由表的最后一行改为：

```markdown
| 说"以后做" | 业务缺口记 `BACKLOG.md`；技术兜底记 `PRODUCTION-NOTES.md`；工具/环境记 `TOOLING-DEBT.md` |
```

- [ ] **Step 6: 自检——新桶里每条都能复现**

```bash
grep -c "复现" doc-final/TOOLING-DEBT.md
grep -c "^- \[ \]" doc-final/TOOLING-DEBT.md
```

Expected：两个数字**相等** —— 每条债都带复现步骤，没有例外。

- [ ] **Step 7: Commit**

```bash
git add -A doc-final/TOOLING-DEBT.md doc-final/PRODUCTION-NOTES.md ../CLAUDE.md
git commit -m "docs: 拆出 TOOLING-DEBT.md——工具/环境债从'只写不读'的桶里分流出来

PRODUCTION-NOTES 的'只许追加不许读'本身是对的:它挡的是技术兜底吃掉
演示准备时间。但工具债和环境债被丢进了同一个桶,于是也变成按设计不可读。
2026-07-31 那条自称'防复发闸'的 scripts/tsc 覆盖问题,31 天后原样复发一次。

新桶两条规矩:进来写清怎么复现;修好回来划掉。第二条是它存在的理由——
PRODUCTION-NOTES 没这条,抽查 9 条命中 2 条陈账(22%),
一个不回收的清单,读它的人是在读已经解决的问题。"
```

---

### Task 11: [E2] 收尾——清残留 + 全量验收

**本任务做：** 手工清掉现存的三处残留；跑完 11 条验收判据（含 3 条反向验证）；更新 `baseline.md` 重钉记录。
**本任务不做：** 不删任何**对应工作树还在**的目录；不碰 main 栈与另外两个并行会话的端口段。

**Files:**
- Modify: `doc-final/demo/baseline.md`（重钉记录 + CHANGELOG 一行）

**Interfaces:**
- Consumes: A1–E1 全部完成。

- [ ] **Step 1: 清残留（逐个确认工作树确实不存在再删）**

```bash
ROOT="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
for d in /tmp/exchange_js_wt_* /tmp/exchange_js_runtime_wt_*; do
  [ -d "$d" ] || continue
  n=$(basename "$d" | sed 's/^exchange_js_//; s/^runtime_//; s/^wt_//' | tr '_' '-')
  if [ -d "$ROOT/.claude/worktrees/$n" ]; then
    echo "  保留 $d（工作树 $n 还在）"
  else
    echo "  待删 $d  $(du -sh "$d" 2>/dev/null | cut -f1)  ← 工作树 $n 不存在"
  fi
done
```

**先只看，不删。** 确认"待删"列表里没有本 worktree、没有 `act1-permissions`、没有 `recon-adj1`，再执行：

```bash
rm -rf /tmp/exchange_js_wt_demo_kit /tmp/exchange_js_runtime_wt_demo_kit /tmp/exchange_js_runtime_wt_l1gate
bash scripts/check-stack-residue.sh
```

Expected：巡检不再报这三处。

- [ ] **Step 2: 全新库重铺**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
bash scripts/stack.sh reset self
bash scripts/stack.sh up self 2>&1 | tail -12
```

Expected：重铺完成；四个服务全部 listening。

- [ ] **Step 3: 判据 1–5（编译与单测）**

```bash
npx tsc --noEmit -p tsconfig.json;            echo "① 后端 tsc      exit=$?"
(cd admin-web  && npx tsc -b --noEmit);       echo "② 管理台 tsc    exit=$?"
(cd client-web && npx tsc -b --noEmit);       echo "③ 客户端 tsc    exit=$?"
npx jest --silent 2>&1 | tail -4;             echo "④ jest          exit=${PIPESTATUS[0]}"
npm run test:client >/dev/null 2>&1;          echo "⑤ vitest        exit=$?"
npm run stack:test >/dev/null 2>&1;           echo "⑥ 栈脚本单测    exit=$?"
```

Expected：六行全部 `exit=0`；jest 输出 `Test Suites: 162 passed, 162 total` / **`0 failed`**。

- [ ] **Step 4: 判据 6–7（造数与账本）**

```bash
bash scripts/on-stack.sh self demo:all 2>&1 | tail -32
bash scripts/on-stack.sh self verify:coa 2>&1 | tail -14
bash scripts/on-stack.sh self verify:demo-data 2>&1 | tail -8
bash scripts/on-stack.sh self verify:audit 2>&1 | tail -12
```

Expected：花名册 **21/21** 逐条符合预期；`verify:coa` 两恒等式 + 49 科目无负余额；`verify:demo-data` 全过；`verify:audit` 七项（Q5/Q6 的波动带见 `baseline.md`）。

- [ ] **Step 5: 判据 8（反向：Node 18 必须给可读报错）**

```bash
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" npx jest src/common/utils/demo-roster.spec.ts 2>&1 | grep -c "本仓库要求 Node >= 20"
```

Expected：`1`（不是一屏 `crypto is not defined`）。

- [ ] **Step 6: 判据 9（反向：不套包装器必须当场报错）**

```bash
env -u DATABASE_URL -u TB_ADDRESS npm run demo:all 2>&1 | grep -c "缺少栈环境变量"
lsof -nP -iTCP:3003 -sTCP:LISTEN >/dev/null 2>&1 && echo "  main TB 未受影响 ✅"
```

Expected：`1`；`main TB 未受影响 ✅`。

- [ ] **Step 7: 判据 10–11（反向：端口自愈 / tb 停干净）**

```bash
# ⑩-a 自家残留 → 自愈继续
rm -f /tmp/exchange_js_runtime_wt_*/admin.pid
bash scripts/stack.sh up self 2>&1 | grep -c "被本栈残留占用"

# ⑩-b 跨树操作 main → 拒绝，且 main 毫发无损
MAIN_PID=$(cat /tmp/exchange_js_runtime_main/backend.pid 2>/dev/null)
bash scripts/stack.sh up main 2>&1 | grep -c "不能从 worktree 操作 main 栈"
kill -0 "$MAIN_PID" 2>/dev/null && echo "  main 后端仍活着 ✅" || echo "  ⚠️ main 后端被杀"
for p in 3000 3001 3002 3003; do lsof -tiTCP:$p -sTCP:LISTEN >/dev/null 2>&1 || echo "  ⚠️ main 的 $p 掉了"; done

# ⑪ tb 停干净
bash scripts/stack.sh down self
TB_BASE=$(( $(cat .stackports) + 3 ))
lsof -tiTCP:${TB_BASE} -sTCP:LISTEN >/dev/null 2>&1 && echo "  ⚠️ 本栈 TB 残留" || echo "  本栈 TB 停干净 ✅"
```

Expected：⑩-a 计数 ≥1；⑩-b 计数 =1 且 `main 后端仍活着 ✅`、**四个端口一个 ⚠️ 都没有**；⑪ `本栈 TB 停干净 ✅`。

- [ ] **Step 8: 重钉基线**

`doc-final/demo/baseline.md` 顶部重钉行追加：

```markdown
> 重钉历史：2026-08-26 Step 0 首钉（7c53afd4）→ 2026-08-27 收官重钉 → **2026-08-31 环境收口重钉（本版）**：
> 判据由「净新失败 = 0」升级为「全绿」；红名单 4 条全部清零并整节退役；
> 闸①覆盖扩至 `src / test / scripts / prisma` 四目录；Node 归一到 20。
```

- [ ] **Step 9: Commit**

```bash
git add -A doc-final/demo/baseline.md
git commit -m "docs(baseline): 2026-08-31 环境收口重钉

11 条判据全过,含 4 条反向验证:
- Node 18 下跑闸门给一句可读报错(不是一屏 crypto is not defined)
- 不套 on-stack.sh 直接跑造数当场报错,main 账本未受影响
- 端口被自家残留占用时自愈继续,起别人的栈失败时对方四个服务无一被误杀
- stack.sh down 后本栈 TB 停干净

jest 162 套全绿(退出码 0),此前是 4 套 8 例红且被判据豁免。
清掉 1.1G 残留目录。"
```

---

## 收尾（全部任务完成后）

- [ ] 用 `superpowers:finishing-a-development-branch` 技能走合并流程
- [ ] 合并后清 worktree + 分支
- [ ] 告知两个并行会话（`act1-permissions` / `recon-adj1`）：`package.json` 的 12 个脚本已剥掉内联默认值，**他们必须用 `on-stack.sh` 跑造数/对账**，直跑会 fail-fast；`tsconfig.json` 覆盖范围扩大，`tsconfig.test.json` 已删；jest 判据改全绿
- [ ] 一行完成报：`Documentation updated: modules§5 / demo / decisions / none — <一句话>`
