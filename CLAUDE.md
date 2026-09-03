# Exchange_js — 项目总纲

NestJS + Prisma + SQLite 后端 ｜ React 管理台 ｜ React 客户端 ｜ 会话在 `Exchange_js/` 下运行

## 0. 这是什么

虚拟币 / 法币 broker-dealer **演示系统**。观众是开发与业务同事；目的只有两个：**把关键业务逻辑演示清楚**，并**沉淀成产品文档**。不是生产系统，不追求健壮性。

## 1. 判断标准（收到任何任务先过这两句）

- 演示者带同事走一遍流程时**看不到、讲不到**的东西，不做。
- 会写进 PRD 的是业务规则（做）；只有攻击者、故障或并发才会触发的是技术兜底（不做）。

拿不准 → 查 `doc-final/rules/review-rubric.md` 的判定表。

## 2. 禁做清单（一律不做、不修、不测、不进 plan）

幂等 ｜ 去重 ｜ 重试与回放 ｜ 补偿与 repair ｜ 并发锁 ｜ 向后兼容与迁移兼容层 ｜ 管理 API 权限加固 ｜ 输入防御性校验 ｜ 性能优化 ｜ 边界防御 ｜ 为让测试通过而修测试框架

## 3. 允许的假设

单人顺序操作；外部系统（Sumsub / 链上 / 银行，均为模拟）总是准时回调且只回一次；管理员都是善意的；数据随时可重铺——schema / 状态机改动直接按目标终态做，**禁止**为旧数据写 backfill / 兼容层 / 双写过渡（迁移文件照常新增以保证空库能建起，内容不必兼容已有行；改完 = reset 重铺）。

## 4. 出口（债往哪放）

| 发现什么 | 放哪 | 规矩 |
|---|---|---|
| 业务缺口 | `doc-final/BACKLOG.md` | 正常待办 |
| **技术兜底**（幂等 / 去重 / 重试回放 / 补偿 repair / 并发锁 / 攻击面 / 故障恢复） | `doc-final/PRODUCTION-NOTES.md` | **追加一行，然后放下**：不修、不讨论、不进 plan。只许追加，不许读它来找活干 |
| **工具 / 环境 / 闸门** | `doc-final/TOOLING-DEBT.md` | **要读要清**。进来写清怎么复现，修好回来划掉 |

第三类是 2026-08-31 拆出来的：此前它跟技术兜底同桶，于是也变成按设计不可读——
`scripts/**` 不在 tsc 覆盖那条 2026-07-31 就登记了、还自称"防复发闸"，31 天后原样复发一次。

## 5. 不可违反规则（6 条，宗旨级；落地写法见 `doc-final/rules/`）

1. **操作必留痕**：operator 的每个持久化动作，审计日志里必须查得到——VARA 场景下审计是业务可见物，不是技术件
2. **门不可绕**：onboarding / 合规 / 审批（maker-checker）三类门的语义都不许绕——闸门本身就是演示内容
3. **各管各的**：主体只写自己的数据、只迁自己的状态；跨主体协作只发生在 workflow；workflow 只调主体服务方法、不直写任何表（横向读客户主数据放行）
4. **状态只能沿边走**：状态变更必须经该主体的显式迁移表，非法跃迁显式拒绝；要新结局就加一条边，不许绕表直写
5. **钱动必过账**：任何资金移动必须有资金单镜像 + 账本分录（实时 1:1），记账失败即流程失败——账实一致是对账演示的前提
6. **对外用业务键**：客户、订单对外识别一律用业务单号，不用内部 id；管理台不暴露 UUID——单号是演示可见物

（多表状态变更自然用事务，不当交付项。）

## 6. 流程尺寸

- spec / plan 由 superpowers 技能产出，格式技能自治；写入 `doc-final/superpowers/{specs,plans}/`，任务合并后移入 `doc-final/archive/`；代码体检报告写入 `doc-final/superpowers/checkups/`，同一生命周期
- 一个模块一波做不完 → 讨论完先定**总纲**（目标 / 拆几波 / 每波边界与验收口径），**单独一份文件**放 `specs/`（各波 spec 会逐波归档，总纲要活到最后一波）；spec **只写细当前波**，后面每波当场立一份**骨架**（总纲链接 / 空的「承接上一波」节 / 已定事实 / 待定岔口——承接记录要有地方落）；每波收尾只按 `rules/delivery-checklist.md` 往下一波 spec 开头写**承接记录**，下一波 spec 的展开是下一波**新会话**读总纲 + 承接后跟业主脑暴的活，收尾会话不代做
- 任务标题用业务语言；任务开场必须列「本任务做 / 不做」，"不做"项对照 §2
- 任务收尾对照 `doc-final/rules/delivery-checklist.md`——按触发条件列出必须交付的东西；plan 引用它，不重抄
- 评审按 `doc-final/rules/review-rubric.md`，只判三件事，其余不算缺陷
- 派 subagent 时，任务 prompt 必须带上本文件 §0–§5 的要点
- 派 subagent 的模型分层（判断密度高且一次性的不降档，重复且有终审兜底的降档）：任务执行 / 任务级 code review / 走查截图 / 文档收口 → `sonnet`；纯批量机械活（导表 / 批量扫描 / 重命名）→ `haiku`；spec 评审、终审、变异测试 → `fable` 不降档；plan 给动钱 / 动状态机的高危任务点名升档评审 → `opus`。闸门红了诊断不动 → 回主会话，不让便宜模型死磕
- 代码体检 / 现状摸底：扫描取数 → `sonnet`（纯计数可 `haiku`），判读与结论 → 主会话不降档——体检输出是后续轮次的地图，判错会被逐轮放大。扫描子代理交「数字 + 复现命令」、不交裸结论；否定性结论（零引用 / 没有 / 不存在）九成错在搜法不在事实，主会话抽查复现后才采信

## 7. 闸门（分两档）

**随手闸——每次改完代码就跑**

```bash
npx tsc --noEmit -p tsconfig.json               # ① 后端（含 src / test / scripts / prisma）
cd admin-web  && npx tsc -b --noEmit && cd ..    # ② 管理台（.tsx 与 .spec.ts 只有②③编译得到）
cd client-web && npx tsc -b --noEmit && cd ..    # ③ 客户端
```

- ④ jest 只跑本任务相关目录，判据 = **全绿**（红名单 2026-08-31 已清零退役）；改了 client-web 另跑 `npm run test:client`（vitest）；改了栈脚本另跑 `bash scripts/stack-env.test.sh`
- ⑤ 改了前端 → 必须起 preview 渲染 + 截图验证，tsc 通过不算数

**收尾闸——任务收尾 / 合并前，按条件叠加**

- ⑥ `bash scripts/on-stack.sh main demo:all` 走通并断言终态（worktree 内用 self；`demo/script.md` 就位后升级为按剧本走查）
- ⑦ 动过钱（记账 / 资金单 / 科目）→ `bash scripts/on-stack.sh main verify:coa`（恒等式 + 负余额）
- ⑧ 动过 schema / seed / 迁移 → 重铺闸：`bash scripts/stack.sh reset [main|self]` 从零建库重铺（含 TigerBeetle 清理重建，main/self 通用），再跑 ⑥；判据对照 `doc-final/demo/baseline.md`，**全绿**

测试的绿必须来自行为；禁止写「扫源码文本」型断言。

## 8. 路由表（按任务读文档，根在 `doc-final/`）

| 时机 | 读什么 |
|---|---|
| 会话开始 | `modules/overview.md` |
| 改某模块 | `prd/<篇>`（未写则跳过）→ `modules/<篇>` |
| 动任何设计决定前 | `decisions.md` —— 已否决的方案不翻案 |
| 写后端 / 前端代码 | `rules/backend.md` ｜ `rules/frontend-admin.md` / `rules/frontend-client.md`（UI 契约见 `ui-contract/`） |
| 改页面 / 种子数据 | 同步 `demo/data.md`、`demo/script.md` 对应步骤 |
| 验收 / 走查 | `demo/script.md`（七幕主线）+ `modules/<篇>` §4 演示脚本 |
| 说"以后做" | 业务缺口记 `BACKLOG.md`；技术兜底记 `PRODUCTION-NOTES.md`；工具/环境记 `TOOLING-DEBT.md` |
| 要同步到飞书的业务文档 | `lark/`——业主维护、agent **不读**（不是现状真相，真相只在 `modules/`） |

**不读** `archive/`（历史存档）、`lark/`。**不在本表里的文档不该存在**——发现了就删或归档，不另建地图。rules 与本文件冲突时以本文件为准。

两层关系：**`modules/` = 现状唯一真相 ｜ `demo/script.md` + `modules/<篇>` §4 = 验收（演得出来就算过）**；两者不一致就是待办，登记 BACKLOG。
（`prd/` 应然层未建、PRD 在飞书；旧 `test-cases/` 271 条用例 2026-08-31 整体封箱，理由见 `archive/test-cases/README.md`。）

## 9. Thread 完成规则

每轮结束报一行，说清动了哪层：
`Documentation updated: prd / modules§0-4 / modules§5 / demo / decisions / none — <一句话>`

## 10. 环境与命令（运维事实）

**两种栈**：`main`（主工作树，端口 3000–3003，DB `/tmp/exchange_js_main/dev.db`）｜ `self`（每个 worktree 自动分 4 端口，记在该树 `.stackports`，DB `/tmp/exchange_js_wt_<名>/`）。

```bash
bash scripts/stack.sh up main      # 主工作树起栈（down main / reset-main 同理）
bash scripts/stack.sh up           # worktree 内起自己的栈（= self）
bash scripts/stack.sh status       # 看各栈端口与状态
```

- 端口隔离铁律：每个栈只碰自己的端口段和 DB，禁止跨栈访问；起服务前 `lsof -ti:<端口段>` 确认无残留
- ⚠️ `recon:demo` / `demo:*` / `verify:demo-data` 等 12 个 npm 脚本**必须经包装器**：主树 `bash scripts/on-stack.sh main <script>`，worktree 内 `bash scripts/on-stack.sh self <script>`。2026-08-31 起它们的内联默认值已全部剥除（此前 11 处默认连 **main 的 TigerBeetle**，漏套包装器 = 读自己的空库、写 main 的账本且不报错），改为缺 `DATABASE_URL`/`TB_ADDRESS` 时**当场 fail-fast 并提示正确用法**
- **并行任务一律 worktree 隔离**：一会话 = 一 worktree（统一放 `.claude/worktrees/<名>/`）= 一分支 = 一套自动分的栈；要为某分支起服务只在它的 worktree 里 `stack.sh up`，绝不在主工作树切分支跑服务；合并后清 worktree + 分支
