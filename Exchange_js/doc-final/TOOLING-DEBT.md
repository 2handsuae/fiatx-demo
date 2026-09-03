# 工具与环境债

> 建立：2026-08-31（环境收口）｜ 设计稿：`superpowers/specs/2026-08-31-environment-and-tooling-debt-design.md`

## 这个文件装什么

**只装三样都满足的**：① 工具链 / 环境 / 闸门的问题；② 这轮决定不修；③ 机器查不出来。

不满足的去别处：
- 能直接修的 → **就直接修**，不写在任何文件里
- 每日变化的运行时状态（孤儿进程、残留目录）→ 已挂在 `bash scripts/stack.sh up` 的开头自动巡检
- 业务缺口 → `BACKLOG.md`
- 技术兜底（幂等 / 并发 / 攻击面 / 故障恢复）→ `PRODUCTION-NOTES.md`（只写不读，规矩不变）

**分类看缺陷本质，不看它从哪个渠道被撞见。** 一个兜底类缺口偶尔以"测试闪红"的形式冒出来，
它仍然是兜底类，不因此升格进本文件——否则任何偶发红都会被顺势搬进来，
本文件就会重蹈 `PRODUCTION-NOTES.md` 过载不可读的覆辙。（2026-08-31 Task 10 评审建议）

## 两条规矩

1. **进来时必须写清怎么复现** —— 一条能跑的命令 + 期望看到什么。写不出复现步骤的，说明还没查清楚，先查。
2. **修好必须回来划掉** —— 用 `- [x] ~~原文~~` 划掉并注明修它的 commit。

第 2 条是这个文件存在的理由。`PRODUCTION-NOTES.md` 没有这条规矩，于是本轮（2026-08-31 环境收口）核实出**五条陈账**——`on-stack.sh` 缺 PATH、`stack.sh` 从不跑迁移、`verify-demo-data.ts` 引用已 DROP 的表、`swap-sumsub-scenarios` e2e 常年全红、`reset-business-data.ts` 缺 `materialRequest`——全部早已修好或已不复现，只是没人回去划掉——**一个不回收的清单，读它的人是在读已经解决的问题**。

## 债

<!-- 格式：- [ ] **一句话标题**：说明 ｜ **复现**：`命令` → 期望现象 ｜来源: 日期/出处 -->

- [ ] **`admin-web` 的 React 组件无法被 jest 单测执行**：`jest.config.js` 的 `testRegex` 是 `.*\.spec\.ts$`（不匹配 `.spec.tsx`），`moduleFileExtensions` 也没有 `tsx`，且未装 `jest-environment-jsdom` / `@testing-library`。本轮 Task 2（`48c1f7b7`）已经让 `.spec.tsx` 纳入 tsc 类型检查（`admin-web/tsconfig.spec.json`），但那只解决"类型对不对"，jest 本身依旧发现不了、跑不起这些文件——两回事，不要混为一谈。admin 组件目前只能靠 preview 渲染截图验证 ｜ **复现**：`node -p "String(require('./jest.config.js').testRegex)"` → 输出 `.*\.spec\.ts$`；`ls node_modules/jest-environment-jsdom` → 不存在 ｜来源: 2026-08-22 第四批 B5，2026-08-31 环境收口 Task 10 核实仍在

- [x] ~~**`scripts/` 下的 `.spec.ts` 会被 `npx jest` 静默 0 匹配**~~ → **2026-09-01 已修**（`73e7f22a`）：`jest.config.js` 的 `roots` 纳入 `<rootDir>/scripts`。实证：在 `scripts/` 放一个临时探针 spec，改前 `0 matches`、改后 `1 passed`；探针已删。

  <details><summary>原文备查</summary>

  **`scripts/` 下的 `.spec.ts` 会被 `npx jest` 静默 0 匹配**：根 `jest.config.js` 的 `roots` 只有 `<rootDir>/src` 和 `<rootDir>/admin-web/src`，不含 `<rootDir>/scripts`——jest 只在 `roots` 列出的目录里发现测试文件，不在其中的目录放多少 spec 都不会被跑到，不算红也不算绿，就是不存在（"No tests found"）。Task C1（造数花名册）2026-08-29 实测撞过一次（`npx jest scripts/demo-roster.spec.ts` 得 `Pattern: scripts/demo-roster.spec.ts - 0 matches`），当时绕过方式是把 spec 挪去 `src/common/utils/demo-roster.spec.ts`、反向 import 回 `scripts/demo-roster.ts`——这是绕过不是修复，`roots` 本身至今未改。后续任何要给 `scripts/` 下文件直接写 spec 的任务会重复撞同一个坑 ｜ **复现**：`node -p "require('./jest.config.js').roots"` → `[ '<rootDir>/src', '<rootDir>/admin-web/src' ]`（不含 `scripts`）｜来源: 2026-08-29 Task C1 实测，2026-08-31 环境收口 Task 10 核实仍在（未被本轮任何任务触碰）

  </details>

- [ ] **`scripts/demo-lib.ts` 的 `DemoCtx` 里 `prisma`/`depositWf`/`swapWf`/`usdt`/`aed` 仍是 `any`，即便 `scripts/` 已入 tsc 也拦不住**：2026-07-31 那次"防复发闸"事故是双层盲区——① `tsconfig.json` 不覆盖 `scripts/**`；② `DemoCtx.depositWf: any` 让经它调用的方法逃过类型检查。本轮 Task 2（`fdf8d55e`）已经堵上第①层（`tsconfig.json` 的 `include` 现含 `scripts/**/*`，`scripts/` 从 1/29 到 20/20 全覆盖），但第②层没人动——`prisma`/`depositWf`/`swapWf`/`usdt`/`aed` 五个字段依旧声明成 `any`（其中 `swapWf` 还有个已正确定型的同义字段 `swapWorkflowSvc: SwapWorkflowService`，`depositWf` 连这个都没有）。也就是说：如果有人在 `DepositWorkflowService`/`SwapWorkflowService` 上改名或删掉一个被 `ctx.depositWf.xxx()`/`ctx.swapWf.xxx()` 调用的方法，tsc **现在仍然不会报错**——原始事故的复发路径只堵了一半 ｜ **复现**：`grep -nE "  (prisma|depositWf|swapWf|usdt|aed): any;" scripts/demo-lib.ts` → 命中 5 行（`:152` `:156` `:158` `:163` `:164`）｜来源: 2026-07-31 终审 Recommendation 2（原条目），2026-08-31 环境收口 Task 10 核实第①层已修、第②层仍在

- [ ] **`recon-demo.ts` 的 `MANIFEST_PATH` 默认值硬编码指向 main 栈的 tmp 目录**：默认 `/tmp/exchange_js_main/recon-demo-manifest.json`（可用环境变量 `RECON_DEMO_MANIFEST_PATH` 覆盖）。self 栈跑 `recon:demo:break` 一类命令时，manifest 文件会落在 main 栈的 tmp 目录而不是本 worktree 的 tmp——不影响评分本身（`verifyManifest` 读的是内存里的 manifest 对象，不回读文件），仅文件落点跨栈，容易让人误以为 main 栈也被顺手跑了一次。Task 7（`2b916aa2` + `dc916454`）这轮清过 23 处指向 main 账本的内联默认值，但那批明确只覆盖 `TB_ADDRESS`/`DATABASE_URL` 两类（11+12 处），两个 commit 的 diff 里都不含 `recon-demo.ts` 的这两行，`MANIFEST_PATH` 从未在范围内 ｜ **复现**：`grep -n MANIFEST_PATH scripts/recon-demo.ts` → `112:const MANIFEST_PATH = process.env.RECON_DEMO_MANIFEST_PATH` / `113:  ?? '/tmp/exchange_js_main/recon-demo-manifest.json';`（行号因 T11 在文件顶部加了一条 import 而漂移，2026-08-31 记录的 92/93 已过期）｜来源: 2026-07-04 canon2 T5 code-review（M2），2026-08-31 环境收口 Task 10 核实仍在，2026-09-02 平账一期半 Task 11 评审再次实测命中——self 栈（3100-3103）跑 `recon:demo:break` 时终端原样打印 `manifest written to /tmp/exchange_js_main/recon-demo-manifest.json`，坐实「self 栈把文件写去了 main 的 tmp 目录」，仍未修，本条不重复登记

- [x] ~~**`demo:all` 每次跑完必定弄脏 `doc-final/demo/data.md`，"防漂移"这个设计承诺不成立**~~ → **2026-09-01 已修**（`73e7f22a`）：生成区去掉「实到单号」列与生成时间戳——8 列里那 6 列本就跨重铺稳定，单号在提交进 git 的文档里 reset 那一刻就过期、比没用更糟是误导；表头改写清「要当次单号看 `demo:all` 运行时输出」。实证：提交后重铺 + `demo:all` 再跑一轮，`git diff data.md` **零差异**（此后又验过两轮，含单号位宽从 4 改 6 那次）。

  <details><summary>原文备查</summary>

  **`demo:all` 每次跑完必定弄脏 `doc-final/demo/data.md`，"防漂移"这个设计承诺不成立**：`scripts/demo-lib.ts` 的 `writeDataMdSnapshot`/`renderDataMdSnapshot` 生成区表格里带单号列（如 `DEP2608301739`），单号内嵌日期 + 随机后缀，导致同一份代码跑两次也会整表变化（合并当天实测 22 行全变）——`git diff data.md` 因此不能当"代码行为有没有变"的判据用，任何依赖这个假设的验收流程（演示装备一期的 spec/plan 就写了这条）都会失真。连带后果：跑完 `demo:all` 工作树必脏这一个文件，`git worktree remove` 会被拦；本任务自己收到的执行说明里也专门叮嘱"不要提交它"——这条债现在几乎每个任务都会亲身踩一次。修法留在原条目：① 生成区不吐单号列，只留真正该防漂移的那几列；② 单号另起一节并标注"每次跑都变，不参与 diff 判据" ｜ **复现**：`git status --porcelain doc-final/demo/data.md`（在任意一次 `demo:all` 之后）→ 恒为 `M`；本任务自己的工作树此刻就是活证据 ｜来源: 2026-08-30 演示装备一期合并后走查发现，2026-08-31 环境收口 Task 10 核实仍在（未被本轮任何任务触碰）

  </details>

- [x] ~~**`stack-up.sh` 内嵌的预清理调用参数对不上，self 栈的"先 stop 再 up"从未真正执行过**~~ → **2026-08-31 终审后已修**：终审查出同一个错配还有**第二个调用点** `reset-stack.sh:31`，而那条路径**没有 `ensure_port_free` 兜底**，所以并非"无可观察故障"——`reset self` 一直留着抱住已 unlink 旧文件的孤儿 TB，正是「重铺后余额累加、倍数 1→2→3→4」那个假警报的真凶。两处均已改传原始入参（`reset-stack.sh` 用 `${STACK_NAME}`、`stack-up.sh` 用 `"$1"`），实测：起栈后跑 reset，TB pid 真的换了（65714→66004），磁盘 inode 与进程持有的 inode 一致。
  **这条债的教训**：登记时判定"被别的机制兜住了、无可观察故障"，而那个判断只查了两个调用点里的一个。**登记一条债时，要把它的全部调用点找齐再下结论。**
  ~~原文~~：：`stack-up.sh:73`（Task 8 原记录写 `:70`，Task 9 加 `check-stack-residue.sh` 巡检后行号漂移了 3 行）的 `bash "${SCRIPT_DIR}/stack-stop.sh" "${STACK}" >/dev/null 2>&1 || true` 传的是 `load_stack_config` 解析后的栈名——self 栈是 `wt_<worktree名>`（如 `wt_env_debt`）——而 `stack-stop.sh` 期望收到的是原始参数 `main`/`self`（它自己会再调一次 `load_stack_config "$1"`）。解析后的名字落进 `usage_stack_name; exit 1` 分支，`stack-stop.sh` 直接以非零退出；外层 `|| true` 把这个失败吞得干干净净，`up` 看起来若无其事地继续——`stop_pid_file_process`/`stop_listener_if_managed`/`stop_tb_if_managed` 一行都没跑到。main 栈不受影响（`STACK="main"`，传回去精确匹配 `stack-stop.sh` 的 `main)` 分支）。目前无可观察故障：Task 8 新修的 `ensure_port_free` 自愈分支已经能独立兜住"四个端口被自家残留占用"的情形，把这次预清理失效完全盖住了 ｜ **复现**：`bash scripts/stack-stop.sh wt_env_debt` → `Usage: scripts/stack-stop.sh <main|self>`，exit=1（证明如果 `stack-up.sh` 真把 `${STACK}` 传给它，就会踩中这个分支）｜来源: 2026-08-31 Task 8 [D2] 修 `ensure_port_free` 自愈时顺带发现（`ead30e5c` commit message 里已如实记录"顺带发现但不在本任务修"），2026-08-31 环境收口 Task 10 迁入

- [x] ~~**`stack.sh reset` 在全新 worktree 首跑会静默跳过 TigerBeetle 建户与资本注入**~~ → **2026-09-01 已修**（`73e7f22a`），两件一起做：① 根因——`reset-stack.sh:100` / `reset-main.sh:85` 显式传 `TB_ADDRESS`（它由 `load_stack_config` 从 `TB_PORT` 推出、**不读 `.env`**，所以新 worktree 也拿得到；此前子进程能拿到全靠 Prisma 导入时加载 `.env`，实证：脚本内有值、子进程 `(未定义)`）；② 防复发——`provisionTbAccounts` / `seedCapitalInjection` 两处 `return` 改 `throw`（查过调用方：只被业务 seed 调用，而业务 seed 永远需要 TigerBeetle，**没有任何「这次不需要 TB」的合法场景**，graceful skip 纯属陷阱）。实证：点名调用并抹掉 `TB_ADDRESS` → 响亮抛错带修法提示。

  <details><summary>原文备查</summary>

  **`stack.sh reset` 在全新 worktree 首跑会静默跳过 TigerBeetle 建户与资本注入**：`reset-stack.sh` 自己起了 TigerBeetle（`:49`），但下面 `apply-local-migrations` / `db:base:sync` / `db:biz:reset` / `db:seed:business` 四个子进程只传 `DATABASE_URL=`、**不传 `TB_ADDRESS`**；老路径 `reset-main-biz.sh:74` 是传了的，两条路径不一致。平时不发作是因为 `TB_ADDRESS` 在 `.env` 里，而 `.env` 由 `stack.sh up` 生成——**全新 worktree 若先 `reset` 后 `up`，`.env` 尚不存在**，`prisma/seed-tb.helper.ts:79` 打两条 `⚠ TB_ADDRESS not set, skipping ...` 就跳过，退出码仍是 0。后果：库建好了但 TB 账户是空的，`verify:coa` 与 `demo:all` 的 COA 断言会在后面莫名其妙地失败，而失败点离根因很远。规避：新 worktree 先 `stack.sh up self` 让 `.env` 落地再 `reset`；修法：给那四个子进程补 `TB_ADDRESS="${TB_ADDRESS}"` ｜ **复现**：在一个从未 `up` 过的新 worktree 里直接 `bash scripts/stack.sh reset self` → 输出含两条 `⚠ TB_ADDRESS not set, skipping`，退出码仍为 0 ｜来源: 2026-08-30 第一幕职权重划开工实测（并行会话记录），2026-08-31 环境收口合并时迁入——**本轮未修**（Task 8 只修了 `ensure_port_free`/孤儿清理/tb 兜底/跨树守卫四项，这条不在范围内）

  </details>

- [ ] **`on-stack.sh main` 在 worktree 里的语义被静默改了：从"本树代码 + main 库"变成"main 的代码 + main 库"**：Task 8 给 `load_stack_config` 的 `main)` 分支去掉了"非主工作树时用当前树"的旧分支，现在恒把 `APP_DIR` 解析到主工作树；而 `on-stack.sh:16` 自己算的 `APP_DIR` 在 `:33` 的 `load_stack_config` 里被覆盖。新行为更自洽（main 栈的代码和库一起走），但**没人写下来**——在 worktree 里以为自己在验证本树改动的人，会拿到一个跑 main 代码的假绿。`CLAUDE.md §7⑥` 已写"worktree 内用 self"，所以风险有限 ｜ **复现**：在 worktree 里 `bash scripts/on-stack.sh main verify:audit` → 输出的 `[on-stack/main]` 三行指向 main 的库，而实际执行的脚本来自主工作树的 `APP_DIR` ｜来源: 2026-08-31 环境收口终审 Minor③

- [ ] **`on-stack.sh self jest` 不是有效 npm 脚本，四模块治愈计划几乎每个任务的闸门命令都这样写**：`package.json` 没有 `"jest"` 这个 script（只有 `"test": "jest"` 跑单测、`"test:e2e": "jest --config ./test/jest-e2e.json"` 跑 e2e），`on-stack.sh` 按 npm script 名精确查表，查不到就 `exit 2`，不产出任何测试结果。且即便补一个 `"jest": "jest"` 别名也不够用——根 `jest.config.js` 的 `roots` 不含 `test/`，`test/*.e2e-spec.ts` 会被判 0 matches（与已销账的 `scripts/` 假绿同一个坑）。正确用法：跑 `src/` 下 `.spec.ts` 用 `on-stack.sh self test -- <路径>`；跑 `test/` 下 `.e2e-spec.ts` 用 `on-stack.sh self test:e2e -- <路径>`（后者已在 `PRODUCTION-NOTES.md:472` 等多处验证可用）｜ **复现**：`bash scripts/on-stack.sh self jest -- test/approval-expiry.e2e-spec.ts` → `on-stack: no such npm script: jest` ｜来源: 2026-09-01 四模块治愈 Task 1 实测；`doc-final/superpowers/plans/2026-09-01-four-modules-cure.md` 至少 6 处闸门命令这样写（`:135` `:318` `:587` `:732` `:943` `:960`）

- [ ] **`check-stack-residue.sh` 把工作树名里的下划线误当成分隔符**：残留目录名反解成工作树名时用 `tr '_' '-'`，所以 `/tmp/exchange_js_wt_a_b` 会被反推成工作树名 `a-b`——名字里本来就带下划线的工作树会被误报成残留。只报不删、恒 exit 0，无实际损害，但会让人白查一次 ｜ **复现**：`mkdir -p /tmp/exchange_js_wt_a_b && bash scripts/check-stack-residue.sh` → 该目录被列进残留（即便存在名为 `a_b` 的工作树）；查完记得 `rmdir` ｜来源: 2026-08-31 环境收口终审 Minor⑤

- [ ] **AuditLogsModule 自身缺 ApprovalsModule import，窄模块单测拼不起来** —— 手拼 `Test.createTestingModule({ imports: [UsersModule] })` 类窄集合在 compile() 阶段 DI 失败，只能整 AppModule 起（慢）。复现：造任何只 import UsersModule 的 spec。修好后单测可回窄组合 ｜来源: 四模块治愈 Task 3（2026-09-01）

- [ ] **`deposit-sumsub-verdicts.e2e-spec.ts` 的专用库不受 `stack.sh reset` 覆盖，栈内 TigerBeetle 一重铺它就整批复发 7/17 红**：这支 e2e 用专用 SQLite 库（`test/e2e-db.ts` 解析，跟栈库 `dev.db` 同目录、不同文件），但 `TB_ADDRESS` 沿用本 worktree 当前这一个活的 TigerBeetle 实例。`reset-stack.sh`（`stack.sh reset [main|self]` 的实体）会整份清空重建 TigerBeetle 数据文件，但下游 `apply-local-migrations`/`db:base:sync`/`db:biz:reset`/`db:seed:business` 只对**栈库** `dev.db` 重新播种——这支专用库完全不在它的触碰范围内，它的 `tb_account_registry` 表继续指向已经被清空的旧 TB 账户号。表现：`accounting.service.ts:364` 抛 `NotFoundException: TigerBeetle account ... not found`，配合几条 `DepositWorkflowService` 报的 `TigerBeetle transfer rejected: status=21 (debit_account_not_found)`，7/17 用例卡在中间态。**字面上再跑一次 `stack.sh reset` 修不好**——它只会再洗一次 `dev.db`，专用库依旧孤悬。修法是对这支 e2e 的专用库单独重新 provisioning（三条命令抄自测试文件自己的头部提示，不是新发明）：`rm -f <专用库路径>` → `DATABASE_URL=<专用库> npx prisma migrate deploy` → `DATABASE_URL=<专用库> npm run db:base:sync` → `DATABASE_URL=<专用库> TB_ADDRESS=<当前栈的TB地址> npm run db:biz:init` ｜ **复现**：任意一次 `stack.sh reset [main|self]`（清空过 TigerBeetle）之后，`bash scripts/on-stack.sh self test:e2e -- test/deposit-sumsub-verdicts.e2e-spec.ts` → 7 failed, 10 passed，首条失败即 `NotFoundException: TigerBeetle account ... not found` ｜来源: 2026-09-02 Task 20 后 triage（`.superpowers/sdd/triage-deposit-sumsub-e2e.md`），当次按上述三条命令重新 provisioning 后验证 17/17 绿
- [ ] **Docker 入口每次启动无条件跑 db:base:sync，会触发新的管理员账号清空逻辑** —— `docker/backend-entrypoint.sh:29` 直调 `seedBase()`（非 ensureBaseSeeded），Task 31 给 seed 新增的 `deleteObsoleteRoleAdminAccounts()` 在此路径同样生效：dev.db 若在容器重启间存活，演示中站 0 邀请的新管理员会被下次重启静默清掉。修法方向：该入口改走 ensureBaseSeeded()，或清账号逻辑只在显式 reset 语境执行。worktree 的 stack.sh reset 通道不受影响 ｜来源: 四模块治愈 Task 31 审查（2026-09-02）
- [ ] **e2e 之间共享同一个库，并行跑时彼此夹具互踩——`test:e2e` 全套并行 14 个套件 9 红**：`test/*.e2e-spec.ts` 全部经 `scripts/on-stack.sh` 注入同一个 `DATABASE_URL` + `TB_ADDRESS`，各文件不是各跑各的沙箱；jest 默认按 CPU 数派并行 worker，于是 A 文件的种子/清理会踩到 B 文件正在断言的数据。**2026-09-02 平账一期半 Task 12 实测**：`--maxWorkers=4` 跑全套 → `Test Suites: 9 failed, 5 passed, 14 total` / `Tests: 59 failed, 38 passed, 97 total`（红的有 withdraw-money-arcs、material-requests、demo-roster、deposit-sumsub-verdicts、sla、customer-restrictions、sanction-subject-split、kyt-verdict-landing 等，**与 recon 无关，是既有问题**）。本轮已给 `test/jest-e2e.json` 加 `maxWorkers: 1`（那里写了完整原委），把这类互踩整体压住——但那只是"串行声明"，**根因没解**：真正的修法是让每份 e2e 拿到自己的库（每文件一个 SQLite 文件 + 一个 TB ledger 段），或统一一套 setup/teardown 契约。在根因解掉之前，谁把 `maxWorkers` 调大谁就会重新撞上 ｜ **复现**（注意 `on-stack.sh` 的 `--` 会把参数变成位置匹配，要覆盖 workers 数必须直接调 jest）：
  ```bash
  export DATABASE_URL="file:/tmp/exchange_js_wt_<名>/dev.db" TB_ADDRESS="127.0.0.1:<TB端口>"
  npx jest --config ./test/jest-e2e.json --maxWorkers=4
  ```
  ｜来源: 2026-09-02 平账一期半 Task 12 评审（新增第二份调全局 `walletRecon.run()` 的 spec 后，`--testPathPattern 'test/recon-'` 4/4 红当场暴露）+ 同任务自测全套并行读数

- [ ] **`bash scripts/on-stack.sh self test -- <path> -t "<模式>"` 会跑全仓而不是只跑目标文件**：带 `-t` 过滤模式时，jest 仍先发现并加载全部 suites、再按 `-t` 的模式过滤要跑的用例，并不会只加载目标文件 ｜ **复现**：在任意 worktree 跑 `bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.spec.ts -t "账龄"` → 观察 jest 跑了全部 suites，不是只跑目标文件 ｜ **规避**：不带 `-t`，跑整个 spec 文件 ｜来源: 2026-09-02 平账 A 批

- [ ] **`stack.sh reset self` 清业务表但不清 `audit_log_events`，案件号 `REC{业务日}-{序号}` 同日 reset 重跑会复用 → 按案件号查审计的 e2e 撞历史行**：审计表不在 `reset` 的清空范围内，同一天多次 reset+重铺，案件号序列从头再来，若某条 e2e 按「案件号」查审计而不圈定时间窗，会连带查到上一轮同案件号残留的历史审计行 ｜ **复现**：同一天 `reset self` → `demo:all` → `test:e2e --testPathPattern recon-aging-write-off` 两次，第二次若审计查询未按时间圈定即红 ｜ **规避 / 根治**：本批 e2e 已按 `recordedAt >= 测试起点` 圈定查询窗口规避；根治要么 reset 时把审计表也清掉、要么案件号加随机位 ｜来源: 2026-09-02 平账 A 批

- [ ] **`verify:audit` 的 Q6（谁查过审计日志）在重铺后的空库上恒红，需先用管理员 token 调一次 `GET /admin/audit-logs`**：这条不是缺陷，是 Q6 判据本身要求「有人查过审计日志」这个动作发生过；`demo/baseline.md` 已记它为「已知波动」（演示剧本第七幕自然会触发这一步），但单独跑 `verify:audit`（不经过完整剧本）时会先看到红 ｜ **复现**：reset 后直接跑 `on-stack.sh self verify:audit` ｜来源: 2026-09-02 平账 A 批

- [ ] **`scripts/demo-in-transit.ts` 的 `pickCollisionFreeWdAmount` 仍按 `assetId` 查 Wallet 表，V3 波一 Task 4 把 Wallet 改成按（vault × network × 归属人）开地址行、砍掉 `assetId` 列之后这行就没人补**：`tsc` 拦不住——`DemoCtx.prisma` 声明成 `any`（`TOOLING-DEBT.md` 已有一条登记这个盲区），故此处虽是 `ctx.prisma.wallet.findMany`（非 `as any`）也逃过类型检查，只有跑起来才炸。Task 6 把 `withdraw-transactions.service.ts`/`withdraw-workflow.service.ts`/`recon-demo.ts`/`demo-lib.ts:1100`（提现在途单地址派生）等按 network 改造完的路径都已收口，唯独这条不在 Task 6 brief 的文件清单里、也不被 `demo:all`/`verify:coa`/e2e 触碰（`demo:all` 走 `demo-lib.ts` 的 `runWithdraws`+`demo-fixtures.ts` 的 `createStuckWithdraw`，两者都已用 `network` 查询，不经过这个函数）——只有单独跑 `demo:in-transit` 命令才会撞上，故这轮不修 ｜ **复现**：`bash scripts/on-stack.sh self demo:in-transit` → `FATAL PrismaClientValidationError: ... Unknown argument \`assetId\`. Available options are marked with ?.`（`ownerId`/`assetId` 那个 where 子句），exit 1，失败发生在造任何夹具之前、不留残留 ｜ **修法**：`scripts/demo-in-transit.ts:41-44` 的 `where: { ownerId: customer.id, assetId: asset.id }` 改 `where: { ownerId: customer.id, network: asset.network }`（同一份改法在 `demo-fixtures.ts:163-165` 的 `createStuckWithdraw` 已经这么写，照抄即可）｜来源: 2026-09-03 V3 财务配置治愈波一 Task 6 实测（`git grep -n "assetId" -- scripts/demo-in-transit.ts` 命中，跑 `demo:in-transit` 复现坐实）
