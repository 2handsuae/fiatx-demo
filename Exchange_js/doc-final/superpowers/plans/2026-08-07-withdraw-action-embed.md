# 提现补料 Embed + 详情独立页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提现 ACTION_PENDING 补料闭环——多条 applicant action 子表 + 客户端详情独立页 + 认证独立页 + 会话接口，镜像充值 deposit-action-embed 终局形态。

**Architecture:** 镜像 fork（岔口乙）：逐文件镜像充值的 `deposit-applicant-actions.service.ts` / `deposit-verification-session.service.ts` / `DepositDetail.tsx` / `DepositVerification.tsx`，父实体换 withdraw，充值三轮终审的全部修复直接继承（集合比对/零行 guard/接口不可区分/id 不下发/无双层短路）。

**Tech Stack:** NestJS + Prisma(SQLite) + React。

**Spec:** `doc-final/superpowers/specs/2026-08-07-withdraw-action-embed-design.md`

## Global Constraints

- **状态机零改动**：客户提交不流转状态；`ACTION_PENDING` 唯有 Sumsub 重裁/officer 放行才离场。转移表/动作枚举一行不改。
- **客户面拿不到 action id**：白名单开口仅 `actions: [{seq, submittedAt}]`；`applicantActionId`/`externalActionId` 不出现在任何客户响应。
- **会话接口只看这一条 action 的 `submittedAt`，绝不查 withdraw `status`**；submit 幂等恒 `{ok:true}`。
- **A 收敛不做**（业主 2026-08-07）：不碰 `toCustomerWithdrawView` 的 `status`/`completedAt` 输出、不动 bucket/status 查询参数——只加 `actions` 开口。
- 文案统一 `Document request {seq}`；不做 postMessage 协议；`seq` 一旦分配不再变。
- 镜像源以充值**当前 main 代码**为准（不是它的历史版本）；充值域文件除非编译强制，一律不改。
- 每 Task 完成：`npx tsc --noEmit` 0 + 涉及模块 jest 绿 + client-web build 0（前端任务）+ commit。全量 jest 基线：4 个 asset-treasury/wallets 失败是既存，净新 0。
- 审计常量新增三个：`WITHDRAW_ACTION_REISSUED` / `WITHDRAW_AWAITUSER_EMPTY_ACTIONS` / `WITHDRAW_ACTION_SUBMITTED`（`audit-actions.constant.ts` WITHDRAW 组，注意 `audit-logs.service.spec.ts` 冻结分类快照测试要同步扩条目）。

---

### Task 1: 子表迁移 + WithdrawApplicantActionsService

**Files:**
- Modify: `prisma/schema.prisma`（新 model `WithdrawApplicantAction` + `WithdrawTransaction.actionSubmittedAt DateTime?` + `applicantActions` 关系）
- Create: `prisma/migrations/<ts>_withdraw_applicant_actions/migration.sql`（纯增量：CREATE TABLE + ALTER ADD COLUMN）
- Create: `src/modules/trading/withdraw-transactions/withdraw-applicant-actions.service.ts`
- Test: `withdraw-applicant-actions.service.spec.ts`

**Interfaces:**
- Mirror source（逐方法镜像，父 id 换 `withdrawTransactionId`）: `src/modules/trading/deposit-transactions/deposit-applicant-actions.service.ts` —— `syncApplicantActions(withdrawId, actions: Array<{applicantActionId, externalActionId}>, opts)` / `hasOutstanding(withdrawId)` / `findBySeq(withdrawId, seq)` / `submitBySeq(withdrawId, seq)` 返回 `{changed, allSubmitted}` / `clearWithdrawCache(withdrawId, slaDeadline)`（充值名 `clearDepositCache` 换名）。
- Prisma model 逐字段镜像 `DepositApplicantAction`（schema.prisma:1890-1906）：`applicantActionId`/`externalActionId`/`seq`/`submittedAt` + `@@unique([withdrawTransactionId, applicantActionId])` + `@@unique([withdrawTransactionId, seq])` + `@@index` + `@@map("withdraw_applicant_actions")`。
- Produces（后续任务依赖）: 上述五方法签名；`submitBySeq` 内部盖 `withdraw.actionSubmittedAt` 的「全部交齐」唯一判定点。

- [ ] **Step 1**: schema + migration（`npx prisma generate`；迁移在 scratch db `DATABASE_URL=file:/tmp/t1.db npx prisma migrate deploy` 实跑验证）
- [ ] **Step 2**: 失败测试先行——镜像充值 spec 文件的用例集（集合比对三分支/seq 追加不重排/空 externalActionId 丢弃/P2002 重读幂等/submitBySeq 幂等+全部交齐时序/已提交行保留）
- [ ] **Step 3**: 实现 service（$transaction 包同步；P2002 catch 重读一次）
- [ ] **Step 4**: `npx jest src/modules/trading/withdraw-transactions --silent` 绿 + tsc 0
- [ ] **Step 5**: Commit `feat(withdraw): 补料子表withdraw_applicant_actions+集合同步服务`

### Task 2: applyKytAwaitUser 接线 + 零行 guard + 审计常量

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（`applyKytAwaitUser()` ~line 2337）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（三常量）+ `audit-logs.service.spec.ts`（快照扩条目）
- Modify: `src/modules/withdraw-sumsub/withdraw-kyt-verdict.handler.ts`（若 detailRaw 里的 `applicantActions[]` 尚未透传给 workflow——对照充值 handler→workflow 的传递方式，镜像）
- Test: `withdraw-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 五方法。
- Mirror source: 充值 `deposit-workflow.service.ts → applyKytAwaitUser()` 现行实现（集合同步调用点 + 零未提交行 guard + 同状态重入清缓存/REISSUED 审计 + 跨状态弧清缓存）。
- 行为定稿：同步后零未提交行 → **不进/不停留** `ACTION_PENDING`（已在则维持现状不再重置 SLA），审计 `WITHDRAW_AWAITUSER_EMPTY_ACTIONS`（warn 级）；集合有变且已在 `ACTION_PENDING` → `clearWithdrawCache()` + `WITHDRAW_ACTION_REISSUED`；`manualReason`/`slaDeadline` 原子写保持现状不动。

- [ ] **Step 1**: 失败测试（首次 awaitUser 建行进 ACTION_PENDING；重复 webhook no-op；REISSUED 清缓存；零行 guard 不进态；MANUAL_CHECKING→ACTION_PENDING 弧清缓存；FROZEN no-op 保持）
- [ ] **Step 2**: 实现 + handler 透传核对
- [ ] **Step 3**: 绿 + tsc 0；**Step 4**: Commit `feat(withdraw): awaitUser改集合同步+零行guard+REISSUED`

### Task 3: 会话接口 + actions 白名单开口 + byNo 客户详情

**Files:**
- Create: `src/modules/trading/withdraw-transactions/withdraw-verification-session.service.ts`
- Modify: `src/modules/trading/withdraw-transactions/customer-withdraw.controller.ts`（三条新路由）+ `withdraw-transactions.module.ts`（providers）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`（`toCustomerWithdrawView` 加 `actions` 两键开口 + include 关系 + `findOneForCustomerByWithdrawNo(withdrawNo, customerId)`）
- Test: `withdraw-verification-session.service.spec.ts` + 白名单泄露单测扩展

**Interfaces:**
- Mirror source: `deposit-verification-session.service.ts`（`mustFindOwn`/`getSession`/`submit`；`SUMSUB_ACTION_LEVEL` env 常量与 `PROVIDER_REVIEW_SLA_DAYS=7` 同款；`sumsubClient.createActionSdkToken({applicantId, levelName, externalActionId})`——注入与充值同一个 onboarding SumsubClient provider，查充值 module 的注入方式照抄）。提现 `mustFindOwn` 条件 `{withdrawNo, ownerId}`（无 limitHoldReason——提现无 below-min 隐藏）。
- 新路由（**声明顺序：两条 :seq 路由在前**）：`GET my/:withdrawNo/verification-session/:seq` / `POST my/:withdrawNo/verification-session/:seq/submit` / `GET my/:withdrawNo`（byNo 详情，供独立页；现有 `GET :id` 保留）。客户 JWT 鉴权，无 RBAC 登记。
- Produces: 会话响应 `{submitted: boolean, sdkToken: string|null}` 仅两键；`actions` 开口 `[{seq, submittedAt}]`。
- 泄露单测扩展：mock 行带全量 action 字段，断言客户响应 actions 内**只有** seq/submittedAt 两键、无顶层 actionSubmittedAt。

- [ ] **Step 1**: 失败测试（IDOR 404 同款/seq 不存在=同 404/已交 submitted:true/无 applicant sdkToken:null/铸 token 参数断言/submit 幂等 ok:true/FROZEN 下 GET 与 ACTION_PENDING 逐字段全等/白名单）
- [ ] **Step 2**: 实现 service + controller + 开口；**Step 3**: 绿 + tsc 0；**Step 4**: Commit `feat(withdraw): verification-session接口+actions白名单开口+byNo详情`

### Task 4: client 详情独立页（C）

**Files:**
- Create: `client-web/src/pages/WithdrawDetail.tsx`
- Modify: `client-web/src/App.tsx`（`/withdraw/:withdrawNo` 路由，镜像 App.tsx:49 的 deposit 注册行）
- Modify: `client-web/src/pages/Withdraw.tsx`（History 的 Details 按钮改 `navigate('/withdraw/'+tx.withdrawNo)`；删详情弹窗 selectedTx/renderStatusDetail 及其状态）

**Interfaces:**
- Mirror source: `client-web/src/pages/DepositDetail.tsx`（页面骨架/字段卡/`Outstanding verification` 卡片显隐 `status.toUpperCase()==='ACTION_PENDING' && actions.length>0`/逐条 `Document request {seq}`/按钮恒渲染按自身 submittedAt disabled/navigate 到 verification/:seq）。
- 数据源：Task 3 的 `GET my/:withdrawNo`。状态徽章继续走 `getWithdrawStatusView`（单参纯查表，不引入任何 submitted 短路）。

- [ ] **Step 1**: 实现页面 + 路由 + 弹窗删除；**Step 2**: `cd client-web && npx tsc --noEmit && npm run build` 0 错；相关 spec（withdrawStatusView.spec 等）不回归；**Step 3**: Commit `feat(withdraw-client): 详情独立页/withdraw/:withdrawNo 替代弹窗`

### Task 5: client 认证独立页（B 前端）

**Files:**
- Create: `client-web/src/pages/WithdrawVerification.tsx`
- Modify: `client-web/src/App.tsx`（`/withdraw/:withdrawNo/verification/:seq` 路由）

**Interfaces:**
- Mirror source: `client-web/src/pages/DepositVerification.tsx`（四态互斥渲染①submitted 静态文案②error 重试③demo loading④demo `MockUploader`/真接 `#sumsub-container`+`window.snsWebSdk.init(token, refreshToken)` 事件接线；`useSimulationMode()` 分流；doSubmit 成功 navigate 回详情、失败留原地）。fetch 路径换 `client/withdraw-transactions/my/:withdrawNo/verification-session/:seq`。

- [ ] **Step 1**: 实现（含 MockUploader 组件镜像——若充值的是页面内嵌组件则同样内嵌，不建独立路由）；**Step 2**: build/tsc 0；**Step 3**: Commit `feat(withdraw-client): 认证独立页四态渲染 demo/真接分支`

### Task 6: fixtures + e2e 四条 + truth/BACKLOG 收官

**Files:**
- Modify: `src/modules/withdraw-sumsub/fixtures/verdict-buttons.ts`（②③ awaitUser 报文补 `applicantActions[]` 含 externalActionId；加多条 action fixture——镜像充值 fixtures 的现行形状 `txn-report.builder.ts`）
- Modify: `src/modules/withdraw-sumsub/demo-scenario.service.ts`（若报文构造处需透传 applicantActions——对照充值 demo service 现行）
- Modify/Create: `test/withdraw-sumsub-scenarios.e2e-spec.ts` 扩展（四条：补料完整弧状态不动+缓存时序 / 单条不可区分（ACTION_PENDING vs FROZEN 会话响应全等）/ 多条全部交齐时序 / 逐条不可区分）
- Modify: `doc-final/reference/truth/v5-withdraw.md`（新 §4.6-式小节 + §9/§10 同步 + Last Verified 追加）+ `doc-final/BACKLOG.md`（登记：admin 子表视图两域一起后置（若充值条目已在则并列提现）；snsWebSdk script 两域同缺提现并列）

**Interfaces:**
- Mirror source: `test/deposit-sumsub-verdicts.e2e-spec.ts` 的四条补料用例结构 + 充值 fixtures 的 applicantActions 形状。
- e2e 前置：worktree self 栈 TB（同前轮惯例）；地址种子问题沿用 withdraw-money-arcs e2e 的 prisma 直插手法。

- [ ] **Step 1**: fixtures 红→绿（handler/demo 单测同步）
- [ ] **Step 2**: e2e 四条红→绿（`npx jest --config test/jest-e2e.json --runInBand --testPathPatterns=withdraw-sumsub-scenarios`）
- [ ] **Step 3**: 全量 `npx jest --silent` 净新 0 + tsc 0 + 双端 build 0
- [ ] **Step 4**: truth/BACKLOG 重写同步
- [ ] **Step 5**: Commit `feat(withdraw): 补料Embed收官——fixtures+e2e四条+truth同步`
