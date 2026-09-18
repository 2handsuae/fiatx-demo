# 兑换对齐提现（数据契约 + 受限体验 + 认证闭环）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** swap 的 Sumsub 数据契约逐字段采用提现终态形状；受限客户"页面不封、按钮禁用+提示"；认证入口挂 Swap/Withdraw 两页顶部并复用既有认证页真跳 WebSDK，闭环到限制自动解禁。

**Architecture:** 见 spec [`2026-08-14-swap-withdraw-parity-design.md`](../specs/2026-08-14-swap-withdraw-parity-design.md)。共享流水线不动，只改：后端读写两侧对齐提现契约（+3 列、approved 也落 detail、parseDetail）；客户级 verification-session 两端点（+1 列三态）；客户端 AuthGuard 撤重定向、两页禁按钮、banner 置顶+真跳转+refreshProfile 闭环；admin 详情组件对齐提现版。

**Tech Stack:** NestJS + Prisma + SQLite｜React (client-web / admin-web)｜Jest / Vitest

## Global Constraints

- Worktree `.claude/worktrees/swap-sumsub/`，分支 `feat/swap-sumsub-compliance`；栈 `bash scripts/stack.sh up`（self）。
- 审计走注入的 `AuditLogsService`；多表变更 `prisma.$transaction`；业务键优先；不直写他域 Prisma 表（CustomerMain 走 `CustomerPendingActionService`/`CustomerRestrictionsService`）。
- **防探测姿态**（充值/提现既有，必须照抄）：verification-session 响应只有 `{submitted, sdkToken}`；对"无 action / 已提交 / 不存在"不可区分；submit 幂等恒 2xx；客户端拿不到 Sumsub 侧 id。
- **tipping-off**：受限提示文案不带原因；软硬线客户侧无差别；banner 显隐由后端单点决定，前端零推导。
- 单测只跑触碰的 spec 文件（全量 jest 有 ~4 个 wallets 既有失败）；UI 改动必须起栈渲染验证。
- 不动区：webhook 路由/状态机/零痕迹保证/处置分型/demo fixtures/提现域现状。

---

## Task 1: 后端 · swap Sumsub 数据层对齐提现

**Files:**
- Modify: `prisma/schema.prisma`（SwapTransaction +3 列）→ migration `swap_sumsub_parity_fields`
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts`（`saveSumsubVerdict` + `findOneForAdmin` 换 parseDetail）
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`（`applyKytVerdict` 落 verdict 改走 saveSumsubVerdict；`submitSumsubTxnOut` 写 `sumsubTxnType:'finance'`）
- Modify: `src/modules/swap-sumsub/swap-kyt-verdict.handler.ts`（approved 也拉 getTxn）
- Test: `swap-transactions.service.spec.ts`、`swap-workflow.service.spec.ts`、`swap-kyt-verdict.handler.spec.ts`

**Interfaces:**
- Produces: `saveSumsubVerdict(swapId, {verdict, score?, detailRaw?}, tx)`；`findOneForAdmin` 的 `sumsubDetail` 形状 = 提现版 `{verdict, reviewStatus, reviewAnswer, score, matchedRules[{id,name,action,score}], applicantActionIds[], tags[], raw}` + swap 补充 `txnIdIn`、行级 `rejectReason` 保留
- 蓝本：`withdraw-transactions.service.ts:553-585`（parseDetail）、`:818-831`（saveSumsubVerdict）、`withdraw-kyt-verdict.handler.ts:20`（DETAIL_LOOKUP_VERDICTS）

- [ ] Step 1 失败测试：①handler 收到 `applicantKytTxnApproved` 时调 `getTxn` 且 `applyKytVerdict` 收到 `detailRaw` 与 `riskScore`；②`applyKytVerdict(approved)` 后行上 `sumsubScore/sumsubScoredAt/sumsubTxnDetailJson` 有值；③`findOneForAdmin` 对存好的官方形状 raw 解析出 `reviewStatus/reviewAnswer/score/matchedRules[{name,action,score}]/applicantActionIds/tags`
- [ ] Step 2 跑测确认失败（`npx jest src/modules/trading/swap-transactions/ src/modules/swap-sumsub/`）
- [ ] Step 3 实现：schema +`sumsubScore Int? sumsubScoredAt DateTime? sumsubTxnType String?`（@map snake）→ `npx prisma migrate dev --name swap_sumsub_parity_fields && npm run prisma:generate`；handler 把 approved 加入 detail 拉取（swap 归一后仅 approved/rejected 两类，两类都拉，传 `riskScore: detail.riskScore`）；`saveSumsubVerdict` 照提现原子写；`applyKytVerdict` 两分支经它落库（approved 分支同事务）；`submitSumsubTxnOut` 更新时带 `sumsubTxnType:'finance'`；`findOneForAdmin` 换 parseDetail（照搬提现 :553-585，输出补 `txnIdOut/txnIdIn`）
- [ ] Step 4 跑测通过 + `npx tsc --noEmit` 清
- [ ] Step 5 Commit：`feat(swap): Sumsub 数据契约对齐提现 —— +score/scoredAt/txnType 列，approved 也落 detail，读面换 parseDetail`

## Task 2: 后端 · 客户级 verification-session 两端点 + 三态列

**Files:**
- Modify: `prisma/schema.prisma`（CustomerMain +`pendingActionSubmittedAt DateTime?`）→ migration `customer_pending_action_submitted`
- Modify: `src/modules/identity/customers/customer-pending-action.service.ts`（`get` 返回 +`submittedAt`；`set(null)` 清列；新增 `markSubmitted`）
- Modify: `src/modules/identity/customers/customer-pending-action.controller.ts`（+2 路由）
- Modify: `src/modules/swap-sumsub/applicant-action.handler.ts`（GREEN/RED 清列——经 service，不直写）
- Test: `customer-pending-action.service.spec.ts`、controller spec、`applicant-action.handler.spec.ts`

**Interfaces:**
- Produces: `GET /client/me/pending-action/verification-session` → `{submitted:boolean, sdkToken:string|null}`；`POST …/verification-session/submit` → 恒 2xx；`get()` → `{externalActionId, reason, submittedAt}|null`
- Consumes: `sumsubClient.createActionSdkToken({applicantId, levelName: process.env.SUMSUB_ACTION_LEVEL || 'wave3-level-1', externalActionId})`（`sumsub.client.ts:118-158`，mock 返假 token）；蓝本 `withdraw-verification-session.service.ts`

- [ ] Step 1 失败测试：①无 pending → `{submitted:true, sdkToken:null}`；②有 pending 未提交 → sdkToken 非空（mock）；③已提交（submittedAt 有值）→ 与①响应逐字节一致（防探测断言）；④submit 幂等两次恒 2xx 且审计 `SWAP_ACTION_SUBMITTED` 只随首个提交写；⑤GREEN handler 清 pendingAction 同时清 submittedAt
- [ ] Step 2 跑测确认失败
- [ ] Step 3 实现：migration；service 扩展（markSubmitted 幂等：已有值不覆盖）；controller 两路由（`AuthGuard('jwt')` + type==='CUSTOMER' 校验，照 `trading-readiness.controller.ts` 姿势）；GET 无 applicantId 时同样返 `{submitted:true, sdkToken:null}`（不可区分）；audit 常量 `SWAP_ACTION_SUBMITTED` 入 `audit-actions.constant.ts`
- [ ] Step 4 跑测通过 + tsc 清
- [ ] Step 5 Commit：`feat(customer): 客户级 pending-action verification-session 端点 + 三态列（防探测姿态对齐充值提现）`

## Task 3: 客户端 · 受限体验（页面不封、按钮禁用）

**Files:**
- Create: `client-web/src/utils/restrictedCapabilities.ts`（+spec）
- Modify: `client-web/src/components/AuthGuard.tsx`（RESTRICTED 分支撤 `/swap`、`/withdraw`，保留 `/wallet/send`←WITHDRAW）
- Modify: `client-web/src/pages/Swap.tsx`、`client-web/src/pages/Withdraw.tsx`（读 caps → 禁两步提交按钮 + 表单顶提示条）

**Interfaces:**
- Produces: `restrictedCapabilities(user): Set<string>`（容 `{capability,reason}` 对象与 string 两形状；AuthGuard/两页三处复用）
- 提示条文案（两页一致、不带原因）：`Trading is currently restricted on your account.`

- [ ] Step 1 失败测试（vitest）：util 对对象数组/字符串数组/空/undefined 四形状的归一化
- [ ] Step 2 跑测确认失败（`npx vitest run`）
- [ ] Step 3 实现：util；AuthGuard 改 `pathBlockedBy` 仅剩 `['WITHDRAW', ['/wallet/send']]`（注释说明 Swap/Withdraw 页自禁）；Swap 页 `restricted = caps.has('SWAP')||caps.has('ALL')` → `Swap Now`/`Confirm and Swap` disabled 追加 + 提示条；Withdraw 页同构（`WITHDRAW`，`Review Withdrawal`/`Confirm and Submit`）
- [ ] Step 4 vitest + `npx tsc -b --force` 清
- [ ] Step 5 Commit：`feat(client): 受限客户页面不封 —— Swap/Withdraw 按钮禁用+中性提示，AuthGuard 仅拦 /wallet/send`

## Task 4: 客户端 · banner 置顶三态 + 认证页 + 解禁闭环

**Files:**
- Modify: `client-web/src/components/PendingActionBanner.tsx`（三态；CTA 真跳 `/verification/pending`；action 非空→null 转变时调 `useAuth().refreshProfile()`）
- Modify: `client-web/src/utils/resolvePendingAction.ts`（响应 +submittedAt，失败语义不变）
- Modify: `client-web/src/pages/Swap.tsx`、`Withdraw.tsx`（banner 移至内容区最顶、跨全宽；Swap 页原右栏挂载移除）
- Create: `client-web/src/pages/PendingVerification.tsx`（fork `WithdrawVerification.tsx` 去 seq；session 端点换 Task 2 的两条；demo MockUploader 照搬）
- Modify: `client-web/src/App.tsx`（+路由 `/verification/pending`，AuthGuard 包裹）

**Interfaces:**
- Consumes: Task 2 两端点；`useAuth().refreshProfile`（AuthContext 既有导出）
- 三态渲染：`action===null`→不渲染；`submittedAt===null`→"Additional verification is required…"+CTA；`submittedAt` 有值→"Verification submitted — under review."（无 CTA）

- [ ] Step 1 失败测试（vitest）：resolvePendingAction 对 `{externalActionId, reason, submittedAt}` 的透传与三种失败路径清空语义保持
- [ ] Step 2 跑测确认失败
- [ ] Step 3 实现（banner 头注的"前端零推导"铁律保持：三态只按后端字段值渲染）
- [ ] Step 4 vitest + tsc 清
- [ ] Step 5 Commit：`feat(client): 认证 banner 置顶三态 + /verification/pending 真认证页 + 完成后自动解禁`

## Task 5: admin · SwapTransactionDetail 对齐提现组件

**Files:**
- Modify: `admin-web/src/pages/SwapTransactionDetail.tsx`

**Interfaces:**
- `SumsubTxnDetail` interface 改为提现版（`WithdrawTransactionDetail.tsx:71-80`）+ swap 补充 `txnIdIn`；`SumsubDetailSection` 逐行对齐提现 `:834-881`（Score/Verdict/Review Status/Review Answer/Matched Rules `name·action·score`/Applicant Action IDs join/Raw 折叠）；References 卡 +Type(`data.sumsubTxnType`)、+Received At(`data.sumsubScoredAt`)，保留 Txn ID Out/In；上轮自造的「Applicant Actions（下发的补料要求）」行改为提现命名 `Applicant Action IDs`
- 保留不回退：Compliance L1/L2 双卡、Customer Disposition 只读侧栏、Internal Approvals 空态、⚡ 八键、rejectReason 展示

- [ ] Step 1 实现（无组件测试基建，验收走渲染）
- [ ] Step 2 `npx tsc -b --force` 清
- [ ] Step 3 Commit：`feat(admin): swap 详情 Sumsub 两卡逐字段对齐提现`

## Task 6: 渲染验收 + 文档同步

**Files:**
- Modify: `doc-final/reference/truth/v6-swap.md`（前端受限体验/认证闭环/契约对齐三段）
- Modify: `doc-final/BACKLOG.md`（勾掉「认证 CTA 降级（Task 11）」）

- [ ] Step 1 后端重编译重启（self 栈），走查并截图：①受限客户（demo_frank）进 Swap/Withdraw——表单可见、按钮灰、顶部提示+banner；充值页正常 ②banner CTA → `/verification/pending` → demo MockUploader 提交 → banner 转"under review" ③admin ⑦ GREEN → 回客户端 visibilitychange 后 banner 消失、按钮解禁（不整页刷新）④制裁客户（demo_bob）：灰按钮+提示、**无 banner** ⑤admin：新 V1 approved 单的 References 卡 Received At/Type 有值、Detail 卡 Score/Review Status/Review Answer 有值，与 withdraw 详情页并排对比字段一致
- [ ] Step 2 `npx jest src/modules/trading/swap-transactions/ src/modules/swap-sumsub/ src/modules/identity/customers/` + 两前端 tsc + vitest 全清
- [ ] Step 3 truth/BACKLOG 同步；Commit：`test+docs(swap): 对齐验收走查 + truth/BACKLOG 同步`

---

## Self-Review

Spec §1→Task 3｜§2→Task 4｜§3→Task 2+4｜§4→Task 1+5｜§6 三默认→Task 2(③)/3(①)/4(②)｜§7 验收→Task 6。类型一致性：`saveSumsubVerdict`/`sumsubDetail` 形状 Task 1 定义、Task 5 消费；`get()` +submittedAt Task 2 定义、Task 4 消费；`restrictedCapabilities` Task 3 定义三处复用。无占位符。
