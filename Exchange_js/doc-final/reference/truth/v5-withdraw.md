# V5 提现流程 — 当前实现真相

Last Verified: 2026-07-03（核对方式：三路 subagent 逐条走查 + 主线抽验 payout 端点/tipping-off/FROZEN/fundOut）

> 本文只描述"现在是什么样"。改代码必须同步本文。计划看 roadmap，欠账看 BACKLOG.md。

---

## 0. 一句话定位

客户提现（crypto + fiat 共用一条工作流）：L1 资格 → 大额审批门 → L2 合规筛查 → Payout 执行 → 确认记账 → SUCCESS。**crypto/fiat 共用 `WithdrawWorkflowService`**，差异仅 3 处（TR / L3 / 确认介质）。**不**管：内部转账、Cold→Hot 归集（V7）。

## 1. 状态机

`WithdrawTransactionStatus`（无 FROZEN 态）：
```
CREATED → PENDING_APPROVAL(大额)   → PENDING_COMPLIANCE → PAYOUT_PENDING → SUCCESS
        ↘ PENDING_COMPLIANCE(小额)                      ↘ FAILED / UNDER_REVIEW
PENDING_APPROVAL/COMPLIANCE/PAYOUT_PENDING → REJECTED / CANCELLED（→ releaseLock 解锁）
终态：SUCCESS / FAILED / REJECTED / CANCELLED
```
- 全集：`CREATED / PENDING_APPROVAL / PENDING_COMPLIANCE / UNDER_REVIEW / APPROVED / PAYOUT_PENDING / SUCCESS / FAILED / REJECTED / CANCELLED / RETURNED / HELD`
- 锚点：`withdraw-transaction.dto.ts → WithdrawTransactionStatus` ｜ `withdraw-transactions.service.ts → transitions`

## 2. 数据模型要点

> 📖 资金单状态机 / 共享执行引擎 → [funds-orders.md](funds-orders.md)；记账口径 → [accounting-coa.md](accounting-coa.md)。

- **提现资金单** = `withdrawTransactionId` 非空的 `funds_order`（Payout/InternalFund 已并入 funds_orders）
- **2 腿结构**：leg1 = 本金 payout（`PAYOUT_LEG_SEQ=1`，net 额）；leg2 = 手续费（`FEE_LEG_SEQ=2`，仅费>0 时创建，创建时机 = PAYOUT_PENDING 阶段）。无独立本金跟踪单。
- **大额审批门阈值**：`WITHDRAW_APPROVAL_AED_THRESHOLD = 200000`（AED）——**现役唯一金额闸门**
- **对账 evidence**：NET_POST / FEE_POST / FEE_FIRM 三腿共享同一 `externalRef` + `walletRef`，跨钱包互证
- 锚点：`funds-order.service.ts → create()` ｜ `withdraw-approval.constant.ts → WITHDRAW_APPROVAL_AED_THRESHOLD`

## 3. 关键流程

- **L1 资格门**：`assertTradingEligibility(userId, 'WITHDRAW')` pre-creation（`customer-withdraw.controller.ts → create()` 入口同步调）
- **大额审批门**（L2 之前）：`handleWithdrawalCreated()` → 估值 AED → `shouldRequireApproval()`（**fail-closed**：汇率取不到 / 无估值 → 强制审批）→ ≥20 万 = PENDING_APPROVAL + `WITHDRAW_LARGE_VALUE_APPROVAL`（SENIOR_MANAGEMENT_OFFICER 单步 48h）/ 否则进 L2
- **L2 合规筛查**：`initializeTransactionScreen()`（Pre-KYT + TR 并行初始化）→ `checkScreenPass()` 收敛（preKyt PASSED 且 TR ∈ {PASSED, NOT_REQUIRED}）→ 自动审批 → `initiatePayoutPhase()`
- **确认**：`handleFundsOrderChanged()` 监听 funds_order → CONFIRMED（crypto txHash / fiat 银行到账**同一入口**）→ `onPayoutLegConfirmed()`
- **TB 记账**（客户侧统一 `CLIENT_PAYABLE↔CLIENT_ASSET` real-time 1:1）：
  - 锁定：`executePendingTransfer()` 创建 pending（net + fee）
  - 结算：`postPendingTransfer()` + 公司侧同笔 `FIRM_ASSET → FIRM_FEE` 收 fee
  - 解锁：`releaseLock() → voidPendingTransferBestEffort()`（失败/拒绝/大额否决）
- **L3 归档**：`archivePostKyt()` **crypto-only**（`asset.type !== 'FIAT' && txHash`），fire-and-forget，**当前是 stub**
- **费率治理**：3 个独立工作流 `WithdrawalFeeLevel{Creation/Change/Binding}WorkflowService`；Creation/Change 走审批（**现状 OPS_OFFICER 单步**，非 roadmap 写的 MLRO+SMO），Change 走 request-record + configHash 冲突检测，Binding 无审批门直接生效；`WithdrawQuoteService → resolveBestLevel()` 多 level 取最低费
- 锚点：`withdraw-workflow.service.ts → handleWithdrawalCreated()/initializeTransactionScreen()/checkScreenPass()/initiatePayoutPhase()/onPayoutLegConfirmed()/releaseLock()/archivePostKyt()` ｜ `withdraw-approval.constant.ts → shouldRequireApproval()` ｜ `withdrawal-fee-level/*-workflow.service.ts` ｜ `withdraw-quote.service.ts → resolveBestLevel()`

## 4. ⚠️ 已知缺口（详见 BACKLOG.md）

- **异常分支基本未做**：KYT 高风险 / 制裁命中的 MLRO 审批门**未实现**（后端枚举无 FROZEN 态，只有大额那个 SMO 门）；链上失败只有 `onPayoutLegFailed()` → FAILED + void，**无自动重试/加速**；REJECTED/大额否决的 void 解锁**已做** ✅
- **Sumsub KYT/TR 真实集成未做**：仅模拟端点；`archivePostKyt()` 明确注释为 stub（待替换 PATCH /kyt/txns 调用）
- **热钱包余额校验无**：Payout 前不查 Outbound Wallet 余额
- **提现成功通知无**：SUCCESS 时未调 `NotificationsGateway`（基础设施在、没接）
- **repair surface 偏薄**：记账失败靠 `assertWithdrawSettled()` fail-closed 卡在 PAYOUT_PENDING 等人工，无专用修复 UI/端点
- **模拟端点缺 payout-confirmed**：只有 kyt-phase1/2 + travel-rule；payout 确认改走 funds_order advance 推进（非缺失，roadmap 措辞漂移）
- **前后端 FROZEN 漂移**：前端 `Withdraw.tsx` tipping-off 过滤引用 FROZEN，但后端 withdraw 枚举无此态（映射本身在、复用 V4 ✅）

## 5. 锚点

`withdraw-transactions/`：`customer-withdraw.controller.ts`（客户端 API）｜ `withdraw-transactions.controller.ts`（admin + simulate 端点）｜ `withdraw-workflow.service.ts`（三层编排 + TB 记账，主文件）｜ `withdraw-transactions.service.ts`（状态机）｜ `dto/withdraw-transaction.dto.ts`（状态枚举）｜ `constants/withdraw-approval.constant.ts`（大额门）
`withdrawal-fee-level/`：`*-creation/change/binding-workflow.service.ts` ｜ `withdrawal-fee-level.service.ts`（executeChange + configHash）｜ `withdraw-quote.service.ts`
共享：`funds-order.service.ts` ｜ `approval.constants.ts → WITHDRAW_LARGE_VALUE_APPROVAL / WITHDRAWAL_FEE_LEVEL_*` ｜ 前端 `client-web/Withdraw.tsx`、`admin-web/WithdrawTransaction{List,Detail}.tsx`
