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

第 2 条是这个文件存在的理由。`PRODUCTION-NOTES.md` 没有这条规矩，于是本轮（2026-08-31 环境收口）核实出**五条陈账**——`on-stack.sh` 缺 PATH、`stack.sh` 从不跑迁移、`verify-swap-self-heal.ts` 失修、`verify-demo-data.ts` 引用已 DROP 的表、`swap-sumsub-scenarios` e2e 常年全红——全部早已修好或已不复现，只是没人回去划掉——**一个不回收的清单，读它的人是在读已经解决的问题**。

## 债

<!-- 格式：- [ ] **一句话标题**：说明 ｜ **复现**：`命令` → 期望现象 ｜来源: 日期/出处 -->

- [ ] **`admin-web` 的 React 组件无法被 jest 单测执行**：`jest.config.js` 的 `testRegex` 是 `.*\.spec\.ts$`（不匹配 `.spec.tsx`），`moduleFileExtensions` 也没有 `tsx`，且未装 `jest-environment-jsdom` / `@testing-library`。本轮 Task 2（`48c1f7b7`）已经让 `.spec.tsx` 纳入 tsc 类型检查（`admin-web/tsconfig.spec.json`），但那只解决"类型对不对"，jest 本身依旧发现不了、跑不起这些文件——两回事，不要混为一谈。admin 组件目前只能靠 preview 渲染截图验证 ｜ **复现**：`node -p "String(require('./jest.config.js').testRegex)"` → 输出 `.*\.spec\.ts$`；`ls node_modules/jest-environment-jsdom` → 不存在 ｜来源: 2026-08-22 第四批 B5，2026-08-31 环境收口 Task 10 核实仍在

- [ ] **`scripts/` 下的 `.spec.ts` 会被 `npx jest` 静默 0 匹配**：根 `jest.config.js` 的 `roots` 只有 `<rootDir>/src` 和 `<rootDir>/admin-web/src`，不含 `<rootDir>/scripts`——jest 只在 `roots` 列出的目录里发现测试文件，不在其中的目录放多少 spec 都不会被跑到，不算红也不算绿，就是不存在（"No tests found"）。Task C1（造数花名册）2026-08-29 实测撞过一次（`npx jest scripts/demo-roster.spec.ts` 得 `Pattern: scripts/demo-roster.spec.ts - 0 matches`），当时绕过方式是把 spec 挪去 `src/common/utils/demo-roster.spec.ts`、反向 import 回 `scripts/demo-roster.ts`——这是绕过不是修复，`roots` 本身至今未改。后续任何要给 `scripts/` 下文件直接写 spec 的任务会重复撞同一个坑 ｜ **复现**：`node -p "require('./jest.config.js').roots"` → `[ '<rootDir>/src', '<rootDir>/admin-web/src' ]`（不含 `scripts`）｜来源: 2026-08-29 Task C1 实测，2026-08-31 环境收口 Task 10 核实仍在（未被本轮任何任务触碰）

- [ ] **`scripts/demo-lib.ts` 的 `DemoCtx` 里 `prisma`/`depositWf`/`swapWf`/`usdt`/`aed` 仍是 `any`，即便 `scripts/` 已入 tsc 也拦不住**：2026-07-31 那次"防复发闸"事故是双层盲区——① `tsconfig.json` 不覆盖 `scripts/**`；② `DemoCtx.depositWf: any` 让经它调用的方法逃过类型检查。本轮 Task 2（`fdf8d55e`）已经堵上第①层（`tsconfig.json` 的 `include` 现含 `scripts/**/*`，`scripts/` 从 1/29 到 20/20 全覆盖），但第②层没人动——`prisma`/`depositWf`/`swapWf`/`usdt`/`aed` 五个字段依旧声明成 `any`（其中 `swapWf` 还有个已正确定型的同义字段 `swapWorkflowSvc: SwapWorkflowService`，`depositWf` 连这个都没有）。也就是说：如果有人在 `DepositWorkflowService`/`SwapWorkflowService` 上改名或删掉一个被 `ctx.depositWf.xxx()`/`ctx.swapWf.xxx()` 调用的方法，tsc **现在仍然不会报错**——原始事故的复发路径只堵了一半 ｜ **复现**：`grep -nE "  (prisma|depositWf|swapWf|usdt|aed): any;" scripts/demo-lib.ts` → 命中 5 行（`:152` `:156` `:158` `:163` `:164`）｜来源: 2026-07-31 终审 Recommendation 2（原条目），2026-08-31 环境收口 Task 10 核实第①层已修、第②层仍在

- [ ] **`recon-demo.ts` 的 `MANIFEST_PATH` 默认值硬编码指向 main 栈的 tmp 目录**：默认 `/tmp/exchange_js_main/recon-demo-manifest.json`（可用环境变量 `RECON_DEMO_MANIFEST_PATH` 覆盖）。self 栈跑 `recon:demo:break` 一类命令时，manifest 文件会落在 main 栈的 tmp 目录而不是本 worktree 的 tmp——不影响评分本身（`verifyManifest` 读的是内存里的 manifest 对象，不回读文件），仅文件落点跨栈，容易让人误以为 main 栈也被顺手跑了一次。Task 7（`2b916aa2` + `dc916454`）这轮清过 23 处指向 main 账本的内联默认值，但那批明确只覆盖 `TB_ADDRESS`/`DATABASE_URL` 两类（11+12 处），两个 commit 的 diff 里都不含 `recon-demo.ts` 的这两行，`MANIFEST_PATH` 从未在范围内 ｜ **复现**：`grep -n MANIFEST_PATH scripts/recon-demo.ts` → `92:const MANIFEST_PATH = process.env.RECON_DEMO_MANIFEST_PATH` / `93:  ?? '/tmp/exchange_js_main/recon-demo-manifest.json';` ｜来源: 2026-07-04 canon2 T5 code-review（M2），2026-08-31 环境收口 Task 10 核实仍在

- [ ] **`demo:all` 每次跑完必定弄脏 `doc-final/demo/data.md`，"防漂移"这个设计承诺不成立**：`scripts/demo-lib.ts` 的 `writeDataMdSnapshot`/`renderDataMdSnapshot` 生成区表格里带单号列（如 `DEP2608301739`），单号内嵌日期 + 随机后缀，导致同一份代码跑两次也会整表变化（合并当天实测 22 行全变）——`git diff data.md` 因此不能当"代码行为有没有变"的判据用，任何依赖这个假设的验收流程（演示装备一期的 spec/plan 就写了这条）都会失真。连带后果：跑完 `demo:all` 工作树必脏这一个文件，`git worktree remove` 会被拦；本任务自己收到的执行说明里也专门叮嘱"不要提交它"——这条债现在几乎每个任务都会亲身踩一次。修法留在原条目：① 生成区不吐单号列，只留真正该防漂移的那几列；② 单号另起一节并标注"每次跑都变，不参与 diff 判据" ｜ **复现**：`git status --porcelain doc-final/demo/data.md`（在任意一次 `demo:all` 之后）→ 恒为 `M`；本任务自己的工作树此刻就是活证据 ｜来源: 2026-08-30 演示装备一期合并后走查发现，2026-08-31 环境收口 Task 10 核实仍在（未被本轮任何任务触碰）

- [ ] **`stack-up.sh` 内嵌的预清理调用参数对不上，self 栈的"先 stop 再 up"从未真正执行过**：`stack-up.sh:73`（Task 8 原记录写 `:70`，Task 9 加 `check-stack-residue.sh` 巡检后行号漂移了 3 行）的 `bash "${SCRIPT_DIR}/stack-stop.sh" "${STACK}" >/dev/null 2>&1 || true` 传的是 `load_stack_config` 解析后的栈名——self 栈是 `wt_<worktree名>`（如 `wt_env_debt`）——而 `stack-stop.sh` 期望收到的是原始参数 `main`/`self`（它自己会再调一次 `load_stack_config "$1"`）。解析后的名字落进 `usage_stack_name; exit 1` 分支，`stack-stop.sh` 直接以非零退出；外层 `|| true` 把这个失败吞得干干净净，`up` 看起来若无其事地继续——`stop_pid_file_process`/`stop_listener_if_managed`/`stop_tb_if_managed` 一行都没跑到。main 栈不受影响（`STACK="main"`，传回去精确匹配 `stack-stop.sh` 的 `main)` 分支）。目前无可观察故障：Task 8 新修的 `ensure_port_free` 自愈分支已经能独立兜住"四个端口被自家残留占用"的情形，把这次预清理失效完全盖住了 ｜ **复现**：`bash scripts/stack-stop.sh wt_env_debt` → `Usage: scripts/stack-stop.sh <main|self>`，exit=1（证明如果 `stack-up.sh` 真把 `${STACK}` 传给它，就会踩中这个分支）｜来源: 2026-08-31 Task 8 [D2] 修 `ensure_port_free` 自愈时顺带发现（`ead30e5c` commit message 里已如实记录"顺带发现但不在本任务修"），2026-08-31 环境收口 Task 10 迁入

- [ ] **`stack.sh reset` 在全新 worktree 首跑会静默跳过 TigerBeetle 建户与资本注入**：`reset-stack.sh` 自己起了 TigerBeetle（`:49`），但下面 `apply-local-migrations` / `db:base:sync` / `db:biz:reset` / `db:seed:business` 四个子进程只传 `DATABASE_URL=`、**不传 `TB_ADDRESS`**；老路径 `reset-main-biz.sh:74` 是传了的，两条路径不一致。平时不发作是因为 `TB_ADDRESS` 在 `.env` 里，而 `.env` 由 `stack.sh up` 生成——**全新 worktree 若先 `reset` 后 `up`，`.env` 尚不存在**，`prisma/seed-tb.helper.ts:79` 打两条 `⚠ TB_ADDRESS not set, skipping ...` 就跳过，退出码仍是 0。后果：库建好了但 TB 账户是空的，`verify:coa` 与 `demo:all` 的 COA 断言会在后面莫名其妙地失败，而失败点离根因很远。规避：新 worktree 先 `stack.sh up self` 让 `.env` 落地再 `reset`；修法：给那四个子进程补 `TB_ADDRESS="${TB_ADDRESS}"` ｜ **复现**：在一个从未 `up` 过的新 worktree 里直接 `bash scripts/stack.sh reset self` → 输出含两条 `⚠ TB_ADDRESS not set, skipping`，退出码仍为 0 ｜来源: 2026-08-30 第一幕职权重划开工实测（并行会话记录），2026-08-31 环境收口合并时迁入——**本轮未修**（Task 8 只修了 `ensure_port_free`/孤儿清理/tb 兜底/跨树守卫四项，这条不在范围内）
