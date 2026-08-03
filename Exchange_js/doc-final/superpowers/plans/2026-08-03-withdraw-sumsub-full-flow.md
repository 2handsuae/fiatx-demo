# 提现 Sumsub 全流转升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提现域从 mock 合规升级为真 Sumsub 单笔提交 + webhook 驱动的 10 态 20 边状态机，四条异常弧（冻结/退回/费腿卡死/退汇）全闭环。

**Architecture:** 镜像 `deposit-sumsub/` 建 `withdraw-sumsub/`（岔口1·乙），sumsub-ingestion 分发层加"先查 deposit 再查 withdraw"薄共享；状态机先重写（A），Sumsub 引擎接上后一刀退役老 mock（B 末）；资金腿硬化与 FROZEN 双审批弧并行（C/D）；前端照充值 9 区块 + 脱敏收敛（E）；e2e + 真机渲染收官（F）。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle + React（admin-web/client-web）+ jest/e2e。

**Spec:** `doc-final/superpowers/specs/2026-07-25-withdraw-sumsub-compliance-flow-design.md`（v2 2026-08-03）

## Global Constraints

- 状态机定稿：**10 状态 / 20 边**（spec §5 逐条），终态必须回答「钱去哪了」；无 CREATED/CANCELLED/UNDER_REVIEW/HELD（转历史兼容值，转移表不再出现）。
- 唯 KYT `Approved` 可跨不可逆线（进 PAYOUT_PENDING）；`Created/OnHold/AwaitingUser` 一律押住。
- onHold 非转移边：只刷 `slaDeadline` + 审计。STUCK 非状态：`needsReview` 旗 + `*_STUCK` 审计。
- webhook 类型集合复用 `src/modules/deposit-sumsub/kyt-webhook-types.ts`（⚠️ `applicantKytOnHold` 无 `Txn`）。
- 幂等：按 `kytTxnId + verdict` 抗重投；handler state-aware 已终态 no-op；FROZEN 上迟到 approved 跳过证据回写。
- TR 阈值沿用 `resolveKytTxnType`（USDT=1000/AED=3500 写死）；`SUMSUB_SINGLE_TXN_SUBMIT` 开关语义同充值（MOCK_MODE 隐含开启）。
- 每条持久状态变更写 `AuditLogsService`（DI）；多表变更 `prisma.$transaction`；workflow 不直写他域表（Rule 1/2/5）。
- 每个 Task 结束：`npx tsc --noEmit` 0 错 + 涉及模块 jest 绿 + commit。改代码必须同步 `doc-final/reference/truth/v5-withdraw.md`（F 段统一重写，各段先在 commit message 记账）。
- 老状态字符串迁移映射：`PENDING_COMPLIANCE→COMPLIANCE_PENDING`、`UNDER_REVIEW→MANUAL_CHECKING`、`HELD→FROZEN`（数据 UPDATE，Task 3 迁移一并做）。

---

### Task 1 (A): 状态机重写——枚举 + 转移表 + 守则性测试

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto.ts`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`（`transitions` 表整体替换）
- Test: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts`

**Interfaces:**
- Produces: `WithdrawTransactionStatus`（10 值）/ `WithdrawTransactionAction`（新增 `ACTION_PENDING/KYT_REJECTED/SLA_BREACH/FREEZE/REJECT_REFUND/RESUME`）；`transitions` 20 边——后续所有 Task 的 `updateStatus(id, {action}, ctx)` 都落在这张表上。

- [ ] **Step 1: 写守则性失败测试**（逐边 + 穷举反向 + 总数断言，照抄充值 `deposit-transactions.service.spec.ts` 的写法）

```typescript
// withdraw-transactions.service.spec.ts 新 describe
const EDGES: Array<[WithdrawTransactionStatus, WithdrawTransactionAction, WithdrawTransactionStatus]> = [
  ['PENDING_APPROVAL','gate_approve','COMPLIANCE_PENDING'], ['PENDING_APPROVAL','reject','REJECTED'],
  ['COMPLIANCE_PENDING','approve','PAYOUT_PENDING'], ['COMPLIANCE_PENDING','action_pending','ACTION_PENDING'],
  ['COMPLIANCE_PENDING','kyt_rejected','MANUAL_CHECKING'], ['COMPLIANCE_PENDING','sla_breach','MANUAL_CHECKING'],
  ['COMPLIANCE_PENDING','freeze','FROZEN'],
  ['ACTION_PENDING','approve','PAYOUT_PENDING'], ['ACTION_PENDING','kyt_rejected','MANUAL_CHECKING'],
  ['ACTION_PENDING','freeze','FROZEN'], ['ACTION_PENDING','sla_breach','MANUAL_CHECKING'],
  ['MANUAL_CHECKING','approve','PAYOUT_PENDING'], ['MANUAL_CHECKING','action_pending','ACTION_PENDING'],
  ['MANUAL_CHECKING','freeze','FROZEN'], ['MANUAL_CHECKING','reject_refund','REJECTED'],
  ['FROZEN','resume','COMPLIANCE_PENDING'], ['FROZEN','reject_refund','REJECTED'],
  ['PAYOUT_PENDING','success','SUCCESS'], ['PAYOUT_PENDING','fail','FAILED'], ['PAYOUT_PENDING','return','RETURNED'],
] as any;
it('has exactly the 20 spec edges', () => { /* 逐条 getNextStatus(=暴露 transitions 的测试口) 断言 + 计数 === 20 */ });
it('rejects every (status,action) pair not in the edge list', () => { /* 10×全动作 穷举，不在 EDGES 的组合断言 throw */ });
```

- [ ] **Step 2: 跑测试确认红**（`npx jest src/modules/trading/withdraw-transactions --silent`，期望 FAIL：新枚举值不存在）
- [ ] **Step 3: 改枚举**——`WithdrawTransactionStatus` 收敛为 `PENDING_APPROVAL/COMPLIANCE_PENDING/ACTION_PENDING/MANUAL_CHECKING/FROZEN/PAYOUT_PENDING/SUCCESS/REJECTED/FAILED/RETURNED`（`CREATED/CANCELLED/UNDER_REVIEW/HELD/APPROVED/PENDING_COMPLIANCE` 删除；文件头注释注明历史值仅存于旧行）；`WithdrawTransactionAction` 删 `CHECK/FLAG/CANCEL`，加 `ACTION_PENDING='action_pending'/KYT_REJECTED='kyt_rejected'/SLA_BREACH='sla_breach'/FREEZE='freeze'/REJECT_REFUND='reject_refund'/RESUME='resume'`。
- [ ] **Step 4: 重写 `transitions` 表为 20 边**（严格按 Step 1 的 EDGES；`TERMINAL` 集合 = SUCCESS/REJECTED/FAILED/RETURNED，零出边——删掉现表里 SUCCESS→RETURNED、终态自环 for-logging 边）。
- [ ] **Step 5: 修编译报错的调用点**（`CHECK/CANCEL/FLAG` 引用处：`customer-withdraw.controller.ts` 删客户 cancel 端点；`withdraw-transactions.controller.ts` 的 Admin action 枚举同步；`withdraw-workflow.service.ts` 中 `CHECK` 出现点先临时改为 no-op 注释，Task 2 收拾）。
- [ ] **Step 6: 跑测试确认绿 + `npx tsc --noEmit` 0 错**
- [ ] **Step 7: Commit** `feat(withdraw): 状态机重写 10态20边 + 守则性测试`

### Task 2 (A): 出生即着陆——删 CREATED 流转

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（`createWithdrawal()` / `handleWithdrawalCreated()` / `openApprovalGate()`）
- Test: `withdraw-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 枚举。
- Produces: `createWithdrawal()` 落库 `status` 直接为 `PENDING_APPROVAL` 或 `COMPLIANCE_PENDING`（估值与分路挪进创建事务后同一事件级联内完成）；`WITHDRAWAL_CREATED` 事件 payload 不变。

- [ ] **Step 1: 失败测试**——`createWithdrawal` 后（事件级联跑完）状态 ∈ {PENDING_APPROVAL, COMPLIANCE_PENDING}，且 ≥20万 AED 单挂了审批案、<阈值单进合规。
- [ ] **Step 2: 实现**——`insertRecord` 初始 status 改 `COMPLIANCE_PENDING`（暂定着陆位）；`handleWithdrawalCreated` 改为：估值 → `shouldRequireApproval` 命中则 `openApprovalGate`（内部动作 `REQUIRE_APPROVAL` 改为直接 `linkApprovalCase` + `updateStatus` 用新入口约定：插入时即 status，approval 场景由 `openApprovalGate` 把 `COMPLIANCE_PENDING` 行改写为 `PENDING_APPROVAL`——**注意**：此处是唯一一次"倒退"写，走 prisma 直改 + statusHistory 追加 + 审计，不走转移表（转移表无此边，出生分路不是业务转移）；失败留在 `COMPLIANCE_PENDING` 但**不提交 Sumsub**（提交动作在 Task 5 才接，且以"非 PENDING_APPROVAL"为门）。
- [ ] **Step 3: 绿 + tsc 0 错**；**Step 4: Commit** `feat(withdraw): 删CREATED 出生即着陆两入口`

### Task 3 (B): schema 七列迁移 + 地址登记校验 + VASP 推导

**Files:**
- Modify: `prisma/schema.prisma`（WithdrawTransaction）
- Create: `prisma/migrations/<ts>_withdraw_sumsub_single_txn/migration.sql`（SQLite 整表重建，照充值 §4.5 迁移法）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（`createWithdrawal()` 加地址校验+推导）
- Test: `withdraw-workflow.service.spec.ts`

**Interfaces:**
- Produces: 新列 `sumsubTxnId String? @unique` / `sumsubTxnType String?` / `sumsubVerdict String?` / `sumsubScore Int?` / `sumsubScoredAt DateTime?` / `sumsubTxnDetailJson String?` / `counterpartyIsVasp Boolean?` / `manualReason String?` / `slaDeadline DateTime?` / `slaBreached Boolean @default(false)` / `needsReview Boolean @default(false)` / `feeSettleAttempts Int @default(0)`；删列 `preKytStatus/preKytId/preKytRiskScore/preKytCheckedAt/kytStatus/kytScreeningId/kytRiskScore/kytCheckedAt/travelRuleRequired/travelRuleStatus/travelRuleTransferId/travelRuleCheckedAt/counterpartyVasp`。
- 数据迁移：老行 `status` 值 UPDATE 映射（Global Constraints）；`sumsubTxnId←NULL`。

- [ ] **Step 1: 失败测试**——crypto 提现创建：`toAddress` 未登记/非 ACTIVE → 抛 `WITHDRAWAL_ADDRESS_NOT_REGISTERED`（BadRequest）；已登记 `addressType='VASP'` → 落 `counterpartyIsVasp=true`；BANK(法币) → `counterpartyIsVasp=null`。
- [ ] **Step 2: schema 改 + migration**（整表重建 CREATE new→INSERT SELECT 逐列→DROP→RENAME；status 值映射 CASE WHEN）。`npx prisma generate`。
- [ ] **Step 3: `createWithdrawal()` 实现**——crypto 且 `toAddress` 时查 `withdrawalAddress.findFirst({where:{customerId:userId, address:toAddress, status:'ACTIVE'}})`，miss 即抛；命中取 `addressType==='VASP'` 落 `counterpartyIsVasp`（fiat/`toIban` 路径同理查 BANK 地址，`counterpartyIsVasp` 恒 null）。
- [ ] **Step 4: 绿 + tsc**；**Step 5: Commit** `feat(withdraw): sumsub七列迁移+提现地址登记硬校验+VASP推导`

### Task 4 (B): withdraw-sumsub 模块骨架 + 双域分发薄层

**Files:**
- Create: `src/modules/withdraw-sumsub/withdraw-webhook.router.ts` / `withdraw-kyt-verdict.handler.ts` / `withdraw-sumsub.module.ts`
- Modify: `src/modules/deposit-sumsub/deposit-webhook.router.ts` + `deposit-kyt-verdict.handler.ts`（`route()/handle()` 返回 `boolean`：命中 deposit=true，orphan=false——唯一触碰充值的小改）
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts:128` 附近（分流改级联）
- Test: `src/modules/withdraw-sumsub/withdraw-kyt-verdict.handler.spec.ts`

**Interfaces:**
- Consumes: `KYT_VERDICT_TYPES`/`KYT_ONHOLD_TYPE`（deposit-sumsub 复用不复制）；`SUMSUB_TXN_CLIENT`/`SumsubTxnClient`；Task 3 的 `findBySumsubTxnId`（在 `withdraw-transactions.service.ts` 新增，签名 `findBySumsubTxnId(txnId: string): Promise<WithdrawTransaction|null>`）。
- Produces: `WithdrawKytVerdictHandler.handle(payload): Promise<boolean>`；`applyKytVerdict(withdrawId, {verdict, riskScore, sceneTag?, dispoTag?, detailRaw?})` 契约（Task 5 实现）。

- [ ] **Step 1: 失败测试**——handler：四态归一（含 `applicantKytOnHold` 无 Txn）；`rejected/awaitUser` 才读 tag（onHold fixture 塞 `FROZEN_BY_MLRO` 断言不被解析）；orphan 返 false；处置 tag 集合 = `{FROZEN_BY_MLRO, REJECT_REFUND}`（**与充值不同**）。
- [ ] **Step 2: 实现**——handler 照抄 `deposit-kyt-verdict.handler.ts` 结构，改：查 `withdrawService.findBySumsubTxnId`、`DISPO_TAGS = new Set(['FROZEN_BY_MLRO','REJECT_REFUND'])`、回调 `withdrawWorkflow.applyKytVerdict`（Task 5 前先打 stub 接口）。ingestion 分流：`if (KYT_VERDICT_TYPES.has(type)) { const hit = await this.depositWebhookRouter.route(p); if (!hit) await this.withdrawWebhookRouter.route(p); return; }`；withdraw router orphan 才 warn。
- [ ] **Step 3: 绿 + tsc（deposit-sumsub spec 同跑不回归）**；**Step 4: Commit** `feat(withdraw-sumsub): 模块骨架+双域webhook分发薄层`

### Task 5 (B): submitSumsubTxns + applyKytVerdict + SLA cron + 老 mock 退役

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（新增 `submitSumsubTxn()/applyKytVerdict()` 及 `applyKyt{Approved,Rejected,AwaitUser,OnHold}` 私有分支；删 `initializeTransactionScreen()/checkScreenPass()/handleKytUpdated()/handleTravelRuleUpdated()/handlePostBroadcastKyt()`）
- Create: `src/modules/withdraw-sumsub/withdraw-sla.service.ts`（照 `deposit-sla.service.ts`：cron 5min 扫 `COMPLIANCE_PENDING/ACTION_PENDING` 超 `slaDeadline` → `SLA_BREACH`）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.controller.ts`（删 simulate kyt/tr 端点）
- Test: `withdraw-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 转移表、Task 3 七列、Task 4 handler 契约、`resolveKytTxnType`（import 自 deposit-sumsub）、`SumsubTxnClient.submitTxn`（`direction` 类型放宽为 `'in'|'out'`——interface + http/mock 三处同步）。
- Produces: `applyKytVerdict` 全分支落 Task 1 的边：approved→（大额门早已过）`APPROVE`→PAYOUT_PENDING 即现有 `initiatePayoutPhase()`；awaitUser→`ACTION_PENDING`（manualReason 按 PEP tag、slaDeadline+7d 原子写）；onHold→不换态刷 SLA+审计 `WITHDRAW_ONHOLD`（仅 COMPLIANCE_PENDING 生效）；rejected→tag 三分支（SANCTION/FROZEN_BY_MLRO→`FREEZE`；REJECT_REFUND→`REJECT_REFUND`+`releaseLock()`；无 tag→`KYT_REJECTED`）。FROZEN 迟到 approved：跳过回写+存证 no-op。

- [ ] **Step 1: 失败测试**（分支全覆盖：approved 从 COMPLIANCE/ACTION/MANUAL 三态放行、FROZEN no-op 且不覆写 detailJson、rejected 三分支、onHold 守卫、幂等重投 no-op、submit 判定器 travelRule 命中）
- [ ] **Step 2: 实现 submit**——进 COMPLIANCE_PENDING（gate_approve 后 & 出生低于阈值路径）调 `submitSumsubTxn()`：`resolveKytTxnType({assetType, currency, amount: Number(w.amount), counterpartyIsVasp: w.counterpartyIsVasp})`；`clientTxnId = withdrawNo`；`direction:'out'`；开关语义同充值（`SUMSUB_SINGLE_TXN_SUBMIT`/`SUMSUB_MOCK_MODE`）；**全程 try/catch**（I2：失败 warn 留 COMPLIANCE_PENDING 不 strand）；幂等判 `sumsubTxnId` 已存在；审计 `WITHDRAW_SUMSUB_SUBMITTED`（metadata 带 txnType/reason）。
- [ ] **Step 3: 实现 applyKytVerdict 四分支 + SLA service**（审计常量新增：`WITHDRAW_SUMSUB_SUBMITTED/WITHDRAW_ONHOLD/WITHDRAW_SLA_BREACHED/WITHDRAW_MANUAL_APPROVED/WITHDRAW_FROZEN/WITHDRAW_REFUNDED_BY_TAG` 于 `audit-actions.constant.ts`）
- [ ] **Step 4: 退役老 mock**——删五个老 handler/端点 + `checkScreenPass`；grep 确认 `preKyt|travelRuleStatus` 后端零引用。
- [ ] **Step 5: 绿 + tsc + demo 冒烟**（`bash scripts/on-stack.sh main demo:withdraw` 仍 SUCCESS——mock client 下判定器隐含开启）；**Step 6: Commit** `feat(withdraw): 真Sumsub单笔提交+verdict驱动+SLA+老mock退役`

### Task 6 (C): 费腿顺序守卫 + 失败三级梯

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（`handleFundsOrderChanged()/onFeeLegConfirmed()/新增 onFeeLegFailed()/settleFeeRetry()`）
- Test: `withdraw-workflow.service.spec.ts`

**Interfaces:**
- Consumes: `FundsOrderService.create/advance/findByParent`；`voidPendingTransferBestEffort`；Task 3 `feeSettleAttempts/needsReview` 列。
- Produces: 顺序守卫——`onFeeLegConfirmed` 开头查本金腿（legSeq=1）状态 ∈ {CONFIRMED, CLEARED} 才结算，否则 log+return（不结不抛）；`onPayoutLegConfirmed` 末尾补一次"费腿已 CONFIRMED 且未结算则补结算"回捞。`onFeeLegFailed`（FAILED/TIMEOUT legSeq=2）：本金未终局→void 该费腿资金单+重建新 attempt（≤3）；结算段失败→`feeSettleAttempts+1`，=3 时置 `needsReview=true`+审计 `WITHDRAW_FEE_SETTLE_STUCK`，单留 PAYOUT_PENDING。

- [ ] **Step 1: 失败测试**（费先于本金到 CONFIRMED → 不结算；本金 post 后回捞结算；费腿 FAILED×3 → STUCK 旗+审计+状态仍 PAYOUT_PENDING；`already_posted` 重跑自愈）
- [ ] **Step 2: 实现**（`handleFundsOrderChanged` FAILED/TIMEOUT 分支加 `legSeq===FEE_LEG_SEQ → onFeeLegFailed`——堵现状零 handler 缺口）
- [ ] **Step 3: 绿 + tsc**；**Step 4: Commit** `feat(withdraw): 费腿顺序守卫+失败三级梯(重试→STUCK旗) 堵零handler缺口`

### Task 7 (C): RETURNED 退汇入口 + L3 归档真调用 + 腿收口

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.controller.ts`（新端点 `POST :id/bounce`，admin，reason 必填）
- Modify: `withdraw-workflow.service.ts`（`onBounce()` + `archivePostKyt()` 换真）
- Modify: `src/modules/deposit-sumsub/sumsub-txn-client.{interface,http,mock}.ts`（接口加 `archiveTxHash(txnId: string, txHash: string): Promise<void>`；http=PATCH `/kyt/txns/{id}/data/info`，mock=no-op）
- Test: `withdraw-workflow.service.spec.ts`

**Interfaces:**
- Produces: `onBounce(withdrawId, reason)`——守卫 `status===PAYOUT_PENDING && 本金已 post`；反向分录 `executeTransfer(DR CLIENT_ASSET → CR CLIENT_PAYABLE, net)` 重入账 + `updateStatus(RETURN)` → RETURNED + 审计 `WITHDRAW_BOUNCED`。**费不退**（银行退汇手续费照收——决策记 spec 待补注，审计 reason 写明）。`archivePostKyt` 改调 `sumsubTxnClient.archiveTxHash(w.sumsubTxnId, w.txHash)`（fire-and-forget catch warn 不变）。

- [ ] **Step 1: 失败测试**（bounce 非 PAYOUT_PENDING 拒；成功路径反向分录+RETURNED；archive 调用断言）
- [ ] **Step 2: 实现**；**Step 3: 绿 + tsc**；**Step 4: Commit** `feat(withdraw): 退汇bounce入口+L3归档真调用`

### Task 8 (D): FROZEN 双审批门（发起侧）

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（`WITHDRAW_UNFREEZE`/`WITHDRAW_SANCTION_REFUND` actionType + policy 条目：均 MLRO 单步 48h）
- Create: `src/modules/trading/withdraw-transactions/withdraw-unfreeze-approval.service.ts` + `withdraw-sanction-refund-approval.service.ts`（照 `deposit-unfreeze-approval.service.ts` 模板：extends `ApprovalHandlerBase`，四常量）
- Modify: `withdraw-transactions.controller.ts`（`POST :id/unfreeze` / `POST :id/refund`，orderRef/reason 必填）+ `withdraw-workflow.service.ts`（`initiateUnfreeze()/initiateRefund()`：只读校验 `status===FROZEN` + 防重复 PENDING + 开审批 case，不写单表）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（两端点登记权限 + `db:base:sync` + 重启提示）
- Test: `withdraw-workflow.service.spec.ts`

**Interfaces:**
- Produces: 审批 case `entityRef=withdraw.id`，`objectSnapshot` 含 `orderRef/withdrawNo`；decided 事件名 `workflow.withdraw-unfreeze.decided` / `workflow.withdraw-sanction-refund.decided`（Task 9 消费）。

- [ ] **Step 1: 失败测试**（非 FROZEN 拒；重复 PENDING 拒 Conflict；快照含 orderRef）
- [ ] **Step 2: 实现 + RBAC 登记**；**Step 3: 绿 + tsc**；**Step 4: Commit** `feat(withdraw): FROZEN双审批门(WITHDRAW_UNFREEZE/WITHDRAW_SANCTION_REFUND)发起侧`

### Task 9 (D): 审批执行侧——解冻回炉 + 坐实退回

**Files:**
- Modify: `withdraw-workflow.service.ts`（`onUnfreezeDecided()/onUnfreezeApproved()/onRefundDecided()/onRefundApproved()/fetchApprovedOrderRef()`）
- Test: `withdraw-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 8 decided 事件；`releaseLock()`（现有 P6 原语）；`SumsubTxnClient.rescore`。
- Produces: `onUnfreezeApproved`——守卫 FROZEN → `fetchApprovedOrderRef('WITHDRAW_UNFREEZE')`（`ApprovalDecidedEvent.metadata` 恒空，从 APPROVED 案 objectSnapshot 回读，取不到抛）→ `updateStatus(RESUME)` → COMPLIANCE_PENDING → 审计 `WITHDRAW_UNFROZEN`（带 orderRef）→ `rescore(sumsubTxnId)` try/catch 失败仅 warn（充值 A5 同款；空 txnId 跳过）。`onRefundApproved`——守卫 FROZEN → `updateStatus(REJECT_REFUND)` → REJECTED → `releaseLock(w, 'Sanction refund approved')`（void 双 pending 解锁）→ 审计 `WITHDRAW_SANCTION_REFUNDED`；客户牵连仅审计留痕（V2 冻户 API 缺失，BACKLOG）。DECLINED/CANCELLED/EXPIRED 只留日志原地不动。

- [ ] **Step 1: 失败测试**（守卫/回读抛/rescore 失败不回滚/refund 后锁已释放断言 void 被调）
- [ ] **Step 2: 实现**；**Step 3: 绿 + tsc**；**Step 4: Commit** `feat(withdraw): 解冻回炉+rescore / 坐实退回+releaseLock 执行侧闭环`

### Task 10 (E): admin 前端——状态映射表 + 详情页 9 区块 + Simulation

**Files:**
- Create: `admin-web/src/utils/withdrawStatusMap.ts`（`getWithdrawStatusMeta` 10 态全量 + `WITHDRAW_STATUS_FILTERS` 分组：`Processing{COMPLIANCE_PENDING,PENDING_APPROVAL}/Action{ACTION_PENDING}/Manual{MANUAL_CHECKING}/Frozen{FROZEN}/Payout{PAYOUT_PENDING}/终态各一`）
- Modify: `admin-web/src/pages/WithdrawTransactionList.tsx`（徽章/筛选改读映射表）+ `WithdrawTransactionDetail.tsx`（照充值 9 区块：Hero/Transaction Details/Compliance 两卡(L1+L2 单份 `sumsubTxnType: sumsubVerdict · Score`)/Sumsub References(Applicant+单 Txn)/Sumsub Transaction Detail(parseDetail 折叠原文)/Internal Approvals(approvalsService.list entityRef 反查)/Linked Funds Orders/Status History/⚡Simulation；FROZEN 态 `Frozen Disposition` 组两按钮 `Initiate Unfreeze`/`Initiate Refund`(orderRef/reason modal)；终态+STUCK `needsReview` 横幅）
- Create: `src/modules/withdraw-sumsub/demo-scenario.service.ts` + `admin-withdraw-demo.controller.ts` + `fixtures/`（`SUMSUB_MOCK_MODE` 门控注册；9 按钮镜像充值 verdict-buttons 去 below-min：①Approved ②AwaitUser ③AwaitUser·PEP ④Rejected·Sanctions ⑤Rejected·MLRO freeze ⑥Rejected·Refund tag ⑦Rejected·no tag ⑧OnHold ⑨Rejected·SLA breach——按 `withdraw.sumsubTxnId` 铸号喂真实 ingest 管道）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`（`findOneForAdmin` 补 `parseDetail(sumsubTxnDetailJson)` + `approvals[]` 反查，照充值 `findOneForAdmin` 写法含 null 设防/verdict 回退 `d.verdict ?? scoringResult.action ?? null`）
- Test: `admin-web` 单测（映射表全态覆盖断言）+ handler spec

- [ ] **Step 1: 映射表 + 单测红→绿**；**Step 2: 详情页区块改造**（tsc + `npm run build` 0 错）；**Step 3: demo service + Simulation 面板**；**Step 4: Commit** `feat(withdraw-admin): 状态映射表+详情页9区块+Frozen处置组+Simulation面板`

### Task 11 (E): client 脱敏 + 白名单裁剪

**Files:**
- Create: `client-web/src/utils/withdrawStatusView.ts`（`getWithdrawStatusView`：`FROZEN/MANUAL_CHECKING` 与 `COMPLIANCE_PENDING` **逐字段一致** `{label:'PROCESSING',tone:'neutral'}` 无 note——充值 2026-08-02 口径；`ACTION_PENDING→ACTION REQUIRED`；`PAYOUT_PENDING→PROCESSING`；终态四态各自文案；`RETURNED→'Funds returned to your account'`）
- Modify: `client-web/src/pages/Withdraw.tsx`（删本地映射改读 view；历史筛选分组同步）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`（`findAllForCustomer/findOneForCustomer` 经新增 `toCustomerWithdrawView()` 白名单：`id/withdrawNo/status/amount/feeAmount/netAmount/createdAt/completedAt/txHash/referenceNo/toAddress/toIban/asset{currency,code,network,decimals}`——`sumsubtxn*/manualReason/slaDeadline/needsReview/statusHistory` 全裁掉）
- Test: `withdrawStatusView.spec.ts`（违禁词 `/sanction|seiz|frozen|freeze|manual|compliance/i` 全态零命中 + FROZEN/MANUAL view `toEqual(COMPLIANCE_PENDING view)`）+ 白名单泄露单测（mock 全列断言裁剪后不含敏感字段）

- [ ] **Step 1: 红→绿（两组测试）**；**Step 2: build 双端 0 错**；**Step 3: Commit** `feat(withdraw-client): 执法态脱敏PROCESSING收敛+客户面字段白名单`

### Task 12 (F): e2e 收官 + 真机渲染验证 + truth 重写

**Files:**
- Create: `test/withdraw-money-arcs.e2e-spec.ts`（真 AppModule + 真 TB，只 mock SUMSUB_TXN_CLIENT，照 `test/deposit-money-arcs.e2e-spec.ts` 手法）
- Create: `test/withdraw-sumsub-scenarios.e2e-spec.ts`（9 场景走真实 ingest 管道）
- Modify: `doc-final/reference/truth/v5-withdraw.md`（整篇重写为新现状）+ `doc-final/BACKLOG.md`（登记：V2 冻户升级仅审计/SUCCESS 后退汇走对账位/真 VASP 归因/demo:all 无提现地址种子漂移/看门狗①「Created 回执丢单锚」未做——充值同样未做，两域将来一起补）

**e2e 场景清单（money-arcs）：**
1. happy crypto：approved→PAYOUT→两腿 post→SUCCESS，`assertWithdrawSettled` 过，费腿 CLEARED；
2. 本金腿 FAILED→整单 FAILED+双 void（TB 余额断言回滚）；
3. 费腿 FAILED×3→STUCK 旗+仍 PAYOUT_PENDING→修复重跑→SUCCESS；
4. sanctions→FROZEN→unfreeze 审批→COMPLIANCE_PENDING+rescore 被调→approved→SUCCESS；
5. sanctions→FROZEN→refund 审批→REJECTED+锁释放（可用余额恢复断言）；
6. bounce：PAYOUT_PENDING post 后→RETURNED+反向分录。

- [ ] **Step 1: e2e 红→绿逐场景**（`npx jest --config test/jest-e2e.json --runInBand`）
- [ ] **Step 2: `bash scripts/on-stack.sh self verify:coa`** 期望 `ALL INVARIANTS PASS`（在真实 POST 之后跑）
- [ ] **Step 3: 真机渲染验证（Task-8 式）**——worktree self 栈 `SUMSUB_MOCK_MODE=true`：Simulation 面板逐场景喂料，浏览器截图核实 admin 全状态徽章/Frozen 处置组/STUCK 横幅；client 侧同客户登录截图证零 sanction/frozen 字样泄露
- [ ] **Step 4: truth v5-withdraw.md 整篇重写 + BACKLOG 登记**
- [ ] **Step 5: 全量 `npx jest` 净新增失败 0 + tsc 0 错 + Commit** `feat(withdraw): e2e收官+truth同步——全流转升级完成`
