# PRODUCTION-NOTES — 生产化才做的账

> 本系统是演示系统，不做技术兜底（CLAUDE.md §2）。凡发现兜底类缺口，在对应分区**追加一行即完成处理**：不修、不讨论、不进 plan、不进 BACKLOG。
> 本文件不是待办清单：agent 只许追加，不许读它来安排工作。将来若生产化，从这里起步。

格式：`- [日期] 一句话缺口 ｜ 位置（模块/文件） ｜ 来源（会话/审查）`

## 安全与权限

> 2026-08-26 BACKLOG 分流迁入（原文照搬，上下文见 git 历史 db01f280）。另补 2026-08-15 逐条实证过的既有安全洞：

- [2026-08-15] JWT_SECRET 恒回落字面量 'secretKey'（6 处源码，.env 不写该键），可自签 SUPER_ADMIN 令牌 ｜ 全局 ｜ 实证于 27530d9b
- [2026-08-15] G1 权限守卫多处 fail-open（对非 ADMIN token 等同放行） ｜ 多 admin 端点 ｜ 实证于 27530d9b
- [2026-08-15] C1 ACCOUNTING_TERMINALS 缺 COMPLIANCE_PENDING，可凭空造余额 ｜ accounting ｜ 实证于 27530d9b
- [2026-08-15] C2 TB flags 恒 0，"不可透支"约束从未启用（truth v3 相关描述有误） ｜ accounting ｜ 实证于 27530d9b
- [2026-08-25] 审计五条非字段约定未实现：库级撤销 UPDATE/DELETE ｜ 展示名映射表 ｜ UTC+NTP ｜ digest 取未脱敏原文 ｜ 超长截断优先级 ｜ audit-logging ｜ 8/25 第一批设计

**原 BACKLOG §技术债 — V5 提现**

- [ ] **`POST /client/withdraw-transactions` 创建响应未过白名单**：`CustomerWithdrawController.create()` 直接返回 `workflow.createWithdrawal()` 的原始行（含 `sumsubTxnId`/`manualReason`/`slaDeadline`/`statusHistory`/`tbPendingNetId`/`tbPendingFeeId`/`approvalNo`/`traceId` 等调查性字段），列表/详情两个读端点均已正确走 `toCustomerWithdrawView()` 白名单，仅创建这一个响应体漏网；真机验证实测复现（见 `.superpowers/sdd/task-12-report.md`）｜来源: 2026-08-04 Task 12 真机验证

**原 BACKLOG §技术债 — V1 审计底座**

- [ ] **SUPER_ADMIN 硬编码 bypass**：`access-control.service.ts` 对 SUPER_ADMIN 跳过 SoD + 直给全权限；roadmap 定性演示角色，**上线前须移除此 bypass**｜来源: 2026-07-04 V1 体检。⚠️ 2026-08-25 Task 11 实测确认此 bypass 仍生效且范围比字面更广：SUPER_ADMIN 对**任意**审批类型（非仅其自身权限相关的）都能自批自己提交的请求（`admin@fiatx.com` 提交的 `ADMIN_SUSPENSION_APPROVAL` 被同一账号自批成功，`APPROVAL_SOD_DENIED` 未触发）；换成 CISO 自批 `ROLE_DEFINITION_CREATE` 才会正确触发 SoD 拦截。行为本身与 `prisma/seed.base.ts:220` 注释的设计意图一致（"unless SUPER_ADMIN bypass applies"），非本批引入，但此前无人用真实数据坐实过

**原 BACKLOG §技术债 — 第三批 SLA（三域，2026-08-21 落地）**

- [ ] **`SwapTransactionsController` 的 `advance`/`resume` 两端点缺 `assertAdmin`**：`swap-transactions.controller.ts` 的 `advanceSwapLeg()`（`:68`）与 `resumeSwapLeg()`（`:87`）只挂 `@RequirePermissions` 装饰器，没有调用本批新增的私有 `assertAdmin(req)`——而 `AdminPermissionGuard.canActivate` 对非 ADMIN token 直接 `return true`（NO-OP，`DepositTransactionsController` 那组同类洞已登记于「安全守卫」节），意味着理论上一个持有对应权限码的 CUSTOMER token 也能打这两个端点。本批只给新增的 `simulate-sla-timeout` 端点加了 `assertAdmin()`（`d5979c15`，"跨租户越权"修复），`advance`/`resume` 是旧端点，按仓库先例（BACKLOG 现有条目只覆盖 `DepositTransactionsController` 的四个路由）未在本批修复，登记为新债 ｜来源: 2026-08-21 SLA 批次

**原 BACKLOG §真欠账**

- [ ] **客户面 `GET /swap-transactions/:id` 零调用方，且越权返 403 泄漏存在性**：`swap-transactions-customer.controller.ts` 的 `@Get(':id')` → `findOneForCustomer(id, userId)`，`ownerId` 不符时抛 `ForbiddenException('Not your swap transaction')` ——403 与 404 的差别就是一个存在性预言机（拿别人的 swapId 试一试，403 = 存在，404 = 不存在）。充值/提现的对应实现都用**同一个 404** 兼作 IDOR 守卫。本批新增的 `GET my/:swapNo` 已按铁律③走业务键，前端 `client-web` 全仓 grep 确认**没有任何调用方**打 `:id` 那条——建议直接退役该端点 ｜来源: 2026-08-22 第四批 D3
- [ ] **`swap-transactions.service.ts → findOne()` 的 `customer: { include: … }` 会把 `passwordHash` 返给 admin 端**：本批把 `customer: true` 改成 `customer: { include: { restrictionRows: … } }` 以取限制账真数据——**改动前后完全一样**，`include` 不做字段裁剪，`CustomerMain` 上的 `passwordHash`/`passwordUpdatedAt`/`failedLoginCount`/`lockedUntil` 全都在响应里。**提现域三处 `customer: true` 同样如此**（`findAll`/`findOneInternal`/`findOne`）；**充值域已经是安全的**（两处都用 `customer: { select: {...} }` 五六个字段）——所以这不是「三域皆然」，是「充值早已修好、另两域没跟上」。修法照抄充值：改 `select` ｜来源: 2026-08-22 第四批 D2/E1（非本批引入）

**前端**


**原 BACKLOG §技术债 — 平账处置（推单）**

- [ ] **推单/sim-advance 端点用 INTERNAL_FUND_READ 读权限门控变更操作**：/admin/funds-orders/:no/push/sync|manual + :no/advance 都是变更/动钱操作却挂 _READ → 读权限 operator 也能推单结算。应新增**写/处置权限**统一门控三端点（需 db:base:sync + 重启）｜来源: 2026-07-03 推单 T3 code-review M-2 ｜下期专门 RBAC 轮（与下条命名债一并做）

**原 BACKLOG §安全守卫（已生成卡片，跟踪落地）**

- [ ] 提现后端补提现地址 ACTIVE 校验（绕过前端可用任意地址提现）｜卡片 task_20678a2c ｜来源: 2026-07-03 V3 体检
- [ ] 充值"已记账不可直转终态"守卫（回退分录未实现前，拦住对已入暂扣充值的拒绝）｜卡片 task_16af8187 ｜来源: 2026-07-03 V4 体检
- [ ] **`DepositTransactionsController` 兄弟 admin 端点缺 `assertAdmin` 授权洞（PRE-EXISTING，早于 deposit-min）**：`AdminPermissionGuard.canActivate` 对非 ADMIN token 直接 `return true`（NO-OP），控制器需各 admin 路由自己调 `assertAdmin(req)` 才真拦。`GET /deposit-transactions`(findAll)、`GET /deposit-transactions/export`、`PATCH /deposit-transactions/:id/status`(updateStatus) 三个端点均缺此调用 → **今天客户 token 即可列出/导出全部客户的充值、乱推状态机**（越权读他人数据 + 篡改）。本轮仅修了新增的 `POST :id/waive-limit`（已加 assertAdmin）；这三个同源兄弟洞属既存债，需一次 DepositTransactionsController 全量硬化补齐（对齐 `withdraw-transactions.controller.ts` 每路由 assertAdmin 模式）｜来源: 2026-07-16 D5 review
- [ ] **同一洞第四个成员 + 已实测证据 + 已另开专修分支（2026-08-05 补）**：`deposit-transactions.controller.ts` 缺 `assertAdmin` 的完整清单是四条，不是三条——上一行漏记了 `GET /deposit-transactions/:id`（`findOne`，第 117 行；`GET /deposit-transactions`(`findAll`，第 110 行)/`PATCH /:id/status`(`updateStatus`，第 139 行)/`GET /export`(`export`，第 247 行) 同上一行）。**已在干净 `main` 上实测坐实**：新注册客户 token 打 `GET /deposit-transactions` 得 HTTP 200（应得 403）；对照有闸的 `POST :id/seize` 同 token 得 403 `"Admin only"`——证明问题确实是"这四条路由各自漏调 `assertAdmin(req)`"而非 guard 整体失效。业主已决定本轮（deposit-action-embed）不顺手修，本任务未触碰 `deposit-transactions.controller.ts` 的权限代码。⚠️ **2026-08-07 更新**：当时开的专修分支 `fix/deposit-transactions-authz` 已随 deposit-action-embed 一并清理（该分支零 commit、只是占位），本条**仍未修复**，重开时直接从当时的 main 拉新分支即可，复现步骤见上（新注册客户 token 打 `GET /deposit-transactions` 得 200） ｜来源: 2026-08-05 Task 7 验收前置排查


**原 BACKLOG §交付 / 可移植 Docker（2026-07-04 本会话新增）**

- [ ] **泄露 dev `.env` 仍在 git 历史**：`.env` 已 `git rm --cached`（合 c80ce5e）+ 本地换新 MFA key 作废旧值；旧值仍留在历史（用户选不重写历史，属 demo key）。若确认该 key 曾用于任何真实用途，需重评是否 filter-repo 抹历史 ｜来源: 2026-07-04 一级审计

- [2026-08-30] Task 4 权限组清理有 2 条路由按计划该退役，grep-before-delete 实测出活消费方，改判保留 ｜ `rbac.catalog.ts` ｜ Task 4 执行

  `POST /admin/control-gates/approvals/:id/cancel`（原判随 `GOV_APPROVAL_WRITE` 整组退役）：命中 `admin-web/src/pages/ApprovalDetailPage.tsx` 的 Cancel 决策按钮——与 approve/reject 走同一个 `submitDecision()` 流程、同一套弹窗，不是脚手架残留。保留路由，权限组从 `GOV_APPROVAL_WRITE` 改成 `GOV_APPROVAL_READ`（与 brief 原定给 approve/reject 的处理手法一致：裁决权已交还审批策略的 checkerRole 机制，RBAC 组只把关到"能看"这一层）。
  `POST /admin/tb/accounts`（原判 D8 随 `LEDGER_ACCOUNT_WRITE` 整组退役）：命中 `admin-web/src/pages/LedgerAccountList.tsx` 的完整 "Create Account" 表单（accountCategory/assetCode/code/customerNo）。路由与权限组均原样保留、未改动。
  两条均已排查确认无其他副作用（create/submit 两条兄弟路由确认零消费方、按计划照删）；完整证据链见 `.superpowers/sdd/task-4-report.md`。附带一提：本节 2026-07-16/2026-08-05 两条 `PATCH /deposit-transactions/:id/status` 缺 `assertAdmin` 的既存条目，因该路由本轮确认零消费方已整条删除，现已随之作废（未回改旧条目，本文件只许追加）。

## 幂等 · 去重 · 回放

## 并发与竞态

## 迁移与兼容

## 测试框架

**原 BACKLOG §演示/测试环境卫生（2026-08-13 A1-A6 收官实跑发现，均为既存问题非本轮引入）**

- [ ] **money-arcs 两个 e2e spec 会把 worktree 常驻栈的验收库搞脏**：`test/deposit-money-arcs.e2e-spec.ts` / `withdraw-money-arcs.e2e-spec.ts` 直接在 `MANUAL_CHECKING`/`FROZEN` 等态建 fixture 单**不跑 STEP_1**，随后走退回/上缴弧 post `DEPOSIT_SUSPENSE→CLIENT_ASSET`，把从未入账的科目扣成负数。实测跑完 4 个 e2e suite 后 `verify:coa` 报 5 处负余额（`CLIENT_ASSET` −118000 / 某客户 `DEPOSIT_SUSPENSE` −1e12 等），而**两条恒等式照常全绿**（两边同减正负相消）——正是本轮新增负余额断言首次逮到的实例。对照：`deposit-sumsub-verdicts.e2e-spec.ts` 有物理拦截、跑在专用 `e2e-` 库上。建议这两个 spec 同样切专用库 ｜来源: 2026-08-13 T11
- [ ] **`deposit-sumsub-verdicts.e2e-spec.ts` 把 DB 路径硬编码成一个早已删除的 worktree 目录**：`process.env.DATABASE_URL = 'file:/tmp/exchange_js_wt_deposit_arcs/e2e-deposit-verdicts.db'`（第 17 行）。任何新 worktree 首跑必挂 `Error code 14: Unable to open the database file`，且需要手动 `mkdir` + `migrate deploy` + `db:base:sync` + `db:biz:init` 才能起。隔离意图正确（防止误清常驻栈，第 22 行还有二道保险），但路径应改成按当前 worktree 派生 ｜来源: 2026-08-13 T11

**原 BACKLOG §技术债 — 充值状态机·计划1 引擎（deposit-sumsub，2026-07-28）**

- [ ] **payin→COMPLIANCE_PENDING 管道（STEP_1/funds_order 级联）无 e2e 覆盖**：Task 12 e2e 为避开 `detected()→funds_order→事件级联`（fire-and-forget `emit`，测试里会竞态），改为直接 Prisma 建一条 `status=COMPLIANCE_PENDING` 的 deposit + 手动调 `handleDepositStatusChanged()`，绕过了 PAYIN_PENDING→COMPLIANCE_PENDING 这段（payin 检测 + TB Step1 记账）。该段仍缺 e2e 直接覆盖 ｜来源: `test/deposit-sumsub-scenarios.e2e-spec.ts` 文件头注释 + task-13-brief

**原 BACKLOG §技术债 — 充值前端（F1-F8，2026-07-29 落地，Task 8 真机渲染验证发现）**

- [ ] **SEIZE 弧 e2e 场景 2 间歇性断言不到 `DEPOSIT_SEIZE_STARTED` 审计（既存 flaky race，与终审四修无关）**：`test/deposit-money-arcs.e2e-spec.ts` 场景 2 在两步审批（SENIOR_MANAGEMENT_OFFICER→MLRO）批准后用 `waitUntil()` 每 50ms 轮询 `finalStatusOf(deposit.id)===SEIZING`，一旦轮到即断言 `auditActionsFor(deposit.id)` 包含 `DEPOSIT_SEIZE_STARTED`；但 `deposit-workflow.service.ts → onSeizeApproved()` 里状态先经 `updateStatus(SEIZE)` 落库、审计 `recordSystem(DEPOSIT_SEIZE_STARTED)` 紧随其后才写，且触发链是 `approvalsService.approve()` 内 `emit()`（非 `emitAsync`）fire-and-forget 派发 `workflow.deposit-seize.decided` 事件——测试的 `await approve()` 返回时监听器可能仍在途，`waitUntil` 抓到状态已翻但审计尚未落库的窗口即断言失败。**已用 `git stash` 对照清本 HEAD 反复实测确认为既存问题**：干净 HEAD（无终审四修改动）5 次里失败 3 次，与本次 Fix 1-4 无因果关系（bisect 逐文件隔离复测同样验证过 Fix 1/2/3/4 单独套用均不改变该题的间歇性）。修法方向：`onSeizeApproved()` 改成先写审计再切状态（或同一事务内原子提交两者），或测试改用 `emitAsync`/直接 `await` 事件处理完成而非轮询状态字段 ｜来源: 2026-07-29 终审四修 task-9 验证阶段发现，e2e 反复跑触发（15/15 并非每次稳定，取决于该题命中与否）


**原 BACKLOG §技术债 — V5 提现**

- [ ] **e2e 无 teardown，专用库无限增长**：`test/kyt-verdict-landing.e2e-spec.ts` 不清理创建的行，跑在带 `e2e-` 前缀的专用库上（有 fail-closed 护栏，不污染常驻栈），fixture 用时间戳后缀不撞号，故非正确性风险，但库会随重跑增长 ｜来源: 2026-08-20 第一批终审

**原 BACKLOG §技术债 — 制裁命中分主体（sanction-subject-split，2026-08-20 落地）**

- [ ] **`test/customer-restrictions.e2e-spec.ts` 用例⑤有既有偶发 flake**：用例断言"贴 SANCTION 便签后三域在途单均被冻结"，紧跟 `waitUntil()` 确认兑换单 `status===FROZEN` 之后立即断言 `SWAP_FROZEN` 审计计数 `>0`——`markStatus(FREEZE)` 与写审计是两次独立 `await`，状态提交与审计落库之间存在时序窗口。已用 `git stash` 跑基线证实非本批引入 ｜来源: 2026-08-20 制裁分主体批次

**原 BACKLOG §技术债 — 第三批 SLA（三域，2026-08-21 落地）**

- [ ] **e2e 未覆盖的三格**：`test/sla.e2e-spec.ts`（三域共 7 例）未覆盖 `ACTION_PENDING`（充值/提现，7 天硬）、`PENDING_APPROVAL`（提现，1 天软）、`OPERATION_PENDING`（充值，1 天软）三个配置格——这三格的收口/破线逻辑目前只有单测覆盖（`deposit-transactions.service.spec.ts`/`withdraw-transactions.service.spec.ts` 等），未经真实 AppModule 端到端验证 ｜来源: 2026-08-21 SLA 批次

**原 BACKLOG §真欠账**

- [ ] **`client-web` 的 vitest 测试在 jest 闸门里零执行**：`client-web/src/utils/*StatusView.spec.ts`（deposit/withdraw/swap 三份）+ `restrictedCapabilities.spec.ts` 用 vitest 写；`jest.config.js` 的 `roots` 含 `client-web/src`、`testRegex` 也匹配 `.spec.ts`，于是 jest 会**捡起它们并当场失败**（`Vitest cannot be imported in a CommonJS module using require()`）——这正是常年挂在 jest 基线里那条红。真正跑它们的是根 `package.json` 的 `test:client`（`npm test --prefix client-web` → `vitest run`），**而那条命令不在任何闸门清单里**。修法二选一：把 `client-web/src` 从 jest `roots` 摘掉并把 `test:client` 加进闸门；或统一测试框架 ｜来源: 2026-08-22 第四批 D3/D4
- [ ] 🔴 **`test/swap-sumsub-scenarios.e2e-spec.ts` 整个 suite 常年 9/9 全红，此前全仓零登记**：成因是**第二批「制裁命中分主体」（2026-08-20）给兑换加了 `FROZEN` 态，e2e 的期望没跟着更新** —— 那批把 `REJECTED · Sanctions` 改判成 `FROZEN`（零出边终态），而这份 e2e 的 9 条用例仍按旧口径断言，典型失败形态是 `Expected: "REJECTED" / Received: "FROZEN"`。**既存破损，非第四批引入**：控制方已在 merge-base 的独立工作树、用同样的干净库复跑确认 **9/9 与分支上逐字相同**。⚠️ 它**不在全量 `npx jest` 的数字里**（`jest.config.js` 的 `roots` 不含 `test/`），只有 `npx jest --config test/jest-e2e.json` 才跑得到——所以两批都没人注意到。**修法**：按第二批的 `FROZEN` 终态口径逐条更新 9 条用例的期望（重点是 ④ Sanctions 那条与 sticky hard-line 那条），不是删测试。**一个没人记录的常年红 suite，是下次真回归被挥手放行的方式** ｜来源: 2026-08-22 终审 Minor #14
- [ ] **`admin-web` 零组件测试基建**：`jest.config.js` 的 `testRegex: '.*\\.spec\\.ts$'` 只匹配 `.spec.ts`，`.spec.tsx` **永不执行**。本批建过一个 `L1GateCard.spec.tsx`、发现跑不起来后删掉（`5e943691`），并把 `admin-web/tsconfig.app.json` 的 `exclude` 补上 `src/**/*.spec.tsx` 免得空跑 build 时报错。admin 前端组件目前只能靠渲染截图验证 ｜来源: 2026-08-22 第四批 B5
- [ ] **`jest.config.js` 的 `roots` 同样不含 `scripts/`——把 spec 建在 `scripts/` 下会被 `npx jest` 静默 0 匹配（"No tests found"，不是红也不是绿，就是不存在）**：与本节上一条 `test/` 目录同根因（第 91 行），只是换了目录。Task C1（造数花名册）实测撞上：任务书原定文件是 `scripts/demo-roster.spec.ts`，跑 `npx jest scripts/demo-roster.spec.ts` 得 `roots: .../src, .../admin-web/src, .../client-web/src - 564 matches` / `Pattern: scripts/demo-roster.spec.ts - 0 matches`。已绕过——spec 改放 `src/common/utils/demo-roster.spec.ts`（该目录本已收纳面向 demo 的确定性纯函数测试，如 `fake-external-refs.util.spec.ts`），import 反向指回 `scripts/demo-roster.ts`；未改 jest 配置。后续任何要给 `scripts/` 下文件写 spec 的任务会重复撞上同一个坑 ｜来源: 2026-08-29 Task C1

**Gate 0 / 退回弧**


**原 BACKLOG §对账应然设计 gap（2026-07-12 target design）**

- [ ] **`scripts/e2e-confiscation-async.ts` 的修复未实跑验证(2026-07-31 终审必修项 Important 3)**:该脚本是没收两阶段(CONFISCATING/CONFISCATED 两态各跑一次 `verify:coa`)唯一的活体 money-path 验收脚本。终审发现它 `waitFor(COMPLIANCE_PENDING+BELOW_MIN)` 后直接调 `initiateConfiscation`,但新前置是 `status===OPERATION_PENDING`,必抛 `Deposit has no BELOW_MIN hold to confiscate`。已修复(`makeBelowMinDeposit` 补一次 `ctx.depositWf.applyKytVerdict(..., {verdict:'approved'})` 把单驱到 `OPERATION_PENDING` 再没收,及配套断言标签)。**但本次未实跑**——脚本 bootstrap 一个真实 Nest app 跑真实记账(TigerBeetle post),而本 worktree `.env` 的 `DATABASE_URL` 指向的正是该 worktree**当前正被业主验收的常驻栈库**(`/tmp/exchange_js_wt_deposit_arcs/dev.db`),与本轮"不要动数据库"的硬约束冲突,故只改代码、未执行验证。需要:找一个隔离 DB+TigerBeetle 实例(或专用 e2e 库,参照上面 `deposit-sumsub-verdicts.e2e-spec.ts` 的物理护栏模式)把这个脚本真跑一次,确认 CONFISCATING/CONFISCATED 两态 `verify:coa` 仍 PASS ｜来源: 2026-07-31 终审必修项 Important 3
- [ ] **`admin-web` 的 `.spec.ts` 不在任何 tsc 闸门内**（`tsconfig.app.json` 的 `exclude` 含 `src/**/*.spec.ts`，后端两个 tsconfig 也照不到 admin-web），类型错只有 `npx jest` 跑到才暴露。本批新建的 `module-parity.spec.ts` 即受此影响 ｜来源: 2026-08-23 第五批

## 性能

## 其他

**原 BACKLOG §演示/测试环境卫生（2026-08-13 A1-A6 收官实跑发现，均为既存问题非本轮引入）**

- [ ] **4 个 e2e suite 共库串跑时 `withdrawNo` 唯一约束偶发冲突**：`--runInBand` 全量跑偶现 `Unique constraint failed on the fields: (withdrawNo)`（`withdraw-sumsub-scenarios` ③ PEP 用例），单跑该 suite 连续 2 次均通过。根因是 `generateReferenceNo('WD')` 只带 4 位随机、同日命名空间拥挤时撞车（`demo-lib.ts:401` 注释已知此事并对 demo 侧加了重试，测试侧没有）｜来源: 2026-08-13 T11


**原 BACKLOG §死码清理（Phase C 统一清扫）**

- [ ] 五公式旧对账链 provider 仍注册未删（BalanceRecon / MatchEngine / ClassifierService / InternalActionsService / LegProjection 等，模块注释自认 wallet-* 三件套才是 sole live path）｜来源: 2026-07-03 死码体检 ｜Phase C
- [ ] 证据包防御死分支：`complianceAlert / complianceIncident / journal / clearing / kytCase / travelRuleCase` 模型均不存在，audit-logs.service 仍带可选链查询（`?.findMany` 优雅降级不炸，但恒空）｜来源: 2026-07-03 死码清理（超清单范围未动）｜Phase C
- [ ] `reconciliation.constants.ts` 的 `L.TRADE_CLEARING` 常量（credit-net 旧引擎残留）｜来源: 2026-07-03 死码体检 ｜Phase C
- [已迁出 2026-08-28] ~~`/admin/pricing/policies*` 幽灵路由 + `CUSTOMER_RATE_READ/WRITE` 死权限组~~ → **判为业务缺口，移入 `BACKLOG.md`**（显示的内容错 / 该有的信息没有，非攻击-故障-并发触发）。原文见 git 历史 `649b4e88`
- [ ] **`deposit-workflow.service.ts` applyKytApproved 的 FROZEN 守卫成死码**：`applyKytApproved`（L525-548）内对 FROZEN 状态的检查与 `DEPOSIT_APPROVE_BLOCKED_FROZEN` 审计已于 2026-08-19 Task 1 中变为不可达——`decideVerdictLanding` 私有方法拦截所有抵达 FROZEN deposit 的 verdict 并返回 IGNORE，故该方法不再被 webhook 路径调用。⚠️ 同一常量 `DEPOSIT_APPROVE_BLOCKED_FROZEN` 仍在生产代码另处活跃（`approveDeposit` L940-975，admin 直接批准冻结单的路径），行为已由通用 `DEPOSIT_KYT_VERDICT_IGNORED`（`metadata` 含 `verdict`/`status`）替代、取证信息得以保留；仅 webhook 路径的守卫是死码 ｜来源: 2026-08-19 Task 1 审查 ｜Phase C


**原 BACKLOG §技术债 — V4 充值**

- [ ] Deposit/资金单层无 `txHash` 唯一约束（仅信号层 `dedupeKey` 有）→ 同 txHash 可能产生多 Deposit ｜来源: 2026-07-03 V4 体检
- [ ] TB 记账失败无 repair surface：仅记 `DEPOSIT_ACCOUNTING_BLOCKED` 审计后卡住 ｜来源: roadmap V4 待实现
- [ ] `deposit.status.changed` 用 `emit` 非 `emitAsync`，异常不传播到调用方 ｜来源: roadmap V4 待实现
- [ ] ERC-20 合约失败交易未过滤（合约执行失败仍建 Payin）｜来源: roadmap V4
- [ ] 区块重组自动回退未做（与"按链确认数配置"一起设计，该功能项在 roadmap V4 ADVANCED）｜来源: roadmap V4

**原 BACKLOG §技术债 — 充值状态机·计划1 引擎（deposit-sumsub，2026-07-28）**

- [ ] **`sumsub-txn-client.http.ts` 三处 minor**：① `resolveVerdict()` 在 `review.reviewResult` 和 `scoringResult.action` 都缺失时返回 `undefined`（无兜底/无告警，边缘场景）；② `submitTxn()` 的 counterparty 只设 `paymentMethod.accountId`，未设 `paymentMethod.type`（生产 crypto travelRule 场景需要补，当前沙盒未触发校验）；③ `deposit-kyt-verdict.handler.ts` 的 `SCENE_TAGS`/`DISPO_TAGS` 字面量集合与 `deposit-workflow.service.ts → applyKytVerdict()` 参数上手写的 `sceneTag`/`dispoTag` 联合类型两处手工同步，未共享一个类型/常量源 ｜来源: 2026-07-28 Task 13 code 走查
- [ ] **`prisma/schema.prisma` 新增字段列未对齐**：`DepositTransaction` 新增的 `sumsubFinanceTxnId`/`sumsubTravelRuleTxnId`/`manualReason`/`slaDeadline`/`slaBreached` 5 列缩进与同 model 其它列的列对齐格式不一致（`prisma format` 未跑），纯格式债 ｜来源: 2026-07-28 Task 13 code 走查
- [ ] **`scripts/stack-stop.sh` 孤儿进程清理相对/绝对路径不匹配，永不命中**：`cleanup_orphans_by_pattern "backend-orphan" "${APP_DIR}/dist/main"` 用绝对路径 pattern 做 `pgrep -f`，但 `stack-up.sh:114` 实际以相对路径 `["node","dist/main"]` 启动后端进程，命令行里不含 `${APP_DIR}` 前缀 → 该 orphan 清理分支永远 0 命中，无法杀残留 backend 进程。建议 `stack-up.sh` 改绝对路径启动，或 `stack-stop.sh` 的 pattern 改成只匹配 `dist/main`（相对）｜来源: 2026-07-28 Task 13 走查
- [ ] **must-fix-before-applicant-registration-go-live：trading-ready 闸已两路统一，上线前需回归验证**：终审 I1 发现 `applyKytVerdict()`（新 KYT-only approve 路径）直接调 `approveDeposit()`，绕过了 `checkAutoApproval()`（老 mock kyt-check/tr-check 路径）唯一的 trading-ready（法币提现地址）闸——客户没设法币提现地址也能经 KYT approve 通过充值，违背 2026-07-11 上线的"未 trading-ready 就 hold"不变量。本次已修：抽共享私有 helper `assertTradingReadyOrHold()`（`deposit-workflow.service.ts`），`checkAutoApproval()` 与 `applyKytApproved()` 都先过这道闸，不通过则原地 hold（不改状态）+ 记 `DEPOSIT_HELD_NOT_TRADING_READY` 审计，消除两路门禁漂移。**applicant-registration 正式接真实 Sumsub webhook 上线前，需对这条闸单独做一次回归验证**（未设法币提现地址的客户，真实 approve webhook 打过来时仍应被 hold 在 COMPLIANCE_PENDING，不应被放过）｜来源: 2026-07-28 终审 I1，已修，见 `deposit-workflow.service.spec.ts` "I1: approved but customer has no active fiat withdrawal address" 用例
- [ ] **`findBySumsubTxnId` 查询列缺 DB unique index**：`deposit-transactions.service.ts → findBySumsubTxnId()` 用 `OR[{sumsubFinanceTxnId},{sumsubTravelRuleTxnId}]` 做 `findFirst()` 按 Sumsub txnId 反查 deposit，业务上靠"Sumsub txnId 全局唯一"这一假设撑着，但 `prisma/schema.prisma` 里这两列只是普通可空 `String?`，DB 层无 unique 约束硬化——一旦假设被打破（重复值/竞态写入），`findFirst` 可能悄悄解析到错误的 deposit，webhook 状态机会被错误驱动。建议补唯一索引（两列各自 `@@unique`，注意都可空，SQLite/大多数 DB 唯一索引允许多行 NULL 共存，不影响未提交场景）｜来源: 2026-07-28 终审
- [ ] **充值动钱弧 start 阶段缺事务包裹**：`onReturnApproved`（返回弧）与没收的 `startConfiscation` 都把「建资金单 + TB pending 锁 + updateStatus」三步裸序执行，无 `prisma.$transaction`、无失败补偿——对比 `withdraw-workflow.service.ts → createWithdrawal()` 用 `$transaction` 包资金单/记录创建 + TB pending 调用，失败时在 catch 里对已落地的 TB pending 做 `voidPendingTransferBestEffort` 补偿。若 pending 锁在建单后抛错，会留下孤儿 CREATED 资金单，且 `@OnEvent` 监听器无重试队列、无自动自愈路径（`onReturnApproved` 的"pending transfer throws→rethrows"单测只验证了 deposit 状态未跳、STARTED 审计未记，未验证资金单是否已孤儿落地）。应开专门任务统一治理（同时覆盖退回与没收两条弧），避免单点偏离造成不一致；关联现有条目「CONFISCATING 结算耗尽重试后无手动重触发出口」（同一 start 阶段裸序问题的下游症状）｜来源: 2026-07-28 A3 Minor review
- [ ] **V1 审批 approve/reject 的 decided-cascade 并非同步完成，尽管代码全程 `await emitAsync(...)`**：`ApprovalsService.approve()/reject()` → `ApprovalEvents.APPROVED/REJECTED` → `ApprovalHandlerBase.handleApproved/handleRejected`（`@OnEvent({async:true})`）→ 内部再 `emitAsync` 出 `workflow.<kebab-workflowType>.decided` → 对应 workflow 的 `on*Decided()`——这是同一个 `EventEmitter2` 单例上的**嵌套/重入 `emitAsync` 调用**（外层 `governance.approval.approved` 的迭代仍在进行时，内层监听器又对同一实例发起第二次 `emitAsync`）。实测（`test/deposit-money-arcs.e2e-spec.ts` 场景 1/3/5 起初裸跑，`approve()` resolve 后立刻查 DB，deposit 状态/审计均未落地；加 2 秒 sleep 后再查，状态已正确落地）证实：外层调用方拿到的 `approve()` promise **不会**等到内层 cascade 真正跑完——虽然每一跳字面上都 `await ... emitAsync(...)`，实际是最终一致（毫秒到数百毫秒量级），不是真同步。影响面 = 所有走 `ApprovalHandlerBase` 的 V1 审批类型（不止充值四条弧，没收/角色变更/资产上下架等全共享同一基类+机制），任何"approve 完立刻读实体断言已生效"的代码/测试都可能撞见这个竞态。本任务测试文件已按此规律加 `waitUntil()` 轮询规避（未改产品代码），但框架本身这个"看似同步实则最终一致"的特性未被记录/未被验证是否符合业主对 admin UX 的预期（`initiateSeize`/审批本身另非本 bug 范畴）｜来源: 2026-07-28 Task A6 e2e 排障实测发现


**原 BACKLOG §技术债 — 充值单笔提交 + VARA TR 类型判定（deposit-sumsub，2026-07-31）**

- [ ] **合规待确认三项（切换开关前的硬前提，不确认不得启用）**：
  1. **规则双类型作用域**——Sumsub 制裁/AML/链上筛查类规则的 `types` 若只挂 `["finance"]`，`travelRule` 类型交易根本不进该规则；而 TR 交易按定义正是"crypto+对手方 VASP+金额≥阈值"的**最大额那批**，等于恰好在最大额交易上关闭筛查。需合规把相关规则作用域改为 `types:["finance","travelRule"]` 并确认。
  2. **聚合规则分桶**——`txns.finance` 与 `txns.travelRule` 是 Sumsub 侧独立聚合桶，速度/模式类规则（如"24 小时内累计金额"）若只挂 `finance` 桶，会漏算同一客户走 `travelRule` 类型的交易，产生聚合口径的筛查盲区。需合规确认聚合类规则是否需要同样双挂。
  3. **币种守卫**——判定器 `resolveKytTxnType()` 对 `TR_THRESHOLD_BY_CURRENCY`（代码常量，现仅 `USDT=1000`/`AED=3500`）未覆盖的币种兜底判 `finance` + `logger.warn`（静默降级，不卡单）；平台新增可交易币种时若未同步补阈值，该币种的 crypto 充值将**永远判 finance、永不触发 TR 筛查**，且只有服务端日志可见、无监控告警。需合规确认：①现有阈值表是否已覆盖当前全部可交易币种；②后续新增币种上架流程是否纳入"补 TR 阈值"检查项。
  ｜来源: 2026-07-31 spec §7/§9，业主口径"切换顺序：合规先改规则作用域并确认 → 我方再切提交逻辑"
- [ ] **真实 VASP 归属服务未接**：对手方是否为 VASP（`counterpartyIsVasp`）当前由客户端"模拟充值"弹窗人工录入（本质模拟 Sumsub `wallet-attribution` 归属服务），演示系统不接真服务——真实场景下这一判断应由链上地址归属分析自动得出，而非客户/运营手工勾选。真实接入待合规建好 VASP 主体后单独立项 ｜来源: 2026-07-31 spec §9「明确不做」
- [ ] **`SUMSUB_SINGLE_TXN_SUBMIT` 开关待合规确认后启用并最终删除**：该环境变量是代码落地与合规切换生效之间的过渡门（默认/未设=关闭，恒提交 `type='finance'`，退回旧筛查覆盖面）。待上方三项合规确认完成、开关翻 `true` 稳定运行一段时间后，应把开关判断从 `submitSumsubTxns()` 里整个删除（`resolveKytTxnType()` 判定结果直接生效，不再有"判定但不采用"这层间接），避免开关长期滞留成为死配置/认知负担 ｜来源: 2026-07-31 `deposit-workflow.service.ts → submitSumsubTxns()` 注释"确认后置为 true"


**原 BACKLOG §技术债 — 充值仿真裁决按钮 + 小额充值流程改造（deposit-sumsub，2026-07-31）**

- [ ] **`VERDICT_OF`（`demo-scenario.service.ts`）与 `VERDICT_BY_TYPE`（`deposit-kyt-verdict.handler.ts`）两份独立字面量表**：两处各自把 webhook `type` 映射到归一 `KytVerdict`，未共享同一常量源；已验证 `detail.verdict` 从不被 handler 读取（handler 自己从 `payload.type` 算裁决，不读 mock 塞进 `detail` 里的 `verdict` 字段），故当前两表不一致不会导致状态机走错，仅代码异味/未来维护风险（新增裁决类型时容易只改一处漏改另一处）｜来源: 2026-07-31 Task 4 final-review triage Minor①

**原 BACKLOG §技术债 — 充值前端（F1-F8，2026-07-29 落地，Task 8 真机渲染验证发现）**

- [ ] **FROZEN 态迟到 approved webhook 会刷闸门 + 覆写报文（新，2026-07-30）**：`writeBackGateStatus`/`saveTxnDetail` 只受 `KYT_VERDICT_TERMINAL_STATUSES` 早退保护，**FROZEN 不在该 Set**。一笔制裁/MLRO 冻结（FROZEN）单若收到迟到的 `applicantKytTxnApproved`，会先把 `financeStatus` 刷成 `PASSED`、再用 approved 报文覆写既有制裁证据（状态机本身仍 no-op 停在 FROZEN，不放行）——闸门展示值与报文证据在 FROZEN 期间可被覆写。`writeBackGateStatus` 的刷闸门是既有行为，报文覆写是乙口径的designed覆盖；但**决策 7（approved 也拉 getTxn）使这条路径新变得可达**。修法待议：把 FROZEN（乃至 SEIZING/RETURNING 等处置中态）纳入回写/存证的早退保护，或明确"冻结期间证据也冻结"｜来源: 2026-07-30 Sumsub 详情增强 Task 2 review
- [ ] **`parseDetail` 的 `typedTags.map` 仍缺 `.filter(Boolean)`（Minor，新，2026-07-30）**：`deposit-transactions.service.ts` 的 `parseDetail` 已对 `matchedRules`/`applicantActions` 数组 `.filter(Boolean)` 防 null 元素，但 `(d.typedTags ?? []).map(t => t.label)` 未同款设防——若报文 `typedTags` 含 null 元素会同源崩。一行补齐即可｜来源: 2026-07-30 Sumsub 详情增强 Task 4 re-review
- [ ] **`findOneForAdmin` 的 approvals 反查无分页（Minor，新，2026-07-30）**：`approvalsService.list({entityRef})` 走默认 `take`（20，上限 200），单笔 deposit 若有 >20 条审批会静默截断。单 deposit 罕见 >20 审批，可接受；如需彻底可显式传大 take 或分页｜来源: 2026-07-30 Sumsub 详情增强 Task 4 review
- [ ] **`getDepositStatusBadgeClass` 零调用方待清理（F3 遗留）**：`admin-web/src/utils/depositActionMap.ts` 的 `getDepositStatusBadgeClass`（+ 其背后的 `DEPOSIT_BADGE_MAP`）自 Task 3 把三处徽章渲染统一改到 `depositStatusMap.ts → getDepositStatusMeta` 后，在 `admin-web/src` 内已无任何 import 调用方（Task 2/3 报告均已 grep 确认），是可安全删除的死码，尚未清理 ｜来源: 2026-07-29 Task 2/3 报告标记

**原 BACKLOG §技术债 — V3 财务配置**

- [ ] TB 账户创建失败无 backlog 重试（仅转账凭证 `TbEvidenceBacklog` 有）｜来源: 2026-07-03 V3 体检
- [ ] `contractAddress` 字段 schema/DTO 残留（前端已移除）｜来源: 2026-07-03 V3 体检
- [ ] **Asset `min/maxDeposit/WithdrawAmount` 4 列待 drop**：单笔上下限已由 `transaction_limit_rules` SINGLE 行接管，资产表单 4 输入框已撤、schema 列现无人配无人读（弃用残留），留待未来迁移 drop ｜来源: 2026-07-16 transaction-limits
- [ ] 法币就绪查询 where-clause 三处重复（`WithdrawalAddressService.hasActiveFiatWithdrawalAddress`/`countActiveFiatAddresses` + `onboarding.service.ts` 内联 `assertTradingReady`）→ 未来抽 cycle-free 共享查询层 ｜来源: 2026-07-11 交易起始前置门 Task 2 质量审


**原 BACKLOG §技术债 — V5 提现**

- [ ] TB 记账失败 repair surface 偏薄：靠 `assertWithdrawSettled()` fail-closed 卡在 PAYOUT_PENDING 等人工，无专用修复 UI/端点；**费腿两种三级梯（FAILED 重建 / TB settle 瞬时故障）耗尽后同样无专用 repair 端点**，仅 `needsReview`+审计留痕，见 truth/v5-withdraw.md §5/§9 ｜来源: 2026-07-03 V5 体检 → 2026-08-04 Task 12 e2e 补充
- [ ] 在途提现守卫（deactivate 的 `ADDRESS_HAS_INFLIGHT_WITHDRAWAL`）靠 `toIban/toAddress` 字符串匹配，`Withdraw.tsx` 手输地址模式下会漏配（无 addressNo FK 关联提现与地址）→ 假阴性可绕过守卫；正解需给 WithdrawTransaction 加 addressNo/addressId FK ｜来源: 2026-07-11 Task 6 spec 审
- [ ] **旧 "L3: Post-Tx Archive" 命名与交易风控 L3 撞名**：`withdraw-workflow.service.ts → archivePostKyt()` 注释标 `// L3: Post-Tx Archive`；交易风控 spec（2026-07-12）把 **L3 定义为「行为监测」**，此 txHash 归档实为 L3 的数据上游（喂 Sumsub TM），落地时改名（如 "Post-Tx txHash 归档"），勿再叫 L3 ｜来源: 2026-07-12 交易风控三闸门 spec §1
- [ ] **`require_approval` 死枚举待清**：`WithdrawTransactionAction.REQUIRE_APPROVAL` 转移表零引用、代码零调用点（Task 1 状态机重写遗留），应删 ｜来源: 2026-08-04 Task 12 e2e 排查
- [ ] **真实 VASP 归因服务未接**：`counterpartyIsVasp` 由客户自己注册地址时的 `addressType==='VASP'` 自报，无外部 VASP 名录/归属服务校验真实性（与充值 §4.5 同一性质缺口，提现从已注册地址派生，非每笔手选）｜来源: 2026-08-04 Task 12 truth 核对
- [ ] **看门狗①「Sumsub 回执丢单重提」未做（deposit/withdraw 两域共有）**：spec §2 定义的两只看门狗之一——单笔交易提交 Sumsub KYT 后若 N 分钟内未收到 `applicantKytTxnCreated` 回执，视为丢单，需定时巡检扫描 + 告警重提（幂等）；两域目前均无此定时任务 ｜来源: 2026-08-04 Task 12 truth 核对
- [ ] **`generateReferenceNo()` 无碰撞重试，随交易量增长会真的撞号（deposit/withdraw/swap 三域共用，非提现独有）**：`src/common/utils/no-generator.util.ts → generateReferenceNo(prefix)` 只拼 `prefix + YYMMDD + 4位随机数`，10000 个槽位/天，`create()` 调用方（`FundsOrderService.create()` 等）拿到号直接插库，**不查重、不重试**，撞了就是 Prisma `P2002` 唯一约束异常直接抛出。本轮（2026-08-07 withdraw-action-embed Task 6）跑 `test/withdraw-sumsub-scenarios.e2e-spec.ts` 时**实测复现过一次**：`funds_orders` 表当天（同一 worktree 栈库，反复起停跑了一整天测试）已积攒 101 行 `FO2608%` 前缀记录，某次 `initiatePayoutPhase()` 内 `FundsOrderService.create()` 直接因 `fundsOrderNo` 唯一约束撞号而抛错，导致那一条 e2e 用例失败（重跑即通过——随机数换了）；生日悖论下 n=101/10000 槽位的碰撞概率已逼近四成，绝非罕见边界。修法：`create()` 撞 `P2002` 时重新生成号重试几次（同类模式已见于 `WithdrawApplicantActionsService.syncApplicantActions()` 的 `P2002` 捕获重读），或干脆把 4 位随机扩成更大值域/换成严格递增序列 ｜来源: 2026-08-07 withdraw-action-embed Task 6 e2e 实测复现
- [ ] **`withdraw-workflow.service.ts` 四处 FROZEN 死码（decideVerdictLanding 短路）**：`applyKytRejected`（L2642-2643）里 SANCTION/FROZEN_BY_MLRO 的 early-return + L2700-2710 里 REJECT_REFUND 的 FROZEN 守卫（写的 `WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED` 审计动作随之不可达）+ L2739-2741 里无 tag 分支的 FROZEN 守卫 + `applyKytAwaitUser`（L2536-2552）的 FROZEN 分支（见下条）。四处均因 `decideVerdictLanding` 私有方法拦截所有抵达 FROZEN withdraw 的 verdict 并返回 IGNORE，在 webhook 路径上不再可达——代码**未被删除**（有意保留，登记是为了留账）。顺带的一处文档漂移：`withdraw-workflow.service.ts:1899-1900` 的 `initiateRefund` 文档注释仍把 `WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED` 守卫当作活的执行路径来引用，清理死码时应一并更新 ｜来源: 2026-08-19 第一批 Task 2 审查 ｜Phase C
- [ ] **去重比对只跟「最新一条」比**：`sumsub-ingestion.service.ts` 的去重用 `findFirst({ where: { eventType, applicantId, status: 'PROCESSED' }, orderBy: { createdAt: 'desc' } })`——只跟同 `(type, applicantId)` 的**最近一条**比键。改前 KYT 事件键恒相同故看不出；本批给键补了 `kytTxnId` 之后，若两笔交易的同类型裁决交错到达，前一笔的真重投会因「最近一条是后一笔」而逃过去重、被重新派发。爆炸半径有限（handler 都有「已在目标态」守卫、终态单现判 IGNORE），后果主要是多一条 IGNORED 审计。彻底修法需按 key 查（要加列或索引），超出本批「不动 schema」硬约束 ｜来源: 2026-08-20 第一批终审
- [ ] **无 tag 的 rejected 落到已是 `MANUAL_CHECKING` 的单子仍是「先写证据后 return」**：与本次 Fix 1 修的 onHold 格子同族，但**有意不修**——该情形下 verdict 类型未变（rejected → rejected），属于「同类型裁决刷新分数与报文」而非「异类型覆盖」，刷新是合理行为而非证据破坏。若日后判断连刷新也不该发生，修法与 Fix 1 同款（在 `decideVerdictLanding` 加一格）｜来源: 2026-08-20 第一批终审，控制方裁定接受


**原 BACKLOG §技术债 — V6 兑换**

- [ ] **FAILED/REVERSED 死枚举**：`SwapTransactionStatus` 定义 FAILED/REVERSED 但全代码无 `markStatus` 设置（只调 SUCCESS）→ 不可达；控制器只有 advance/resume，**无 reverse 端点**（roadmap 曾标 ✅2026-06-26 整笔冲正实为过度声明）。需求要么补 reverse+FAILED 状态机，要么删死枚举 ｜来源: 2026-07-04 V6 体检
- [ ] Sumsub TM 真实集成未做（大额兑换合规）｜来源: 2026-07-04 V6 体检
- [ ] TB 记账失败无专用 repair surface（仅 resume 重试，无修复 UI/端点）｜来源: 2026-07-04 V6 体检
- [ ] 架构命名漂移：roadmap 写"SwapSettlementService"该类不存在，实为 SwapWorkflowService+SwapLegAccounting+SwapTransactionsService（文档订正即可，非代码债）｜来源: 2026-07-04 V6 体检
- [ ] **兑换 KYT 真接前必测**：规则自动裁决（无 officer 介入）是否自动发 applicantKytTxnApproved/Rejected webhook ——
      充值实测矩阵该格为空；不发则每笔兑换走超时死｜来源: 2026-08-13 兑换合规 spec §12

**原 BACKLOG §技术债 — V8 对账**

- [ ] **Reimbursement 三处残留未清**（表已 drop）：`schema.prisma` `reconciliation_case.reimbursementObligationId` 孤立外键列 + `reset-business-data.ts:45` 引用 + `permissions.ts:110` `REIMBURSEMENT_OBLIGATIONS_READ` 孤儿权限（53f711c 清死权限时漏网）｜来源: 2026-07-04 V8 体检
- [ ] **FIRM Treasury snapshot 历史残留**：旧 Run 历史数据余额标记行误入交易下钻（Phase B 后新 run 不产生，历史数据未清）｜来源: 2026-07-04 V8 体检（Round3 遗留）
- [ ] **`formatAmount(raw, decimals)` 三处重复**：`ReconciliationCasesDetailPage.tsx` + `ReconciliationRunsDetailPage.tsx` 各有一份 bigint-safe 版（字符串插点），`ReconciliationExternalBalancesPage.tsx` 另有一个 `fmtAmount` float 版（`Number()/10^d`，大额/6 位币种有精度风险）。应抽到共享 util、统一到 bigint-safe 版并三处引用｜来源: 2026-07-04 canon2 T4 Minor
- [ ] **金额精度断言（`.toFixed(0)` 元→分取整）跨 matcher + receipt-lookup 横切**：`wallet-flow-matcher.service.ts` `toMinor` 与 `receipt-lookup.service.ts` `orderMinor` 都用 `Prisma.Decimal.mul(10^decimals).toFixed(0)` 把 funds_order 元→分，靠 `.toFixed(0)` 舍入。两处口径必须始终一致（否则同一单在途认领与推单回执会错配）；元→分整层迁移后此横切消失。当前无守卫两处不漂移的测试｜来源: 2026-07-04 canon2 T3 M2
- [ ] **`receipt-lookup.service.ts:77` `extMinor` 的 `String(a)` 死兜底分支**：`l.amount` 恒为 Prisma.Decimal（有 `.toFixed`），三元 `a?.toFixed ? a.toFixed(0) : String(a)` 的 else 永不命中。可删掉与匹配器 `extMinor = BigInt(d.toFixed(0))` 对齐（T3 M1）｜来源: 2026-07-04 canon2 T3 双审

**原 BACKLOG §技术债 — V1 审计底座**

- [ ] **audit-retention-job.ts 死脚本**：`scripts/audit-retention-job.ts:33-45` 仍 select/access 已删列 `module`/`triggerType`，脚本会坏/返 undefined｜来源: 2026-07-04 V1 体检
- [ ] traceId 共享待核：首登 `ADMIN_LOGIN_SUCCESS`(authTraceId) 与 `MFA_LOGIN_VERIFIED`(loginTraceId) 是否共享同一 traceId 存疑（roadmap 称共享，agent 存疑）｜来源: 2026-07-04 V1 体检。⚠️ 2026-08-25 补注：这两个码本身已随本批退役（不再进 V1 域，业主裁定归③安全日志，见设计稿 §12.2/§12.3），`不变量③`（Task 11 `verify:audit`）确认零新写入；该疑问随之失去 V1 域内的验证场景，是否需要在③建设时重新提出留给运维批次判断


**原 BACKLOG §技术债 — 审计日志重构 · 第一批之后仍欠的账（2026-08-25）**

- [ ] **`workflowType` 物理删列**：本批唯一的过渡层例外——V1 域已停止依赖该列语义，但列本身保留，因为交易域仍有 63 处写入点在传该字段；删列排在交易域批次一并做｜设计稿 §4.3、§16
- [ ] **`seq` 与哈希链（`prevHash`/`selfHash`）的校验工具**：列本批（Task 1）已建、主表也在写，但没有校验脚本核实链条完整性，第三批再补｜设计稿 §16
- [ ] **`legalHold` 的触发与解除运维流程**：列本批已建（`Boolean @default(false)`），但触发/解除的操作流程与权限门未定义，第三批再补｜设计稿 §16
- [ ] **回放对账 / 覆盖率闸门**：验证"打点是否漏记"的自动化机制，业主裁定本期不做，方法已留档｜设计稿 §11、§16
- [ ] **`AUDIT_LOG_QUERIED` 的查询规模分级**：目前不分规模无差别记录每次查询（含无过滤的大范围查询），后续按查询规模/敏感度分级是否需要单独打点尚待设计｜设计稿 §12.1、§16
- [ ] **Task 5 未经独立复审**：该任务实现者在复审派单前被 API 中断，其 diff 未走过 task-reviewer 关。分支终审须补覆盖这一段 ｜来源: 2026-08-26 台账核对


**原 BACKLOG §技术债 — 制裁命中分主体（sanction-subject-split，2026-08-20 落地）**

- [ ] **兑换 `FROZEN` 幂等闸让制裁处置不可重入，与 `REJECTED` carve-out 不对称**：`REJECTED`/`SUCCESS` 终态有 carve-out 允许 webhook 重投时重跑 `handleRejectDisposition()`（"单已终态≠处置已落地"）；`FROZEN` 没有——已冻结的单再收裁决在 `applyKytVerdict()` 顶部就被幂等闸拦下（写 `SWAP_KYT_VERDICT_IGNORED`），到不了处置逻辑。本批裁定**不改**：改它会偏离第一批（合规裁决落地）立的跨域幂等契约；且冻单排在冻人之后，能走到 `FROZEN` 就意味着人已经被限制，不存在"单冻了、处置没跟上"的风险窗口。**补充（2026-08-20 终审）**：上面"能走到 FROZEN 就意味着人已经被限制"这条论断只对**限制**成立，不覆盖 `markHardLineDisposition` 这个 sticky 标记——若客户是在**别的域**（如充值）命中 `SANCTION_APPLICANT` 触发跨域广播冻单，本单在收到自己的裁决前就已被那次广播冻成 `FROZEN`，随后自己到达的裁决撞上这道幂等闸提前 return，`handleRejectDisposition()`（连同其内的 sticky 章）从未跑到；MLRO 解除限制后，该客户下一笔软线兑换拒绝重新算出 `alreadyHardLined=false`，补料请求重新暴露 ｜来源: 2026-08-20 制裁分主体批次
- [ ] **`scripts/backfill-internal-fund-keys.ts` 是死码**：引用已 DROP 的 `internalFund` 表（`prisma.internalFund.findMany/update`），且硬编码了已废弃的 `/tmp/exchange_js_branch` 路径。因此 `tsconfig.test.json` 刻意不含 `scripts/`，避免这份死码把"改了跨 src/test 边界类型后做一次全覆盖检查"这道闸拖成非二元结果 ｜来源: 2026-08-20 制裁分主体批次
- ~~**兑换域缺 `SANCTION_COUNTERPARTY` 的 e2e 覆盖**~~ —— **已删除（2026-08-20 终审收口，业主裁定）**：兑换是平台内 crypto↔fiat 余额交换，没有第三方对手方，Sumsub 不可能对一笔 swap 回传"对手方被制裁"，这个场景本身不存在——测不了也不该测。原条目登记的补测任务连同其依据的 demo fixture 按钮 `V4B_REJECTED_SANCTION_COUNTERPARTY` 已随本次收口一并物理删除（`hasApplicantSanctionHit()` 只认 `SANCTION_APPLICANT` 保留为防御性写法，不代表该分支被期待触达）；`SANCTION_COUNTERPARTY` 在充值/提现两域仍有真实外部对手方场景，覆盖不受影响 ｜来源: 2026-08-20 制裁分主体批次登记 → 同日终审收口判定为不适用、删除
- [ ] **双裁决毫秒级并发可开出两张同因由便签**：两笔不同订单（如同一客户的一笔充值 + 一笔提现）的 KYT rejected webhook 若在毫秒级窗口内并发到达，各自独立调用 `CustomerRestrictionsService.open({cause:'SANCTION'})`，`openWithin()` 的"查重复→插入"不是跨请求原子的，理论上可能各自查到"无重复"后都插入，开出两张同因由的 OPEN 便签。窗口极窄、后果轻（MLRO 需要多签一次撕两张而非一张）；要根治需要加客户级锁，成本收益不划算，暂不做 ｜来源: 2026-08-20 制裁分主体批次
- 🟡 **`scripts/reset-business-data.ts` 的删除清单缺 `materialRequest`** —— 该表对 `CustomerMain` 有必填 FK，库里若有历史材料请求行，`npm run db:biz:reset` 会撞 FK 违例中止。本批在 worktree 栈重铺时实际撞上，手工清阻塞数据后才跑通（未改该脚本，非本批范围）｜来源: 2026-08-20 制裁分主体批次 Task 12 重铺实测
- 🟡 **`scripts/verify-demo-data.ts` 的 `scanR1()` 引用已 DROP 的 `internalFund` 表**（`:47` `prisma.internalFund.findMany()`）—— `schema.prisma` 里只剩 `InternalFundAuditLog`，`InternalFund` 模型已在 funds_orders 重构中删除。后果：`npm run db:seed:business` 末尾内建的 `verify:demo-data` 校验步骤**必炸**（业务数据本身在此之前已成功落库，不影响 seed 结果，但开发者会看到一次失败）。与本节 `backfill-internal-fund-keys.ts` 那条同根因、不同文件｜来源: 2026-08-20 制裁分主体批次 Task 12 重铺实测
- ~~**【需业主裁定】`SANCTION_COUNTERPARTY` 在兑换 vs 充值/提现的客户面结果相反**~~ —— **已关闭（2026-08-20 终审收口，业主裁定：该场景不存在）**：终审提这条时的前提是"兑换域会收到 `SANCTION_COUNTERPARTY`"，而业主指出**兑换是平台内 crypto↔fiat 余额交换、没有第三方对手方**（truth `v6-swap.md` §概述/§L1 两处早有成文表述："无第三方对手方"，那正是兑换不做 Travel Rule、不做大额审批门的原因）。Sumsub 不可能对一笔 swap 回传"对手方被制裁"，所以"兑换披露 vs 充值提现静默"这个跨域不一致**不会发生**。铸出该形状的 demo fixture `V4B_REJECTED_SANCTION_COUNTERPARTY`（兑换域那份）已随收口物理删除；`hasApplicantSanctionHit()` 只认 `SANCTION_APPLICANT` 保留为防御性写法。充值/提现两域有真实外部对手方，其 `SANCTION_COUNTERPARTY` 行为不受影响 ｜来源: 2026-08-20 制裁分主体批次终审登记 → 同日业主裁定关闭
- ~~**【小】兑换域的 `SANCTION_COUNTERPARTY` 审计与普通软线拒绝同形**~~ —— **已关闭（2026-08-20 终审收口，业主裁定：该场景不存在）**：与上一条同根因、同依据 —— 兑换域无第三方对手方，`SANCTION_COUNTERPARTY` 不会到达该域，故不存在"审计分不出对手方制裁命中"的问题。充值/提现两域已把 `sceneTag` 标签名写进各自审计文案，覆盖充分 ｜来源: 2026-08-20 制裁分主体批次终审登记 → 同日业主裁定关闭



**原 BACKLOG §技术债 — 第三批 SLA（三域，2026-08-21 落地）**

- [ ] **`markSlaBreached()` 无条件写、不校验 `slaBreached` 仍为 `false`——结论：现状正确，多实例部署时再回来看**：三域的 `markSlaBreached(id)` 都是裸 `update({data:{slaBreached:true}})`，没有 `where: {slaBreached: false}` 这层条件写保护。单实例 cron 下不可达：`findSlaBreachCandidates()` 的 `where` 里已经带了 `slaBreached: false`，能被扫到的单必然还没被标过。加条件写属于对"将来可能多实例部署、两个 cron 同时扫到同一单"的投机加固（YAGNI），且真到那天该修的是加分布式锁而不是这一行。**这不是待办**——真上多实例部署时回来看这条 ｜来源: 2026-08-21 SLA 批次
- [ ] **硬破线的 `provider re-review` 理由现在永不可达 + 提现侧写死另一条理由（`actionSubmittedAt` 死列的下游后果）**：`deposit-sla.service.ts:96` 按 `deposit.actionSubmittedAt` 在两条 reason 之间选（交了→`'SLA breached: provider re-review exceeded deadline after customer submission'`／没交→`'SLA breached: no compliance action before deadline'`，metadata 的 `waitingOn` 跟着分 `PROVIDER`/`CUSTOMER`），但全仓再无任何地方把 `actionSubmittedAt` 写成非 null（`grep "actionSubmittedAt:" src/ | grep -v null` 零命中，2026-08-17 材料请求账迁移 `20260817020000_drop_legacy_action_stores` 之后的遗留；列本身仍在 `prisma/schema.prisma:1070`/`:1319`，见 truth/v4-deposit.md §4.6 订正段与本文件既有的「充值/提现域"全部交齐"缓存……已是死列」条），所以 `provider re-review` 那条分支**永远走不到**。`withdraw-sla.service.ts:98` 则直接写死了"未在期限内响应"这一条、连分支都没有——因为 `submitted` 恒为 `false`，**两域当前运行时输出其实完全一致**，不存在活的分歧；但一旦哪天 `actionSubmittedAt` 恢复写入（或改读材料账），同一个问题就会有两个答案：一个已配合交了材料的客户在提现侧仍会被以"未响应"的名义记进永久审计，充值侧不会。修这条死列时两域要一起改 ｜来源: 2026-08-21 SLA 批次

**原 BACKLOG §真欠账**

- [ ] **`clearLimitHold` 失败时单子仍会 `RETURNING`→`RETURNED` 且对客户永久不可见**：`onReturnApproved()` 里 `updateStatus(RETURN)` 与 `clearAdministrativeHoldOnReturn()` 是**两个没有事务包着的写**，且刻意「先翻后清」（理由见 `truth/v4-deposit.md` §4.8：先清后翻会新增一个「本该藏着的挂起单被永久曝光」的失败模式）。代价是 clear 失败时残局 = 修复前的既有行为——钱退回去了，客户面零记录。正解是把两个写包进同一个事务 ｜来源: 2026-08-22 第四批 C1 复审
- [ ] **`DepositTransactionsService.clearNeedsReview()` 零生产调用方**：`markNeedsReview()` 有六处调用（三条处置弧 × 正常耗尽 + catch 崩溃），`clearNeedsReview()` 全仓 grep **只有单测在调**——充值的红标一旦立起来就没有任何代码路径能放下（提现域有：`onLegCleared` 在 SUCCESS 结算时清）。运营手工处置完那笔腿之后，列表上那面旗会一直挂着 ｜来源: 2026-08-22 第四批 A2/E1
- [ ] **`DEPOSIT_CONFISCATION_LEG_FAILED` 成死常量**：`audit-actions.constant.ts:275` 仍在，但随 A3 退役 `confiscate_failed` 边后**已无写入方**（新的两条是 `DEPOSIT_CONFISCATION_RETRIED`/`DEPOSIT_CONFISCATION_STUCK`）。本批不做审计专项，交由那一轮统一清 ｜来源: 2026-08-22 第四批 A3

**L1 闸门本身**

- [ ] **九项里只有三项是 `L1GateService` 亲自执行的，其余六项靠 `preChecks` 传入**：`CUSTOMER_ELIGIBILITY`/`CUSTOMER_RESTRICTION`/`tradingTier` 三项自判（且有 `SELF_OWNED_CHECKS` 保护不被 `preChecks` 覆盖），单笔/累计/大额/账户/余额/报价/起始就绪七项住在各域自己的守卫里。**若将来要真正"统一执行"**，需要重写各域守卫、并改错误码契约（现在各域抛的是自己的 `TRANSACTION_LIMIT_REJECTED`/`WITHDRAWAL_ADDRESS_NOT_REGISTERED`/`RECEIVING_ACCOUNT_REQUIRED` 等，统一执行后要么全变成 `L1_GATE_BLOCKED`（丢失可诊断性）、要么求值器得回传结构化错误码）。本批刻意不重写能跑的代码 ｜来源: 2026-08-22 第四批 B1
- [ ] **`holdReasonOf()` 的 `SINGLE_LIMIT → 'BELOW_MIN'` 与 `default → first.code` 两条分支无测试覆盖**：`l1-gate.service.spec.ts` 覆盖了 `LIFECYCLE_NOT_ACTIVE`/`CAPABILITY_RESTRICTED` 两条（以及九格 NA/SKIPPED 表逐格、`SELF_OWNED_CHECKS` 两条防覆盖），但没有一条用例让 `SINGLE_LIMIT` 或其余六格成为 `failed[0]`。⚠️ **2026-08-22 终审订正**：本条此前把后果写成「静默产生一类永久对客户不可见的单」——**登记过头了，DEPOSIT 域不可达**。该域能 `FAIL` 的只有 `CUSTOMER_ELIGIBILITY`/`CUSTOMER_RESTRICTION`/`SINGLE_LIMIT` 三格，三格都有显式 `case` 分支，`default` 走不进去。真正欠的只是这两条分支没测试，别去追那个幻影 ｜来源: 2026-08-22 第四批 E1（后果表述于同日终审订正）

**兑换域**

- [ ] 🔴 **兑换建单余额校验不锁额，并发下仍会卡死 `PROCESSING`**：`swap-workflow.service.ts` 的建单前余额校验（第四批新补）读 `getCustomerAvailableBalance` 比一下就完了，**不像提现那样在建单时压 TB pending 锁额**（`available = creditsPosted − debitsPosted − debitsPending`，而兑换要等 KYT 通过建腿才写 pending）。失败剧本：客户 100 USDT，提交兑换 A 用 60 → 校验通过 → `COMPLIANCE_PENDING`；A 裁决未回，再提交 B 用 60 → **校验又通过**（仍读到 100，什么都没锁）；两笔都 `kyt_approved` → `PROCESSING`；A 的腿抽干余额，B 的第一条腿失败，而 `PROCESSING` 唯一出边是 `success→SUCCESS` → **B 永久卡在 `PROCESSING` + `needsReview`**，正是这道校验想防的那个洞。**这是残留不是回归**——第四批严格改善了单笔场景。**真正的修法**：建单即压 TB pending、与提现同形状（建单事务内对卖出侧起 pending transfer，KYT 通过时 post、拒绝/SLA 破线时 void）。已同步订正 `truth/v6-swap.md` §3.9 与代码注释里「堵住」那句过头的措辞 ｜来源: 2026-08-22 终审 Important I2
- [ ] **`FAILED` / `REVERSED` 两个不可达死枚举未删**：转移表零入边、全仓无 `markStatus` 写入方、无 reverse 端点；只作为「排除项」出现在三处集合里（`SWAP_TERMINAL_STATUSES`、`swap-workflow` 终态集、累计额度用量排除列表）。本批新建的 `admin-web/src/utils/swapStatusMap.ts` 也为它们保留了条目（若复活，fallback 会渲染成 WARNING 黄误导运营）。**与上方「技术债 — V6 兑换」节的同名条是同一件事**，此处只记「第四批仍未删」｜来源: 2026-08-22 第四批 D1
- [ ] **`admin-web/src/components/L1GateCard.tsx` 头部注释已过期**：注释写「与页面上既有的 `L1 · Eligibility` 格子是两回事：那个读的是客户级 `complianceStatus`」——同一批次后面的 commit（`339195e4`）已把三域那一格改读 `customer.lifecycle`（`complianceStatus` 是被 drop 的列）。注释里的列名是死的，一行字的事 ｜来源: 2026-08-22 第四批 E1 自查

**记账**


**原 BACKLOG §待决策（等业主拍板）**

- [已迁出 2026-08-28] ~~InternalFundAuditLog 有读无写 → 资金单详情页审计列表永远空~~ → **判为业务缺口，移入 `BACKLOG.md`**（显示的内容错 / 该有的信息没有，非攻击-故障-并发触发）。原文见 git 历史 `649b4e88`

**原 BACKLOG §文档漂移（随 roadmap 全量重排处理）**

- [ ] `frontend-admin.md` AuditLog sidebar 字段表仍列 `triggerType` 幽灵字段（后端已删该列）｜来源: 2026-07-03 体检 ｜已生成卡片 task_6d29bd5c

**原 BACKLOG §交付 / 可移植 Docker（2026-07-04 本会话新增）**

- [ ] **launch.json 治理（待决策）**：`.claude/launch.json` 全机器专属绝对路径 + 预览工具自动重生成 stale 配置（settle-opt/claude-admin 反复回填）；已经 `.gitattributes` export-ignore 不进交付包，但仍被 git 跟踪。待决策：gitignore 停止跟踪、交预览工具本地生成 ｜来源: 2026-07-04 可移植 Docker
- [ ] **Docker `tb-format` 非幂等**：重跑演示需先 `docker compose down -v` 清账本端数据卷（否则 format 撞已存在文件报错）；可给 format 加 if-missing 守卫做到重跑免 down -v ｜来源: 2026-07-04 Docker 交付
- [ ] **Docker Desktop Mac 4.42+ io_uring 风险留账**：新版 Mac 版可能 VM 级封 io_uring，`seccomp=unconfined` 也救不回 → 退 OrbStack（已写进 `READ-ME-FIRST.md`，此处备查）｜来源: 2026-07-04 Docker 交付

**原 BACKLOG §账本流水（2026-07-10 本会话新增）**

- [ ] **提现 eventCode 去阶段化（向 swap 看齐）**：提现两步腿现发 `WITHDRAW_LOCK_NET` → `WITHDRAW_NET_POST`（`tb-evidence.service.ts → enrichForPost()` 落账时把 eventCode 从 LOCK 改成 POST），把阶段塞进了 event 名。目标口径（账本 PRD 附录 B 已采用）＝**一笔分录一个稳定 event、阶段交给 `transferType`（PENDING/POSTED/VOIDED）**，如 swap 的 `SWAP_SELL_CLIENT` 全程不变。落地＝提现净额/费腿 eventCode 合并为 `WITHDRAW_NET` / `WITHDRAW_FEE`（去掉 LOCK/POST/VOID 后缀），`enrichForPost` 不再改 eventCode。deposit/swap 已是干净模型、无需改。业主 2026-07-12 定（甲：PRD 写应然、代码待对齐）｜来源: 2026-07-12 账本 PRD 附录 B（对应模块 8 · G2）


**原 BACKLOG §对账应然设计 gap（2026-07-12 target design）**

- [ ] **恒等校验未左移**：仅日 run 预门 + 手动 `verify:coa` 脚本；应 CI / 每次记账后断言镜像恒等，从源头拦（日 run 是最后一道网、非唯一）｜来源: spec §1.3
- [ ] 恒等左移落点（CI 断言 / 每次记账后同步断言 / 高频轻量 cron）｜来源: spec §10

**对账 PRD 重写范围决策（2026-07-12 业主拍板，doc WOaEds8s）**

> 本期对账聚焦「正常业务会出现的问题」＝时间差（在途）：检测 + 自愈 + 同步腿推单。所有"异常/真差异"侧本期不做。以下为据此决策产生的 defer / 代码改名账。

- [已迁出 2026-08-28] ~~五桶命名 SOFT_FLAG→COMPENSATING 代码改名~~ → **判为业务缺口，移入 `BACKLOG.md`**（显示的内容错 / 该有的信息没有，非攻击-故障-并发触发）。原文见 git 历史 `649b4e88`
- [ ] **Run 结果字段枚举待重命名**：`reconciliation_runs.invariantStatus`（PASS/FAIL）语义像生命周期状态、且外部 break 也写 FAIL（与"内部恒等"名不符）；PRD 拟结论字段用 `RECONCILED / EXCEPTIONS_FOUND`（对平 / 有差异）。代码字段名+值待随之调（与 `status` RUNNING/COMPLETED/FAILED 两轴分清）｜来源: 2026-07-12 PRD 重写 Q5
- [ ] **`SUMSUB_SINGLE_TXN_SUBMIT` 开关翻开前置清单(2026-07-31)**:该开关默认 `false`(恒报 `finance`)**——但 `SUMSUB_MOCK_MODE=true` 时隐含开启**(2026-07-31 修:该阀门守的是真实租户规则作用域的筛查真空,mock 下没有真实规则引擎、风险结构性不存在;此前它把演示/Docker 交付一并锁死,验收实测 3000 USDT+VASP 恒落 `finance`,判定器全程等于死码)。下方前置清单只约束**真实 Sumsub** 环境翻 `true`,须依次满足:①**合规书面确认** Sumsub 筛查规则作用域已含 `types:["finance","travelRule"]`——否则 travelRule 单不进规则=筛查真空,而 TR 单按定义正是「≥阈值+对手方 VASP」的最大额那批;②补一条 `SUMSUB_SINGLE_TXN_SUBMIT=true` + 超阈值的 e2e(当前 S2 场景金额 10.5 USDT 远低于 1000,travelRule 提交链路从未在真实 ingestion 里跑过);③翻开后删除该开关与 `finance` 强制分支 ｜来源: 2026-07-31 单笔提交改造终审
- [ ] **`scripts/**` 不在 tsc 覆盖范围(防复发闸,2026-07-31)**:`tsconfig.json` 的 include 只有 `src/**/*`,且 `DemoCtx.depositWf` 声明为 `any` —— 双层盲区,导致本轮删方法后 `scripts/demo-lib.ts` 的残留调用直到终审才被发现(`demo:all` 运行时必炸,而 Docker 启动脚本就跑它)。建议:把 `scripts/**` 纳入一个单独的 `tsc --noEmit` 检查,并把 `DemoCtx` 的 `any` 换成真类型 ｜来源: 2026-07-31 终审 Recommendation 2
- [ ] **判定器对 NaN 金额 fail-open 到 travelRule(Minor,2026-07-31)**:`kyt-txn-type.resolver.ts` 的 `amount < threshold` 对 `NaN` 恒 false → 落 `travelRule`。上游是 `Number(Prisma Decimal)` 实际拿不到 NaN,但开关翻开后这是个隐含的 fail-open 方向。加一行 `if (!Number.isFinite(input.amount))` 显式兜底 ｜来源: 2026-07-31 终审 Minor 6
- [ ] **signal dedupe 命中时静默丢弃 `counterpartyIsVasp`(Minor,2026-07-31)**:`inbound-transfer-signals.service.ts` dedupe 命中直接 `return existing`,新提交的 `counterpartyIsVasp` 被丢。这是既有 dedupe 语义,但现在被丢的字段喂的是监管判定 —— 同 txHash 重提改对手方类型不会生效 ｜来源: 2026-07-31 终审 Minor 7
- [ ] **两处注释过时/字面矛盾(Minor,2026-07-31)**:`deposit-workflow.service.ts:364` 仍称 `checkAutoApproval` 为「老 kyt/tr mock 路径」(该路径本轮已退役,现为 `waiveLimitHold` 的事后重评入口);`:356` 注释「仅供 L2 显示,不作决策依据」与 `:623` 读该列做判断字面打架(实质无冲突:一个是 webhook 同步路径、一个是豁免后异步重评,但缺例外说明,易被误判为违规而"修坏")｜来源: 2026-07-31 终审 Minor 4/5

- [ ] **状态机收窄后 `OPERATION_PENDING` 收到迟到制裁裁决会抛(2026-08-02)**：`OPERATION_PENDING` 转移表收窄回仅 `approve`/`confiscate_start` 两条出边后，below-min 挂起单若在等运营处置期间收到迟到的 Sumsub `rejected`/`awaitUser` 裁决 webhook（`applyKytRejected`/`applyKytAwaitUser` 会调 `KYT_REJECTED`/`ACTION_PENDING` 动作），会撞上转移表抛 `Invalid action`，webhook 三次重试后进 DEAD、静默黑洞（单子既不入账也不进合规处置弧）。业主口径本轮不给边，但应改成显式 no-op + 落审计（照抄 `onPayinFailed` 白名单守卫 + warn 的写法，再补一条审计记录）｜来源: 2026-08-02 充值状态机收窄，业主定稿 brief §七（登记待办，非本轮实现）
- [ ] **`FROZEN` 收到任何 Sumsub 裁决都会抛(2026-08-02)**：`FROZEN` 转移表只剩 `resume`/`seize` 两条边（有意为之——制裁/MLRO 冻结的钱只有两个合法归宿），但 `applyKytApproved` 的 FROZEN 守卫只挡了 `approved` 裁决（no-op），`rejected`/`awaitUser`/`onHold` 类迟到裁决若命中 `applyKytRejected`/`applyKytAwaitUser`/`applyKytOnHold` 仍会调 `updateStatus` 撞上转移表抛错。需要补 no-op 兜底（同上两条一并处理，三处都是"迟到的 Sumsub webhook 撞上收窄后的转移表"同一类缺口）｜来源: 2026-08-02 充值状态机收窄，业主定稿 brief §七（登记待办，非本轮实现）

- [ ] **同一份「公司/自有钱包科目码集合」在三处各自硬编码，靠人工同步(2026-08-13 终审根因)**：`wallet-balance-checker.service.ts → FIRM_CODES`、`wallet-flow-matcher.service.ts → OWNED_CODES`、`scripts/recon-demo.ts → FIRM_CODES` 三处各写一份 `{200,201,210,211,212}(+202,203 退役保留)`，无共享常量。COA v2 落地时正是 `recon-demo.ts` 那份漏切换（费流水落 210/211 被镜像生成器过滤 → F_FEE 钱包镜像 `lines=0` 而引擎侧已认领 → `recon:demo` 假 BREAK：`casesOpened=2 orphanInternal=8`），终审实跑才逮到（此前 `recon:demo` 的 PASS 记录时间戳早于所有 210/211 费流水，该组合从未被测过）。三份目前已同步一致，但下次再拆/退役科目同样的手工遗漏还会复现。建议在 `tb-account-codes.constant.ts` 提炼一个共享导出（如 `MIRRORED_FIRM_CODES`，含活跃 + 退役保留两段）供三处消费 ｜来源: 2026-08-13 COA v2 整分支终审 Critical 的根因
- [已迁出 2026-08-28] ~~AuthGuard 里 `/wallet/send` 的受限重定向守着一条不存在的路由~~ → **判为业务缺口，移入 `BACKLOG.md`**（显示的内容错 / 该有的信息没有，非攻击-故障-并发触发）。原文见 git 历史 `649b4e88`
- [ ] **真接 Sumsub 前确认 `externalActionId` 对同一 `applicantActionId` 是否终身不变**：2026-08-18 材料请求账把各域 applicant action 的去重键从 `applicantActionId` 换成了 `externalActionId`（后者是 `material_requests` 的 `@unique` 列、是整套架构的定位键，`markSubmitted`/`cancel`/铸 token 全走它；前者无唯一约束、只在服务端与审计可见）。换键本身正确，但**若同一个 `applicantActionId` 在两次 webhook 投递里带出不同的 `externalActionId`，新实现会当成新 action 再登记一次，造成静默重复登记**（旧实现按 `applicantActionId` 去重则不会）。仓库内既无证据证明会发生（两条落地路径的 `externalActionId` 都是一次性生成后不再变），也无证据排除。真接生产前需拿 Sumsub 官方口径确认；拿不到保证就在 `syncApplicantActions` 加一层「两个 id 任一命中即视为已存在 + 不一致时告警」的检测 ｜来源: 2026-08-18 材料请求账 Task 8 评审裁定
- [ ] **充值/提现域"全部交齐"缓存（`actionSubmittedAt`/`slaDeadline` 提交时重置）迁到材料账后没有对应写入方，已是死列(2026-08-18)**：子表时代 `submitBySeq` 在最后一条 action 提交时顺带把 `depositTransaction`/`withdrawTransaction` 的 `actionSubmittedAt` 置为 `new Date()`、并在 `resetSla` 时重置 `slaDeadline`/`slaBreached`（供 `deposit-sla.service.ts`/等价 withdraw 逻辑判断"客户已交齐、现在等 Provider 复核"，否则 SLA 到期理由永远写"客户未响应"）。材料请求账迁移（Task 8/9）把提交入口挪到 `MaterialRequestsService.markSubmitted`（客户面走 `material-requests.client.controller.ts`）之后，全仓 grep `actionSubmittedAt:` 只剩 `clearDepositCache`/`clearWithdrawCache` 两处写 `null`（新 action 到达时清缓存），没有任何代码再把它置为非 null——即"客户已交齐材料"这件事从此再也不会反映到这两个字段上，`deposit-sla.service.ts` 的 `waitingOn` 判断会永远判成"等客户"（即使客户早就交了）。`test/deposit-sumsub-verdicts.e2e-spec.ts`/`test/withdraw-sumsub-scenarios.e2e-spec.ts` 的对应断言已改读材料账自身状态（`SUBMITTED`）而非这两个死列。修法：在 `MaterialRequestsClientController.submit()`（或 `MaterialRequestsService.markSubmitted`）成功且该单已无 `PENDING_SUBMISSION` 行时，回调对应域的 `clearDepositCache`/`clearWithdrawCache`（改造成能写非 null 值），或干脆让 `deposit-sla.service.ts` 直接查材料账而非这两个缓存列 ｜来源: 2026-08-18 修 deposit/withdraw sumsub e2e 时验收发现
- [ ] **`deposit_transactions.sumsubActionId`/`sumsubExternalActionId` 两列疑似历史死列，全仓零 TS 引用(2026-08-18 Task 12 收口自查发现)**：Task 12 删 `customer_main.pendingAction*` 三列 + `material_refresh_cycles.sumsubAction*` 三列时，用 `grep -c "sumsubAction" prisma/schema.prisma` 自查收尾，命中了这两列——与本轮要删的 `material_refresh_cycles.sumsubActionId` 同名但是 `deposit_transactions` 表上完全独立的字段。全仓 `grep -rn "\.sumsubActionId\b\|sumsubExternalActionId" src/ test/` 零命中（只有历史注释提到 `cycle.sumsubActionId`，指的是另一张表），`deposit-applicant-actions.service.ts`（材料请求账实际接管充值补料同步的服务）从未读写过它们，疑似比 `deposit_applicant_actions` 子表更早一轮（单指针时代）的重构遗留。**不在 task-12-brief 的删除清单内**（brief 只列了 `customer_main` 三列 + `material_refresh_cycles` 三列，未提这两列），本任务未删，登记留追；若确认死列，建议单开一次表重建迁移一并删掉（同一张表还可以顺带核实 `actionSubmittedAt` 是否也该迁移到材料账写入方，见上一条 380 号条目）｜来源: 2026-08-18 材料请求账 Task 12 收口自查
- [ ] **`config/material-refresh-policy.json` 里 5 个 level 名与 Sumsub 租户实际配置是否对得上，真接前须核对（设计稿 §9 Q2）**：`materials` 注册表的 5 个 `sumsubActionLevelName`（`wave3-action-id-refresh`/`wave3-action-liveness-refresh`/`wave3-action-poa-refresh`/`wave3-action-sof-refresh`/`wave3-action-sow-refresh`）目前只在 `SUMSUB_MOCK_MODE=true` 下跑通，从未拿真实 Sumsub 租户验证过这些 level 是否真的配置存在、`sumsubIdDocSetType` 等参数是否对得上；demo 阶段照用没问题，真接前必须逐个去 Sumsub 后台核对。连带：`ProfileBannerService.formatMaterialName()`（`src/modules/identity/profile-banners/profile-banners.service.ts:25`）的展示名映射里有 `PASSPORT: 'Passport'`，但 `PASSPORT` **不在** `material-refresh-policy.json` 的 `materials` 注册表里——运营在下发弹窗的下拉框里选不到它（下拉以注册表为准），这条映射目前是死条目，要么把 `PASSPORT` 补进注册表，要么从展示名映射里删掉，别留一个选不到却映射得出名字的幽灵材料类型 ｜来源: 设计稿 `doc-final/superpowers/specs/2026-08-17-material-request-ledger-design.md` §9 Q2
- [ ] **后端兑换详情接口是否还在吐 `restrictionRows`/`hardLineDispositionedAt`**：前端已零消费（第五批删了那个侧栏组），若后端 `include` 是专为这块加的即为死重 ｜来源: 2026-08-23 第五批 Task 4 审查
- [ ] **兑换详情页卡片编号注释重复**：现读作 `1,2,4,7,4,5,6,7,8,6,11`（4/7/6 各重复、缺 3/9/10），充值是干净的 1–10、提现 1–9。基线 `6236d9b9` 就已经坏 ｜来源: 2026-08-23 第五批终审
- [ ] **兑换详情页注释写「7 个单步裁决按钮」实为 8 个**（V1–V8，后端 fixture 也是 8）；三页都还写着「admin-web 暂无测试基建」，而第五批已建 `module-parity.spec.ts`（40 条断言，jest 真跑）｜来源: 2026-08-23 第五批终审
- [2026-08-27] `scripts/verify-swap-self-heal.ts` 失修：查询用已删除的 audit 列 entityNo（8/25 审计改表遗留），且其「第 2+ 次重试审计被吞」断言描述的旧行为已被站3-β2 修复（requestId 全携 randomUUID）——两点都过期，脚本当前跑不了也不再反映现实



## 2026-08-28 第二次分诊迁入（原 BACKLOG 业务台账）

> 判据 `rules/review-rubric.md`：只有攻击者 / 故障 / 并发 / 重复回调才会触发的，长得不一样但内容都对的，以及纯内部（命名、死码、类型、schema 残列、存储单位）与工具测试基建，一律技术账。
> 边界：挡住**开发**（端口、PATH、worktree、迁移）算技术留此；挡住**开演**（铺不出数据、模拟面板崩）算业务，留在 `BACKLOG.md` A 档。
> 本次迁入 45 条，原文照搬，上下文见 git 历史（`649b4e88`）。同时有 4 条从本文件判回业务（上方墓碑行）。

### 门与守卫（API 直调路径，UI 走不到）

- [~] Admin PATCH deposit status 部分绕过 workflow：仅 SUCCESS 被 `DEPOSIT_APPROVE_WORKFLOW_ONLY` 守卫，FREEZE/CONFISCATE 可绕过记账与审计 ｜来源: 2026-07-03 V4 体检 ｜✅ **2026-07-17 CONFISCATE 部分已关**——`CONFISCATED` 已加入 `deposit-transactions.service.ts → updateStatus()` 的 `ACCOUNTING_TERMINALS` 工作流专用守卫（isAdminApi PATCH 到 CONFISCATED 抛 `DEPOSIT_APPROVE_WORKFLOW_ONLY`；executeConfiscation 非 ADMIN_API 路径不受影响，单测 `blocks ADMIN_API from directly reaching CONFISCATED` 锁定）。**剩 FREEZE 部分未关**（FREEZE 无 TB 记账、危害较小，但仍应统一治理化，留账）｜✅ **2026-07-28 终审 Fix 3 再关一批**——`deposit-transactions.controller.ts → updateStatus()` 的 `default` 分支加 controller 层 allowlist：`resume`（绕过 A2 MLRO 解冻审批）/`seized_done`/`returned_done`/`confiscate_settle`（直跳终态、让 pending 锁永不结算）四个 workflow-only action 直接 `BadRequestException`（code `DEPOSIT_ACTION_WORKFLOW_ONLY`）。**`freeze`/`return`/`seize`（三个 start 动作）仍未收窄**——裸 PATCH 仍可把 deposit 推进 `FROZEN`/`RETURNING`/`SEIZING` 但不建对应 legSeq 资金单、不 pending 锁账，留作后续任务（同一类问题，只是这次只挑了业主明确点名的四个终态/审批绕过项）

- [ ] **RBAC 非超管验证未做（F6）**：`POST /admin/deposit-sumsub/demo/run-scenario` 已在 `rbac.catalog.ts` 登记 `TRADING_DEPOSIT_WRITE` 权限，但 Task 6 只用 SUPER_ADMIN token 验证过（该角色走 `access-control.service.ts` 的硬编码 bypass，天然绕过权限表检查），未验证一个只有 `TRADING_DEPOSIT_WRITE`（或没有该权限）的真实自定义角色调用该端点时，权限门是否真的生效（需要 `db:base:sync` + 重启后端才能让新 RBAC code 对非超管角色生效，Task 6 报告已提醒但未做）｜来源: 2026-07-29 Task 6 报告遗留

- [ ] **材料请求与限制便签共用同一套 RBAC 权限组，粒度耦合**：`/admin/customers/:customerNo/material-requests`（GET/POST）与 `/admin/material-requests/by-order/:orderDomain/:orderRef` 三条路由复用了既有的 `CUSTOMER_RESTRICTION_READ` / `CUSTOMER_RESTRICTION_WRITE` 组，没有新开 `MATERIAL_REQUEST_READ/WRITE`。当下无实际影响——`CUSTOMER_RESTRICTION_*` 三个组在 `RBAC_ROLE_GROUP_BINDINGS` 里**未绑给任何具名角色**，只有 SUPER_ADMIN 走特判拿到全部权限码（这是 customer-restrictions 端点原有的空档，材料请求只是原样继承）。但一旦有人给某角色绑 `CUSTOMER_RESTRICTION_READ`（比如只想放开「查限制便签」给 ops），会连带放开材料请求全量历史的读权限，反之亦然——这两件事业务上并非总是同一批人该看。要拆就得同时改 `PermissionGroup` 联合类型 + `rbac.catalog.ts` + `RBAC_ROLE_GROUP_BINDINGS` ｜来源: 2026-08-18 材料请求账 Task 6 评审

### 幂等与去重

- [ ] **`customer-restriction-workflow.service.ts` 的私有 `audit()` 方法有同款 requestId 缺陷**：`CustomerRestrictionsService.open()`/`release()` 已在本批补上 `requestId` 拼 `randomUUID()`（防同一客户第二条同 action 事件被幂等键静默去重），但 `CustomerRestrictionWorkflowService`（admin 手工贴/撕便签的审批编排层）内的私有 `audit()`（被 `openRestriction()`/`auditRelease()` 调用）没有同款修复——admin 手工路径的第二条审计轨迹仍可能被静默吞掉。Task 11 只调查、未改 ｜来源: 2026-08-20 制裁分主体批次

### 故障恢复与重试

- [ ] **CONFISCATING 结算耗尽重试后无手动重触发出口**：没收异步结算（`settleConfiscation`）失败自动重试 3 次仍失败则停 `CONFISCATING` + 记 `DEPOSIT_CONFISCATION_FAILED` 待人工介入（业主设计）。但资金单此时已 `CONFIRMED`（终态、不再发 `funds_order.status.changed`），且 `CONFISCATING` 状态机唯一出口是 `CONFISCATE_SETTLE`（由该事件驱动）、ADMIN_API PATCH 被 `ACCOUNTING_TERMINALS` 守卫挡 → **无 ops 可触达的重结算入口**。⚠️ 现实触发条件已收窄：`postPendingTransfer` 已幂等化（2026-07-17，赦免 `pending_transfer_already_posted`），故 leg1 成功/leg2 瞬时失败的 within-event 重试可自愈；仅"TB 持续宕机跨越全部 3 次重试"这一持续性故障才会真卡住（本地 TB demo 不可复现）。补法=加 admin `retry-confiscation-settle` 端点重调 `settleConfiscation`（幂等已就绪，安全可重入）｜来源: 2026-07-17 没收异步化对抗式复核 Finding 2

- [ ] 热钱包余额校验无：Payout 前不查 Outbound Wallet 余额，不足不显式失败 ｜来源: 2026-07-03 V5 体检

- [ ] **STUCK 费腿 funds_order 可停 CONFIRMED 视图残留**：`onFeeLegConfirmed()` 的 TB settle 瞬时故障三级梯耗尽后，费腿 `funds_order.status` 永久停在 `CONFIRMED`（从未真正 FAIL 过），Linked Funds Orders 卡片视觉上像"一直在途"，无独立 STUCK 标记（信号只在 withdraw 的 `needsReview`+审计里）｜来源: 2026-08-04 Task 12 truth 核对

- [ ] Quote TTL 无 cron sweep：仅懒过期（查询时 markExpired）｜来源: 2026-07-04 V6 体检

- [ ] **状态机收窄后 `onPayinFailed` 在 `COMPLIANCE_PENDING` 之后触发只 warn、未落审计(2026-08-02)**：`onPayinFailed` 守卫已从黑名单反转成白名单（只有 `PAYIN_PENDING` 才 `FAIL`），非 `PAYIN_PENDING` 状态收到 payin 失败事件（如未来建模的链上重组场景）目前只记一条 `logger.warn`，不落 `AuditLogsService` 审计。本轮先堵住会抛错的口子，落审计是下一步 ｜来源: 2026-08-02 充值状态机收窄，业主定稿 brief §七（登记待办，非本轮实现）

### 生产化才接（外部系统本演示一律模拟）

- [ ] **充值自动侦测器未接**：链上 watcher / 银行 VIBAN webhook 未部署，`deposit-transactions.service.ts → detected()`（真实业务入口）当前**唯一**触发路径是客户申报入账信号 + 手动扫描（demo 脚手架，带 `simulationRisk*` 注入 + `QUICK_DEMO` 模式）；PRD happy path 按业务意图写"系统自动侦测"，落地待接真实侦测源 ｜来源: 2026-07-11 充值 PRD v2

- [ ] **慢 case 自动重算未端到端验证**：KYT-only 架构的根基假设——客户/officer 处置慢 case 后，Sumsub 自动重算并补发 `applicantKytTxn*`（S4/S7 场景据此设计：ACTION_PENDING/MANUAL_CHECKING 补料或翻案后无需专门 action handler，靠重评 webhook 自动推进）——沙盒环境逼不出真实的"慢 case 重算"时序，Task 12 e2e（`test/deposit-sumsub-scenarios.e2e-spec.ts` S4/S7）只能用 fixture 直接喂第二个 webhook 断言，不是对真实 Sumsub 异步重算的端到端验证。上线前需拿真实 applicant 走一次真慢 case 验证 ｜来源: task-13-brief

- [ ] **按钮 ⑨（SLA breach）与真实 SLA 定时器取证痕迹不一致**：⑨ 只是投一份 `applicantKytTxnRejected` + `SLA_BREACH` tag（与 ⑦"无处置 tag"走同一条 `applyKytRejected` 分支，落 `MANUAL_CHECK`/`DEPOSIT_MANUAL_CHECKING`），并不真的驱动 `DepositSlaService` 的 cron 扫描/`slaDeadline` 过期判定——旧场景模型（`S9_ONHOLD_SLA`）是真拨 `slaDeadline` 到过去、再触发 `checkSlaBreaches()` 走 `DEPOSIT_SLA_BREACHED` 系统审计；新按钮模型为换取"单步即完成"的仿真简洁性，代价是 operator 点 ⑨ 看到的审计/报文痕迹与真实 SLA 超时触发的痕迹不完全一致。业主已知情，暂不处理 ｜来源: 2026-07-31 Task 4 final-review triage Minor②
- [已解 2026-08-29] 上一条按钮已整个删除——三域按钮表统一（充值/提现 11 码、兑换 8 码）时把这个假 SLA breach 按钮连同它对不上的取证痕迹一起摘掉；三域各自本来就有真实的 `POST :no/simulate-sla-timeout` 端点，不再需要这个仿造品 ｜ `src/modules/sumsub-shared/verdict-buttons.shared.ts` ｜ 见 commit `503357e7`

- [ ] **单缺 `sumsubApplicantId` 时 Gate 0 跳过提交，之后仿真按钮喂的 webhook 成静默孤儿**：`submitSumsubTxns()` 在 `customer.sumsubApplicantId` 为空时只 warn + 跳过（deposit 留 `COMPLIANCE_PENDING`，`sumsubTxnId` 恒空）；此时若 operator/demo 仍对这笔单点了仿真裁决按钮，`DepositDemoScenarioService.runVerdict()` 会现铸一个 txnId 走完整 ingest 链路，并把结果原样返回（`statusBefore`/`statusAfter` 字段齐全，HTTP 层 201 不报错）——但这次投递对生产链路而言毫无意义（这笔单从未真正提交过 Sumsub，webhook 找不到匹配的真实报送记录）。旧的 `runScenario`（已删）同样存在该缺口，非本轮新引入的回归 ｜来源: 2026-07-31 Task 4 final-review triage Minor③

- [ ] **外部账单摄入生产管道未做**：银行/HexTrust/链账单的拉取+清洗入库无生产实现，`external_balances`/`external_statement_lines` 仅 demo 脚本注入、引擎只读 ｜来源: spec §2.2/§9

### 命名与死码

- [ ] **充值审计事件改名 + 精简（8→6）**：PRD v2 定稿审计集去 `DEPOSIT_` 冗余前缀（workflowType 已标 DEPOSIT）+ 统一 `_APPLIED`→`_PASSED`（与展示词对齐）；并合并两对同刻冗余事件——`DEPOSIT_COMPLIANCE_STARTED`(并入 PAYIN_CONFIRMED) + `DEPOSIT_APPROVED`(并入 COMPLETED)；**并 GATE0→L1**（退役 `GATE0`/`Gate 0` 命名，统一 L1/L2/L3 口径：`DEPOSIT_GATE0_PASSED`→`L1_PASSED`、`runGate0()`→`runL1()`、日志 "Gate 0" 改 "L1"）。改 `audit-actions.constant.ts` + `deposit-workflow.service.ts`，须评估历史 `audit_log_events` 旧值兼容 ｜来源: 2026-07-11 充值 PRD v2（审计瘦身轮）+ 2026-07-12 三闸门命名统一

- [ ] demo 播种铸号种子不一致：`client-web Deposit.tsx` 与 `demo-lib.ts` 用 `walletId` 作 `fakeChainTxHash/fakeBankRef` 种子，funds_order 收口后 canonical 种子是 `fundsOrderNo`（两侧各自成对、不影响匹配，仅种子来源未统一）｜来源: 2026-07-11 externalRef 收口

- [ ] **交易域词表瘦身（496 → 实际在用量级，约 59）**：现有 496 个历史动作码里只有约 59 个在用，V1 完成后词表精简是交易域批次的活｜设计稿 §16

- [ ] **20 个领域服务的审计打点仍未上收到编排层（非仅交易域）**：分布 `trading`(5) / `identity`(7) / `governance`(2) / `asset-treasury`(3) / `clearing-settle`(2) / `counterparty`(1)。这些文件写的 55 个动作码经交叉比对 **V1 命中为 0**（比对已用变异验证证伪「恒零」：喂 workflow 文件命中 3/3/5），全部属业主 2026-08-25 裁定的「其他的不用管」。**上收的前置条件是这些域先有编排层**——实测 12/25 个文件所在域 workflow 数为 0，`identity/` 的 10 个 workflow 全属 `users/`+`access-control/`（V1 IAM 簇）。典型：`customers.service.ts` 的 3 处审计在 `create/update/remove` 纯 CRUD 里、只被 `customers.controller.ts` 调用，模块内唯一 workflow 是管「客户限制」的，无处可搬。⚠️ 上一轮曾有实现者为让守则测试变绿而把领域服务改名成 `*-workflow.service.ts`（审计调用原地未动），已重置——**改名不等于上收** ｜来源: 2026-08-26 Task 10 范围重定

- [ ] **`sourcePlatform` 词表失控（10 个值，4 个语义重叠）且无枚举约束**：实测 `SYSTEM`(143) / `ADMIN_API`(111) / `CLIENT_API`(7) / `CUSTOMER_API`(6) / `CUSTOMER_AUTH_API`(4) / `APPLICATION`(3) / `ADMIN_AUTH_API`(3) / `SCRIPT`(3) / `CRON`(2) / `ADMIN_INVITATION_API`(2) / `ADMIN`(2)。其中 `ADMIN` / `ADMIN_API` / `ADMIN_AUTH_API` / `ADMIN_INVITATION_API` 四者语义重叠，字段类型是裸 `string`（`audit-log.dto.ts:254`），无枚举、无写入校验。应定枚举 + 收敛取值 + 加机器校验 ｜来源: 2026-08-26 Task 10 收敛顺带实测

- [ ] **`client-web/src/pages/Withdraw.tsx` 的 tab 仍存组件 state**：`Deposit.tsx` 与本批改造的 `Swap.tsx` 都已把 tab 放进 URL 查询参数（`useSearchParams`），提现页还是 `useState`。今天没有可见症状——提现**没有**「列表 → 详情 → `navigate(-1)` 回列表」这条往返（详情页返回落点判据虽然同款，但提现列表 tab 与详情页不构成同一循环）；一旦将来补上同款往返，这条就会立刻表现为「从 History 点进详情，返回后站在下单表单」｜来源: 2026-08-22 第四批 D3

- [ ] **`directionOf()` 把提现两条腿都判成 `OUT`**：`funds-order.service.ts` 对 `withdrawTransactionId` 非空恒判 `OUT`，不按 `legSeq` 分叉——但费腿（legSeq=2）是 `FIRM_ASSET → INCOME_WITHDRAW_FEE` 的**纯内部划账**，按语义应是 `INTERNAL`（对照充值：`legSeq > 1` 一律判 `INTERNAL`）。**功能上无影响**：`getTransitionMap` 里 `INTERNAL` 落到的也是 OUT 那张表，两者当前等价。是命名/语义债，不是 bug ｜来源: 2026-08-22 第四批 A4/E1

- [ ] **funds-orders 域 RBAC 权限 + 审计实体仍用 rename 前旧名 `INTERNAL_FUND`**：Round 2 表 `internal_funds`→`funds_orders`（2026-07-02）后，权限 `INTERNAL_FUND_READ`（rbac.catalog.ts:44/581-586 整个 funds-orders 域唯一权限）+ 审计实体 `AuditEntityTypes.INTERNAL_FUND`（audit-actions.constant.ts:58，Spec#4 短名）均未跟随重命名 → 域叫 funds order、门禁/实体叫 internal fund，不一致。应统一改 `FUNDS_ORDER_READ` / 新增 `FUNDS_ORDER_DISPOSE` + 审计实体 `FUNDS_ORDER`（rbac catalog union 类型 + 全部 route + AuditEntityTypes + 引用点 + db:base:sync；审计实体改名要评估历史 audit_log_events 旧值兼容）｜来源: 2026-07-03 用户审阅推单 BACKLOG 发现 ｜下期 RBAC 轮同做

- [ ] **客户 TB 账户创建策略**：补事件驱动异步创建 or 认可懒加载 + 补文档 ｜来源: 2026-07-03 V3 体检

- [ ] **资金单合并可行性**：payin/payout/internalfund 状态机近同构，可评估进一步合并 ｜来源: Round 2 遗留

- [ ] **外部未清洗成 canonical 同构模型**：外部存独立表、匹配时才取公共字段归一；应清洗成与 `account_flow` 同字段/同单位(分)/同方向语义的 canonical 流水模型（字段清单见 spec §2.3）｜来源: spec §2.2 决策2

- [ ] **余额字段用法未约束**：内部 `balanceAfter` 回填补账后不自动重算 → 陈旧；对账内部数字应从账本现算(TB/Σflows)、balanceAfter 仅交叉校验(断言 ==Σ流水)；外部收盘余额可直用 + 逐笔余额查账单缺行 ｜来源: spec §2.5

### 内部存储口径（无业务可见性）

- [ ] 🎯 **业务层（充值/提现/兑换/资金单/报价/手续费）存储 元→分 整层迁移**（乙的第二步）：当前 `funds_orders.amount` 及整个业务层仍存「元」，与"内部全分"原则不符；recon 读入边界（matcher Pass3 `wallet-flow-matcher.service.ts` + push 回执 `receipt-lookup.service.ts` 档2）为此做 funds_order 元→分 换算。整层搬分后**可撤除这两处边界换算**（改为分比分直取）。blast radius 巨大（quote/withdraw/deposit/swap 建单+校验+展示全链），须单独排期迁移+回填+双跑校验｜来源: 2026-07-04 canon2 scale 审计 + 业主"内部全分"原则（spec `2026-07-04-recon-engine-canonical-minor-design.md` §6）

### 开发工具与测试基建（挡开发，不挡开演）

- [ ] **`scripts/stack.sh up`(self) 端口连锁失败**：admin/client 端口被上次会话遗留 vite 占着时，`ensure_port_free` 在 `set -euo pipefail` 下返回非零 → **整脚本中止、永不走到重建/重启 backend**（即便 backend 端口本身空闲）；与 CLAUDE.md「每次 up 自愈 .env / 重建后端」描述不符，导致实现者被迫手起 `node dist/main`。规避：`lsof -ti:<端口段>|xargs kill` 释放残留再 up。修法：`ensure_port_free` 命中占用改为 kill 残留后继续、或各服务独立处理不整体 `set -e` 退出 ｜来源: 2026-07-12 费率受众 worktree 执行（C + 验收两轮实现者各撞一次）

- [ ] **`scripts/on-stack.sh self <script>` 跑 `ts-node` 脚本时 `node_modules/.bin` 不在 PATH → `ts-node: command not found`**：经包装器跑 ts-node 类脚本（如 demo-lib/单脚本）时报错。规避 = 直接 `DATABASE_URL=... TB_ADDRESS=... npx ts-node -r tsconfig-paths/register scripts/<x>.ts`。修法：包装器把 `node_modules/.bin` 前置进 PATH（或统一用 `npx`）｜来源: 2026-07-16 transaction-limits（费率受众 worktree 亦曾遇，与本节上一条 stack.sh self 同源工具债）

- [ ] **`recon-demo.ts` MANIFEST_PATH 写死 main tmp**：默认 `/tmp/exchange_js_main/recon-demo-manifest.json`（可 `RECON_DEMO_MANIFEST_PATH` 覆盖）；self 栈跑 `recon:demo:break` 时 manifest 落 main 栈 tmp、非本 worktree tmp。不影响评分（verifyManifest 读内存 manifest 对象、不回读文件），仅文件落点跨栈。修法：默认按 `DATABASE_URL` 派生 tmp 目录，或 on-stack 包装器注入 `RECON_DEMO_MANIFEST_PATH` ｜来源: 2026-07-04 canon2 T5 code-review（M2）

- [ ] 🔴 **`scripts/stack.sh` 从不跑迁移 —— 每次改 schema，跑着的栈都会悄悄留在旧库上**：`grep -c 'migrate\|prisma' scripts/stack.sh` = **0**。`stack.sh up` 会自愈 `.env`、切 node20、重建后端，但**不迁移**。2026-08-24 实测后果：main 栈的库停在 `20260817020000_drop_legacy_action_stores`，第四批的 `20260822010000_batch4_needs_review_and_l1` 从没应用过 → `l1Snapshot` / `needsReview` 列根本不存在，业主在 admin 上看不到 L1 闸门，误以为"第四批没合进 main"（代码其实早在 main 上，merge `6236d9b9`）。**这是个会反复咬人的坑**：只要有人改 schema 又没手动 `prisma migrate deploy`，跑着的栈就与代码脱节，且没有任何报错提示。修法二选一：① `stack.sh up` 里加一步 `prisma migrate deploy`（幂等，已应用的迁移不会重跑）；② 加一步 `prisma migrate status` 检查，有待应用迁移就 fail-closed 并打印提示。⚠️ 顺带：`npm run runtime:diagnose` 号称"诊断迁移漂移"，但它不在 `stack.sh` 的路径上，没人会主动跑 ｜来源: 2026-08-24 业主问"为什么 gate1 那些没有在 main"时查出

### 前端观感与代码重复

- [ ] **SLA 倒计时不会自己走，要靠运营切页/刷新**：三域列表页 + 详情页共六个页面都没有 `setInterval`/轮询，`formatSlaRemaining()` 只在每次 render 求值一次——一格显示 `"4m"` 的单子十分钟后还写着 `"4m"`，直到运营切页或手动刷新才更新（破线红标同理，翻红要等下一次 render）。设计稿（`doc-final/superpowers/specs/2026-08-21-sla-design.md` §4.2:178）写的是"状态卡内显示倒计时"。纯观感问题，不影响后端判定 ｜来源: 2026-08-21 SLA 批次

- [ ] **充值/提现详情页看不到资金腿重试次数**：后端三域都做了重试三级梯，但只有兑换前端把 `attempt` 显示出来（充值/提现详情页 `attempt` 零出现）。统一关联资金单模块（把兑换的 `LegAttemptRow` 与共享 `LinkedRelationCard` 合一）之前，需先确认充值/提现详情响应带不带 `attempt` ｜来源: 2026-08-23 第五批（业主裁定乙：本批不动）

- [ ] **兑换列表列顺序与充值/提现不同**：兑换是 `Swap No, Owner, Sell, Buy, Rate, Spread, Status, Stage, SLA, Review, Created`（Owner 第 2、Status 第 7），充值/提现是 `单号, Status, Amount, Type, Owner, SLA, Review, Created`（Status 第 2、Owner 第 5）。本批只统一了筛选控件与 Review 列，**列顺序不在范围内** ｜来源: 2026-08-23 第五批终验

- [ ] **资产类型筛选的交互手感三域不一致**：充值/提现写在 `fetchItems` 里（改下拉**要点 Search 才生效**），兑换写在 `visibleItems` memo 里（**即时生效**）。都是页内过滤、都合本批规格，但同一控件手感不同。兑换那种更好，统一需把充值/提现也搬进 memo ｜来源: 2026-08-23 第五批 Task 8 审查

- [ ] **三域 SLA 徽章与 `Simulate SLA Timeout` 用裸 Tailwind 色**（`text-red-600`/`bg-amber-50` 等），违反 `rules/frontend-admin.md` 的「只用 adm-* token」。三域 3/3 一致，**只改一域会把既有技术债变成新漂移**，要改就独立一轮三域一把改 ｜来源: 2026-08-23 第五批

- [ ] **三域 `fetchData` 里的原生 `alert()`** —— 同上，3/3 一致，属既有债不属漂移 ｜来源: 2026-08-23 第五批

- [ ] **另 12 个列表页有同款「页脚重影」**：`Pagination`（`components/common/Pagination.tsx`）默认形态**自己就是一整条页脚**（`border-t bg-adm-panel px-6 py-3` + 自带 `Showing X to Y of Z entries`），全仓 28 个消费者里有 13 个在它外面又套了一条手写页脚 → 超过一页时**两条边框叠一起、两个 Showing 并排**。2026-08-23 第五批已给三个交易列表页收口（新增 `components/common/ListFooter.tsx` + 给 `Pagination` 加 `bare` 开关，默认行为对其余 25 个调用方逐字不变），**剩余 12 个页面照旧**：EvidenceExports / RoleChangeRequests / RiskAssessmentList / RefreshCycles / CustomerManagement / SumsubEvents / MaterialManagement / FundsOrderList / WithdrawalAddressList / CustodianWalletList / PolicyChangeRequests / Approvals。迁移只需换成 `<ListFooter>` ｜来源: 2026-08-23 第五批终审

- [ ] **详情页顶部横幅有三个承载物**：共享件 `NeedsReviewBanner`（红条，第五批抽出）/ 手写绿色 notice 条 / 充值独有的手写琥珀 CONFISCATING 条。绿条**兑换那份已分叉**：`bg-adm-green/10 + py-2 + 缺 shrink-0`，充值/提现是 `/5 + py-2.5 + shrink-0` —— 与红条被抽件前的病**一模一样**，红条修了绿条没碰 ｜来源: 2026-08-23 第五批终审

- [ ] **`Simulate SLA Timeout` 是六个页面里唯一绕过 `adminButtonClass` 的按钮**：三份手写、裸 Tailwind 调色板（`border-amber-300 text-amber-700 hover:bg-amber-50`）而非 `adm-*` 令牌，字号 `text-sm` 比全站按钮 `text-[11px]` 大一档、`py-2` 比 `py-1.5` 高。`adminButtonStyles.ts` 的 `repair` 变体正是为它这种琥珀警示按钮准备的 ｜来源: 2026-08-23 第五批终审

- [ ] **⚡ Simulation 面板 markup 仍是三份手写**：充值/提现两份做域名归一化后 diff **只差 1 行**（按钮数组名），其余 33 行逐字重复。今天零视觉差异，但这正是 L2 闸门格子当初分叉出三套排版的前一阶段状态 ｜来源: 2026-08-23 第五批终审
- [已解 2026-08-29] 上一条已抽成共享组件：三份手写 markup 收敛成 `admin-web/src/components/SimulationPanel.tsx` 一份，按 `source`（引擎自动命中 / 合规官手工处置）分两组渲染；按钮清单本身也不再是前端手抄数组，改从后端 `GET demo/verdict-buttons` 拉取（源头 `src/modules/sumsub-shared/verdict-buttons.shared.ts`），三域三个交易详情页共用同一份 ｜ `admin-web/src/components/SimulationPanel.tsx` ｜ 见 commit `ede9a8f0`

- [ ] **列表页 error 态位置三域不同**：充值/提现是表**上方**红色通条（表格数据仍在），兑换是表**体内** `<td colSpan=11>`（**整表内容被顶掉**）｜来源: 2026-08-23 第五批终审

- [ ] **侧栏 Terminal 提示三域三样**：充值**整块没有**、提现在 SLA 组**之前**（`text-[11px]`）、兑换在 Lifecycle 组**之后**（`text-[10px]`）。且兑换那个裸 `<p>` 放在 Lifecycle 之后会让 `SidebarGroup` 的 `last:border-b-0` 失效 → **多出一条本不该有的分隔线** ｜来源: 2026-08-23 第五批终审

- [ ] **兑换 `Internal Approvals` 空态是手写 div**，充值/提现用共享 `LinkedRelationEmpty`（后者在消息上方还有一行 cap 微标签）→ 同一张卡的空态，另两域有小标题、兑换没有 ｜来源: 2026-08-23 第五批终审

- [ ] **三页各手写一份逐字相同的「本单已进终态/处置态」`<p>`**（第五批 Task 7 引入，className 与文案全同）—— 同职责内联三份，正是本批立规矩要消灭的形状 ｜来源: 2026-08-23 第五批终审

- [2026-08-29] **`stack.sh reset self` 在 worktree 里会造出「假的 COA 恒等式失败」，且倍数逐次累加** ｜ `scripts/stack-stop.sh` + `scripts/reset-stack.sh` ｜ 实证于 feat/demo-kit-sumsub-panel

  机制：`reset-stack.sh` 会 `rm -f` TB 数据文件再 `format` 一个新的，但它先调的 `stack-stop.sh ... || true` **杀不掉 worktree 的 TigerBeetle 进程**（既有账：孤儿清理相对/绝对路径不匹配，永不命中）。老 TB 进程存活、继续占着端口、句柄指向那个已被 unlink 的旧文件——于是 **SQLite 被清空重铺（负债侧回到 1 倍），TB 余额却一路累加**。
  症状：`demo:all` 报 `COA CLIENT(AED): CLIENT_ASSET == Σ(...)` 失败，实际值是期望值的**整数倍**，且每 reset 一次倍数 +1（实测 1→2→3→4 倍，同一 commit 零代码改动）。FIRM 侧恒对，只有 CLIENT 侧翻倍。
  危害：**这是一个会把人送去追不存在的账本 bug 的假警报**。本轮就差点据此判定分支引入了重复记账回归——做了 commit 二分才发现倍数在累加、进而定位到孤儿进程。
  绕法：`lsof -ti:<TB端口>` 找到进程手工 `kill`，再 `reset` + `up`，`demo:all` 即回 8/8（COA 数字与 main 逐字一致）。
  修法（生产化时）：`stack-stop.sh` 的孤儿匹配改成按端口而非按路径；或 `reset-stack.sh` 在 `rm -f` 之前断言目标端口已空、不空则 fail-fast，而不是 `|| true` 吞掉。

- [2026-08-29] **同一根因也堵住了普通 `stack.sh up self`（不只 `reset`）——已在跑的 self 栈重新 `up` 必现"port already in use"，backend/admin/client/tb 四个进程全中招** ｜ `scripts/stack-stop.sh` 的 `stop_listener_if_managed` ｜ 实证于 feat/demo-kit-sumsub-panel（B3 任务全链实跑前置步骤）
  机制：与上一条 TB 孤儿同根——`stop_listener_if_managed` 用 `command_line == *"${APP_DIR}"*` 判断某端口的持有进程是否"归本栈管"，但实际启动命令全是相对路径（`node dist/main`、`./node_modules/.bin/vite ...`、`tigerbeetle start ... /tmp/exchange_js_wt_<名>/0_0.tigerbeetle`），没有一条包含 `APP_DIR` 绝对路径子串，判断恒假、恒判"non-managed process, skip"。`stop_pid_file_process` 那条路径本该兜底，但本次遇到的栈是更早一次会话手工/非常规方式启动的，PID 文件与实际进程对不上，兜底路径也没接住。
  症状：`bash scripts/stack.sh up self` 在已有栈存活时，会在 `ensure_port_free` 那步直接 `exit 1`（`set -euo pipefail` 下 `return 1` 不吞），backend 卡住后admin/tb 会依次重演同一幕（逐个补 kill 后再 up 才过下一关）。
  绕法：`ps -p <pid> -o command` 确认确实是本 worktree 自己的进程（cwd 或数据文件路径能对上）后手工 `kill`，四个都清完再 `stack.sh up self` 一次性成功；不要连续 `up` 指望它自愈。
  修法（生产化时）：与上一条同一处，`stop_listener_if_managed` 的匹配依据改成"端口是否由本机任意进程持有"而非路径子串匹配，或干脆用 PID 文件作为唯一真相源、把陈旧/外部持有者的情形当成需要人工介入的 fail-fast，而不是静默 skip。

- [2026-08-30] **`data.md` 生成区每跑一次 `demo:all` 必变，「防漂移」承诺不成立** ｜ `scripts/demo-lib.ts → writeDataMdSnapshot` + `doc-final/demo/data.md` ｜ 演示装备一期合并后走查发现

  生成区的表里带**单号列**（`DEP2608301739` 这种），单号内嵌日期+随机后缀，所以**每次 `demo:all` 都是一整表变化**，跟行为改没改无关。演示装备一期的 spec/plan 写的「`git diff data.md` 有变化 = 代码真的改了行为」因此不成立——合并当天就实测到：同一份代码跑两次，22 行全变。
  连带后果：跑完 `demo:all` 工作树必脏一个文件，`git worktree remove` 会被拦。
  修法（生产化时选一）：① 生成区不吐单号列，只留「序号 / 标签 / 客户 / 金额 / 预期态 / 实到态 / ✓」——那几列才是真正该防漂移的；② 单号另起一节、明确标注「每次跑都变，不参与 diff 判据」。

- [2026-08-30] **`regulatory_gate_items.walletId` 列退役后成死列** ｜ `prisma/schema.prisma` `RegulatoryGateItem.walletId` ｜ CLIENT_BANK_ACCOUNT_ENABLEMENT 监管闸门退役

  唯一写入方 `CLIENT_BANK_ACCOUNT_ENABLEMENT` 闸门类型已退役（该闸硬要求绑定的 `walletRole=C_CMA` 钱包上一轮已从种子退役，闸门本就建不出来，业主拍板整型退役）；列本身可空、退役前这类闸门在库里就是 0 行，不为此单独加迁移重铺。值得清的时机：下次再动 `regulatory_gate_items` 表 schema 时顺手带走——该列、其 `wallet` 外键关系，以及 `regulatory-gates.service.ts` 里仍保留的 `wallet` include/序列化字段（`mapGate()` 的 `walletId`/`wallet` 投影、`getGateRowOrThrow`/`create`/`update`/`submit`/`recordFeedback`/`bindReceipt`/`markEffective`/`revoke` 里逐处 `include: { wallet: true }`）与 DTO 的 `walletId?: string` 输入字段——这些目前留着是因为只服务这一个已退役列，删不删不影响另外两种闸门。

- [2026-08-30] **`stack.sh reset` 在全新 worktree 首跑会静默跳过 TigerBeetle 建户与资本注入** ｜ `scripts/reset-stack.sh:63-88` ｜ 第一幕职权重划开工时实测

  `reset-stack.sh` 自己起了 TigerBeetle（`:49`），但下面 `apply-local-migrations` / `db:base:sync` / `db:biz:reset` / `db:seed:business` 四个子进程只传 `DATABASE_URL=`、**不传 `TB_ADDRESS`**；老路径 `reset-main-biz.sh:74` 是传了的，两条路径不一致。平时不发作是因为 `TB_ADDRESS` 在 `.env` 里，而 `.env` 由 `stack.sh up` 生成——**全新 worktree 若先 `reset` 后 `up`，`.env` 尚不存在**，`prisma/seed-tb.helper.ts:79` 于是打两条 `⚠ TB_ADDRESS not set, skipping ...` 就跳过，退出码仍是 0。后果：库建好了但 TB 账户是空的，`verify:coa` 与 `demo:all` 的 COA 断言会在后面莫名其妙地失败，而失败点离根因很远。规避：新 worktree 先 `stack.sh up self` 让 `.env` 落地，再 `reset`；或给那四个子进程补上 `TB_ADDRESS="${TB_ADDRESS}"`。

- [2026-08-30] **`stack.sh up` 撞自家 reset 留下的 TigerBeetle 时提前退出，三个应用服务一个不起** ｜ `scripts/stack-up.sh:88` `ensure_port_free "${TB_PORT}" "tb"` ｜ 同上

  `reset` 会把 TigerBeetle 拉起来并留着（seed 要连它），紧接着跑 `up` 时 `ensure_port_free` 判定 TB 端口被占、走"already in use"分支退出——**退出码是 0**，看起来像成功，实际 backend / admin / client 三个服务一个都没启。规避：`lsof -ti:<TB端口>` 杀掉自家那个 TB 进程再 `up`（数据文件已存在，不会被重新 format，数据不丢）。

- [2026-08-31] **随手闸的三道 tsc 照不到 `test/`，退役类改动会在 e2e 里留下哑弹** ｜ CLAUDE.md §7 随手闸①②③ ｜ 第一幕职权重划实测

  §7 的随手闸是后端 `tsconfig.json` + 管理台 + 客户端三条，**都不覆盖 `test/` 目录**（该目录另有 `tsconfig.test.json`，不在闸门里）。本轮实测后果：Task 4 把 `DepositWorkflowService.adminFreeze()` 作为孤儿方法退役（其唯一 HTTP 调用方已删），三道闸全绿、评审也过，但 `test/deposit-sumsub-verdicts.e2e-spec.ts` 仍在两处调它——**要等到跑 e2e 才炸，而 e2e 不在随手闸里**。同一轮 Task 11 改 `DEPOSIT_CONFISCATION` 裁决人时，同一文件里的 `OPS_CHECKER` 也是同款哑弹。两处均已修（`c92df6cf`），但根因是闸门覆盖面：**凡退役 service 方法 / 改审批策略角色，必须额外跑一次 `npx tsc --noEmit -p tsconfig.test.json`**。值得把它加进 §7 随手闸第 ④ 条。（记忆里 2026-08-20 制裁分主体那轮已踩过一次同款坑，当时建了 `tsconfig.test.json` 但没进闸门。）
