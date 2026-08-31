# 环境与工具债收口 — 设计稿

> 日期：2026-08-31 ｜ 代码基准：`6a91a486`（main）
> 起因：业主问"最近几个会话为什么这么慢"。归因发现墙钟时间的一大块花在**假警报排查**与**重复踩同一批坑**上，遂开专轮彻查环境。
> 业主决策：**乙案** —— 修坑 + 给"工具/环境债"开第三去处（区别于业务待办 BACKLOG 与技术兜底 PRODUCTION-NOTES）。

---

## 0. 一句话

**Node 版本分裂是根因；检查覆盖不到验收工具本身是放大器；红名单只进不出是遮蔽层；而这三件事早就写在技术待办里，只是那个文件按规矩不许读。**

---

## 1. 现状实测（全部为本轮亲手复现，不引二手结论）

### 1.1 Node 版本分裂

查进程的**真实二进制**（`lsof -p <pid> -a -d txt`），不看 PATH：

| 上下文 | 实际 Node |
|---|---|
| 三个栈的后端服务 | **v20.20.2** |
| shell / `npx tsc` / `jest` / `ts-node` / `on-stack.sh` | **v18.20.8** |

成因：`scripts/stack-up.sh:10-24` 有一段**只对服务生效**的 nvm 垫片（注释写 "Vite requires >=20"）。`on-stack.sh` 里同款垫片 **0 处**。

声明层全部指向 20，唯独无强制：

```
.nvmrc          = 20
Dockerfile ×3   = node:20-bookworm-slim
@nestjs/core    engines.node = ">= 20"
package.json    engines      = 无
```

`globalThis.crypto` 需 Node ≥19。规避手段是手写垫片：

```
首次引入  dfcc0e04  2026-04-08  fix(backend): Node 18 crypto polyfill ...
至今      145 天 ｜ 51 次提交碰过 webcrypto ｜ 21 个文件带着这两行
```

**决定性对照**（同一 commit，全量 jest 166 套 2063 例）：

| | 失败套 | 失败例 |
|---|---:|---:|
| node 18 | 4 | 8 |
| **node 20** | **3** | **4** |

差的那一套是 `role-definition-create-workflow.service.spec.ts`（`crypto is not defined`）。

### 1.2 检查覆盖不到验收工具本身

用 `tsc --noEmit --listFiles` 实测（非读配置推断）：

| 目录 | 文件数 | `tsconfig.json`（闸①） | `tsconfig.test.json` |
|---|---:|---|---|
| `src/` | 515 | ✅ 全覆盖 | ✅ |
| `test/` | 13 | ❌ | ✅ 13/13 |
| **`scripts/`** | **29** | **1/29** | **4/29** |
| `prisma/` | 4 | 1/4 | 1/4 |
| admin-web `*.spec.ts` | 7 | ❌ | ❌ |

唯一被覆盖的 `scripts/demo-roster.ts` 是**蹭到的**——`src/common/utils/demo-roster.spec.ts` import 了它，tsc 顺 import 拉进来。

**未被覆盖的包括 `demo-all` / `demo-lib` / `recon-demo` / `verify-realtime-coa` / `verify-demo-data` / `verify-audit`——收尾闸⑥⑦⑧的执行体本身。**

实例：2026-08-29 本人在 `demo-lib.ts` 误用 `export { X } from '...'`（再导出不引入本地作用域），闸①全绿放行，跑 `demo:all` 才炸。

另：`tsconfig.test.json` 在 `baseline.md` 绿名单里，却不在 `CLAUDE.md §7` 的随手闸三条里——两份文档对"闸门是什么"定义不一致。

### 1.3 红名单只进不出

`baseline.md` 判据："此后一切验证以「净新失败 = 0」为准，不是全绿。"红名单 4 条，实为**四种互不相干的成因**：

| suite | 真实成因 | 年龄 |
|---|---|---:|
| `role-definition-create-workflow.service.spec.ts` | Node 18 | — |
| `system-wallet.util.spec.ts` | 断言仍期望 `C_MAIN`/`C_OUT` | **64 天** |
| `wallets.service.spec.ts` | 同上 | 64 天 |
| `client-web/src/utils/restrictedCapabilities.spec.ts` | vitest 文件被 jest 捡起 | — |

- 第 2/3 条自 `790a6685`（2026-06-27，C_MAIN/C_OUT 退役）红至今。**代码是对的，测试的期望是旧的。**
- 第 4 条实测：`cd client-web && npx vitest run` → **83/83 全绿**（含这 6 例）。它红只因跑错运行器。
- 最能说明机制的是：C_CMA 退役那轮**改过 `system-wallet.util.spec.ts` 第 28 行**（更新 C_CMA 断言），同文件里 C_MAIN/C_OUT 的旧断言原封不动——因为判据只要求"别添新红"。

### 1.4 默认值指向主账本

```
11 个 npm 脚本:  TB_ADDRESS="${TB_ADDRESS:-127.0.0.1:3003}"    ← main 的 TigerBeetle
12 个 npm 脚本:  DATABASE_URL="${DATABASE_URL:-file:./dev.db}"  ← CWD 相对
scripts/reset-stack.sh:54:  ${TB_PORT:-3003}                    ← 同族
```

worktree 内漏用 `on-stack.sh` 直接跑造数 → **读自己的空库，写 main 的账本**，不报错。

### 1.5 栈脚本三个洞（活体验证）

```
stack-up.sh:114   启动: ["node","dist/main"]           ← 相对
stack-stop.sh:44  查找: pgrep -f "${APP_DIR}/dist/main" ← 绝对
```

实测：现有 3 个 backend 在跑，命令行均为 `node dist/main`；拿三个栈的绝对路径分别 pgrep → **0 / 0 / 0 命中**。该分支从写下来起从未生效。

另两处：
- `ensure_port_free` 在 `set -euo pipefail` 下返回非零 → **整个 `up` 中止**，后续服务全不起（PRODUCTION-NOTES:382，登记 50 天，两个实施者各撞一次）。
- `stack-stop.sh` 对 backend/admin/client 有 `stop_listener_if_managed` 兜底，**唯独 tb 没有**——2026-08-30 "重铺后余额累加、倍数 1→2→3→4" 假警报的来源。

### 1.6 残留

```
/tmp/exchange_js_wt_demo_kit           1.1 G   ← worktree 已删
/tmp/exchange_js_runtime_wt_demo_kit   1.5 M   ← 同上
/tmp/exchange_js_runtime_wt_l1gate       0 B   ← 同上
```

### 1.7 元问题：技术待办是只写不读、且不回收的坟场

上述问题在 `PRODUCTION-NOTES.md` **逐条已登记**：

| 行 | 条目 | 登记日 | 复核结果 |
|---:|---|---|---|
| 286 | `scripts/**` 不在 tsc 覆盖（**自称"防复发闸"**）| 07-31 | 仍在 |
| 382 | `ensure_port_free` 整脚本中止 | 07-12 | 仍在 |
| 133 | 孤儿 pattern 绝对/相对不匹配 | 07-28 | 仍在（pgrep 0/3 命中） |
| 90 | client-web vitest 被 jest 捡起 | 08-22 | 仍在 |
| 92 | `.spec.tsx` 永不执行 | 08-22 | 仍在 |
| 93 | `scripts/` 下 spec 静默 0 匹配 | 08-29 | 仍在 |
| 101 | admin-web spec 不在任何 tsc 闸门 | 08-23 | 仍在 |
| **384** | on-stack 缺 `node_modules/.bin` PATH | 07-16 | **已修，条目未划掉** |
| **394** 🔴 | `stack.sh` 从不跑迁移 | 08-24 | **已修，条目未划掉** |

- 163 条中 24 条属工具/环境类；**抽查 9 条，2 条是陈账（22%）**。
- 286 条自称"防复发闸"，31 天后本人原样复发一次。
- `CLAUDE.md §4` 原文：**"该文件只许追加，不许读它来找活干。"**

**判断**：这条规矩本身是对的——它挡的是"技术兜底"（只有攻击者/故障/并发才触发）吃掉演示准备时间。**但工具债与环境债被丢进了同一个桶**，于是也变成按设计不可读。且该桶已过载（163 条）+ 不回收（22% 陈账），即便改规矩允许读，也无法从中挑出可执行的活。

---

## 2. 设计

### 2.1 Node 切到 20 —— 三个入口各堵一处

| 入口 | 做法 | 版本不对时的行为 |
|---|---|---|
| 装依赖 | `package.json` 加 `engines.node = ">=20"`；`.npmrc` 开 `engine-strict=true` | `npm install` / `npm ci` **直接拒绝** |
| 跑脚本 | 把 `stack-up.sh:10-24` 的垫片提取为 `scripts/node-env.sh`；`stack-up.sh` 与 `on-stack.sh` 均 `source` | **自动切到 20** |
| 跑测试 | jest 加 `setupFiles`（或 `globalSetup`）版本断言 | **一句可读报错**："需要 Node 20+，当前 v18.x，请 `nvm use`" |

垫片提取要求：`node-env.sh` 只做"当前 <20 就从 nvm 里挑最高的 20/22 前置进 PATH"，行为与现有实现等价，不新增策略。

清理：**18 个文件**的手写 `webcrypto` 垫片（21 个减去下面 §2.2 要删的 3 个）。

### 2.2 删死码（10 个文件 = 9 个 `.ts` + 1 个 `.sh`，1310 行）

| 文件 | 行 | 判定依据 |
|---|---:|---|
| `scripts/backfill-internal-fund-keys.ts` | 69 | `model InternalFund` 已从 schema 删除；硬编码 `/tmp/exchange_js_branch`（branch 栈 2026-06-25 删除） |
| `scripts/e2e-confiscation-async.ts` | 297 | 硬编码 `/tmp/exchange_js_wt_transaction_limits`（工作树已删）；没收现有 3 个 e2e + 7 个单测覆盖 |
| `scripts/verify-swap-self-heal.ts` | 248 | 兑换有 2 个 e2e + 4 个单测；"self-heal" 属禁做清单「补偿与 repair」 |
| `scripts/verify-swap-redesign-happy.ts` | 163 | 同上，兑换重做那轮的一次性验证 |
| `scripts/repair-duplicate-deposit-final-decisions.ts` | 161 | 2026-03-26 的一次性数据修复；"repair + 去重"双命中禁做清单 |
| `scripts/verify-p6-lock-release.ts` | 147 | 余额锁释放现有 6 个单测覆盖 |
| `scripts/t7-autoheal-test.ts` | 110 | 禁做清单「补偿与 repair」 |
| `scripts/t7-idempotency-test.ts` | 82 | 禁做清单第一项「幂等」 |
| `scripts/probe-tb-pending.ts` | 26 | 调试探针，注释自称"read the TB transfer **the failing post** is looking for" |
| `scripts/dev-start-all.sh` | 7 | `exec stack.sh up branch`；`stack.sh` 现零个 `branch` 字样，传它直接 usage + exit 1 |

判定口径（四项全零才算死）：npm 脚本引用 = 0 ／ 被 `.ts` import = 0 ／ 被 `.sh` 调用 = 0 ／ 现行文档（排除 `archive/`）引用 = 0；引用非零的再逐个核实是否为陈述性提及。

### 2.3 检查覆盖补齐

1. `tsconfig.json` 的 `include` 改为 `["src/**/*", "test/**/*", "scripts/**/*", "prisma/**/*"]`
   —— **实测：删掉 §2.2 那批后，错误数 = 0**（未删时为 2 错 1 文件，全在 `backfill-internal-fund-keys.ts`）
2. `tsconfig.test.json` 随之冗余 → 删除；同步修正 `baseline.md` 绿名单与 `CLAUDE.md §7` 的不一致
3. admin-web 的 `*.spec.ts` 纳入 tsc（现被 `tsconfig.app.json` 的 `exclude` 排除）
4. **`scripts/stack-env.test.sh` 进闸门** —— 全仓唯一测试栈脚本的东西，本轮正要改栈脚本。实测当前 `PASS`（退出码 0，5 项断言）
5. **`scripts/sumsub-deposit-smoke.ts` 加 npm 入口** —— 头注释写明"沙盒冒烟(手动跑,不进 CI)"，是唯一打真 Sumsub 沙盒的工具。加入口是为了让它**不再看起来像死码**，并在脚本头补一行"非死码，勿清"

结果：`scripts/` 类型检查覆盖从 **1/29** 变 **20/20**（29 个 `.ts` 删掉 9 个后剩 20 个，全覆盖）。

### 2.4 红名单清零，判据改"全绿"

| 条 | 修法 |
|---|---|
| `role-definition-create-workflow.service.spec.ts` | 切 Node 20 后自动消失，**不改代码** |
| `system-wallet.util.spec.ts` | 更新陈旧断言（去掉 `C_MAIN`/`C_OUT` 期望）——**代码是对的，改测试** |
| `wallets.service.spec.ts` | 同上 |
| `client-web/src/utils/restrictedCapabilities.spec.ts` | `jest.config.js` 的 `roots` 摘掉 `client-web/src`；`test:client`（`vitest run`）进闸门清单 |

摘掉 `client-web/src` 后，同目录另外 3 个"裸全局"写法的 spec 不再被 jest 重复跑一遍（它们本来就在 vitest 下跑，实测 83/83 全绿）。`admin-web/src` **保留在 jest roots 里**——admin-web 无 vitest，7 个 spec 在 jest 下正常。

判据变更：`baseline.md` 的 **"净新失败 = 0" → "全绿"**（`npx jest` 退出码 0）。红名单章节整节退役。

**代价明示**：此后每轮必须交全绿，无"这条是旧账"的退路；真有一时修不了的，须当场决定修或正式豁免，不得默留。

**一个待核实**：e2e 为单独口径。`baseline.md` 称 11 套 83/83 全绿，`PRODUCTION-NOTES:91` 却称其中 `swap-sumsub-scenarios.e2e-spec.ts` 常年 9/9 全红——疑似第三处陈账。实施时核实一次；**e2e 判据本轮不动**。

### 2.5 默认值不再指向主账本

- 删掉 23 处内联默认值（11 处 `TB_ADDRESS:-127.0.0.1:3003` + 12 处 `DATABASE_URL:-file:./dev.db`）
  —— 对正常用法**零影响**：`on-stack.sh:37` 本来就用 sed 把这些前置赋值剥掉再跑
- 加守卫：`DATABASE_URL` 或 `TB_ADDRESS` 缺失时**立即报错**并指出解法（`bash scripts/on-stack.sh <main|self> <script>`），而非静默连主账本
- `scripts/reset-stack.sh:54` 的 `${TB_PORT:-3003}` 一并删

### 2.6 栈脚本三个洞

| 洞 | 修法 |
|---|---|
| 孤儿 backend 找不到 | `stack-up.sh:114` 改用绝对路径启动 —— **一处改动同时修好 `stack-stop.sh:44` 的查找端** |
| 端口被占整个 `up` 中止 | `ensure_port_free` 命中占用时：占用者命令行含本栈 `APP_DIR` → 视为自家残留，杀掉继续；否则打印占用者并退出。**判据沿用 `stop_listener_if_managed` 现成那套**，不新造 |
| tb 停止缺兜底 | `stack-stop.sh` 补 `stop_listener_if_managed "tb" "${TB_PORT}"`，与 backend/admin/client 对齐 |

### 2.7 运行时状态检查挂到 `stack.sh up`

`stack.sh up` 开头查两件、**只报告不自动删**：

1. **孤儿进程**：`tigerbeetle` / `node dist/main` / `vite` 进程中，监听端口不属于任何**当前存在**的栈
   —— 判据：活栈端口块 = main 的 `3000`（主工作树存在时）+ 每个存在的 `.claude/worktrees/*/` 下 `.stackports` 记的 base；进程监听端口落在这些块之外即为孤儿
2. **残留目录**：`/tmp/exchange_js_wt_*` 与 `/tmp/exchange_js_runtime_wt_*` 中，把目录名的 `wt_` 后缀反解成工作树名（`_` → `-`）后，`.claude/worktrees/<名>/` 已不存在的

不自动删的理由：1.1 G 那种删了不可逆，且跨栈误删会毁掉并行会话的验收库。

本轮顺手手工清掉 §1.6 那三处现存残留。

### 2.8 第三个桶

- **位置**：`doc-final/TOOLING-DEBT.md`
- **只装**："知道有问题、这轮不修、且机器查不出来"的工具/环境债
- **两条规矩**：
  1. 进来时必须写清**怎么复现**（否则下个人无法判断是否仍成立）
  2. **修好必须回来划掉**（现无此规矩，故 22% 陈账）
- **迁移**：把 `PRODUCTION-NOTES.md` 里 24 条工具类**逐条核实**后迁入；陈的直接删，不迁
- **`CLAUDE.md §4` 补分流**：
  - 兜底类（幂等/并发/攻击面/故障）→ `PRODUCTION-NOTES.md`，**只写不读**（现状不变）
  - 工具/环境/闸门类 → `TOOLING-DEBT.md`，**要读要清**

---

## 3. 不做（对照 `CLAUDE.md §2` 禁做清单）

| 不做 | 理由 |
|---|---|
| 加 CI / husky / pre-commit | 仓库本来没有；演示系统不需要，且会把闸门从"人跑"变成"机器挡"，与单人顺序操作的假设不符 |
| 给 admin-web 引入 vitest | 7 个 spec 在 jest 下正常；引第二个测试框架是纯增复杂度 |
| 补 `.spec.tsx` 支持（jsdom + testing-library） | 属新增能力不属修坑；admin 组件现靠渲染截图验证，本轮不改验证方式 |
| 动 `JWT_SECRET` 回落 `'secretKey'` | 安全兜底，归 `PRODUCTION-NOTES` |
| 清其它未被调用但能跑的脚本 | 只删 §2.2 那 10 个已证死的；`stack-env.test.sh` / `sumsub-deposit-smoke.ts` 明确保留 |
| 修 `swap-sumsub-scenarios.e2e-spec.ts` | 若核实确红，登记后另开一轮；e2e 判据本轮不动 |
| 为旧数据写兼容层 | 本轮不动 schema |

---

## 4. 验收判据

全新库重铺（`stack.sh reset self`）后：

| # | 判据 |
|---|---|
| 1 | `npx tsc --noEmit -p tsconfig.json`（现含 test/scripts/prisma）**0 错** |
| 2 | admin-web / client-web `tsc -b --noEmit` **0 错** |
| 3 | **`npx jest` 全绿**（退出码 0，0 失败）—— 新判据首次生效 |
| 4 | `npm run test:client`（vitest）全绿 |
| 5 | `bash scripts/stack-env.test.sh` PASS |
| 6 | `bash scripts/on-stack.sh self demo:all` —— 花名册 **21/21** 逐条符合预期 |
| 7 | `bash scripts/on-stack.sh self verify:coa` —— 四恒等式 + 49 科目无负余额 |
| 8 | **反向验证**：在 Node 18 下跑闸门，须给出**一句可读报错**，而非一屏红 |
| 9 | **反向验证**：不经 `on-stack.sh` 直接 `npm run demo:all`，须**当场报错**并提示正确用法，而非连上 main 的账本 |
| 10 | **反向验证**：`stack.sh up` 在端口被外部进程占用时，须打印占用者并退出；被自家残留占用时须杀掉并继续 |
| 11 | `stack.sh down` 后 `pgrep -f tigerbeetle` 不残留本栈实例 |

判据 8/9/10 是本轮的核心——**修坑容易，证明坑被堵上要靠反向验证**。

---

## 5. 决策记录

| # | 决策 | 依据 | 强度 |
|---|---|---|---|
| D1 | 债的归宿分三档：能修的直接修（不进任何文件）／机器能查的挂到已有命令上／剩下的才进文档 | 业内共识：文档里的债必然腐烂。本仓库两次证伪：PRODUCTION-NOTES 靠人自觉读（死）、`runtime-diagnose.sh` 靠人自觉跑（死，PRODUCTION-NOTES:394 自己写着"没人会主动跑"） | 业内公认 |
| D2 | 检查必须挂在**已有命令**上，不新开命令 | 同 D1 的第二个证伪案例 | 业内公认 |
| D3 | 6 类问题里 5 类不需要"检查"，直接改根因 | 只有"孤儿/残留"是每日变化的运行时状态 | 本项目判断 |
| D4 | 红名单清零、判据改全绿 | 相对判据（净新失败 0）需人工比对且**已比错过**（本人 2026-08-30 差点把真问题当旧账）；绝对判据机器可判 | 业主拍板 |
| D5 | 孤儿/残留**只报告不自动删** | 1.1 G 不可逆 + 跨栈误删会毁并行会话验收库 | 本项目判断 |
| D6 | `admin-web/src` 保留在 jest roots，只摘 `client-web/src` | admin-web 无 vitest；client-web 有且实测 83/83 全绿 | 本项目判断 |
| D7 | 一起清 21→18 个 webcrypto 垫片 | 业主拍板"一起清"；切 20 后是明确死码，留着会被后人照抄 | 业主拍板 |

### 被实测推翻的判断（留档防复发）

| 我原本说 | 实测 | 教训 |
|---|---|---|
| "`scripts/` 完全不在 tsc 覆盖范围" | 实为 **1/29**，`demo-roster.ts` 因被 `src/` 下的 spec import 而被顺带拉入 | tsc 的 `include` 不是覆盖范围的全部——**它顺 import 走** |
| "`stack-stop.sh` 孤儿 pattern 已修" | grep 模式没算上文件里的转义反斜杠导致误判；改用**活体 pgrep 实测 0/3 命中**才定案 | 结论要在**它断言的那个位置**复现，不能靠 grep 计数 |
| "`e2e-confiscation-async.ts` 是没收唯一覆盖"（引 PRODUCTION-NOTES:100） | 实测现有 3 个 e2e + 7 个单测覆盖没收 | 技术待办里的**覆盖度陈述会过期**，引用前必须复核 |
| "服务跑在 Node 18" | `ps -o command=` 只给 `node`，按 PATH 解析会得到错误答案；查 `lsof -a -d txt` 拿真实二进制才发现是 **v20.20.2** | 问"这个进程用的什么版本"，不能拿**自己 shell 的** `node -v` 回答 |

---

## 6. 执行约束

- **在 worktree 内做**（`CLAUDE.md §10`）：本轮删 9 个文件、改 `tsconfig` / `package.json` / 栈脚本，直接在 main 上做会打断两个并行会话（`act1-permissions` 3100 块、`recon-adj1` 3110 块）
- 清 `/tmp` 残留是文件系统动作、不是代码改动，在主树执行，且**只清对应工作树已不存在的**
- 本轮**不动 schema**，故不涉及重铺闸⑧的迁移部分；但判据要求全新库，仍需 `stack.sh reset self`
