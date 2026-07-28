# V5 提现流程 — 当前实现真相

Last Verified: 2026-07-16（核对方式：金额限额落地核对——L1 gate/D1 阈值换源/grossAedValue 出生落库逐符号走查；余节 2026-07-03 基线）

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
- **大额审批门阈值（D1）**：来自 `transaction_limit_rules` 的 LARGE_APPROVAL 行（`getLargeApprovalThreshold('WITHDRAWAL')`，种子 200000 AED）；规则缺失 fail-closed 走审批。死常量 `WITHDRAW_APPROVAL_AED_THRESHOLD` 已退役
- **AED 估值快照**（4 列 `grossAedValue`/`aedRate`/`rateFetchedAt`/`rateFetchFailed`）：L1 金额限额门在建单时**出生即落**（供 D1 大额门 + B 累计用量取数），不再等创建后事件回填
- **对账 evidence**：NET_POST / FEE_POST / FEE_FIRM 三腿共享同一 `externalRef` + `walletRef`，跨钱包互证
- 锚点：`funds-order.service.ts → create()` ｜ `withdraw-approval.constant.ts → shouldRequireApproval()`（阈值入参纯函数）｜ `transaction-limits/transaction-limit-rules.service.ts → getLargeApprovalThreshold()`

## 3. 关键流程

- **L1 资格门**：`assertTradingEligibility(userId, 'WITHDRAW')` pre-creation（`customer-withdraw.controller.ts → create()` 入口同步调）
- **L1 金额限额门**（资格门之后、`$transaction` 之前）：`createWithdrawal()` 对 CUSTOMER 单调 `TransactionLimitGateService.evaluate({operationType:'WITHDRAWAL',customerId,assetId,amount})`——A 单笔 min/max（原生币种直比，拒 `BELOW_MIN`/`ABOVE_MAX`）+ B 周期累计（AED，迪拜日历日/月窗口，用量 = 窗口内该客户提现 `grossAedValue` 之和[排除 FAILED/REJECTED/CANCELLED/RETURNED] + 本笔，拒 `CUMULATIVE_EXCEEDED`）；有 B 规则但汇率取不到 → fail-closed `UNPRICEABLE`。A/B 拒绝 = **订单不生、quote 不耗**，审计 `TRANSACTION_LIMIT_REJECTED`（workflowType `TRANSACTION_LIMIT_ENFORCEMENT`，每次尝试唯一 requestId）。通过则返回 AED 估值快照随单出生落库。**ADMIN 单跳过此门**
- **大额审批门（D1，L2 之前）**：`handleWithdrawalCreated()` → `valuateAed()` → `saveValuationSnapshot()`（**no-clobber 守卫**：失败重估不把出生时的好 `grossAedValue` 覆盖成 null，保 B 累计用量完整）→ `shouldRequireApproval(valuation, threshold)`（阈值 = `getLargeApprovalThreshold('WITHDRAWAL')` 规则行；**fail-closed**：汇率取不到 / 无估值 / 规则缺失 → 强制审批）→ ≥阈值 = PENDING_APPROVAL + `WITHDRAW_LARGE_VALUE_APPROVAL`（SENIOR_MANAGEMENT_OFFICER 单步 48h）/ 否则进 L2
- **L2 合规筛查**：`initializeTransactionScreen()`（Pre-KYT + TR 并行初始化）→ `checkScreenPass()` 收敛（preKyt PASSED 且 TR ∈ {PASSED, NOT_REQUIRED}）→ 自动审批 → `initiatePayoutPhase()`
- **确认**：`handleFundsOrderChanged()` 监听 funds_order → CONFIRMED（crypto txHash / fiat 银行到账**同一入口**）→ `onPayoutLegConfirmed()`
- **TB 记账**（客户侧统一 `CLIENT_PAYABLE↔CLIENT_ASSET` real-time 1:1）：
  - 锁定：`executePendingTransfer()` 创建 pending（net + fee）
  - 结算：`postPendingTransfer()` + 公司侧同笔 `FIRM_ASSET → FIRM_FEE` 收 fee
  - 解锁：`releaseLock() → voidPendingTransferBestEffort()`（失败/拒绝/大额否决）
- **L3 归档**：`archivePostKyt()` **crypto-only**（`asset.type !== 'FIAT' && txHash`），fire-and-forget，**当前是 stub**
- **费率治理**：2 个独立工作流 `WithdrawalFeeLevel{Creation/Change}WorkflowService`；Creation/Change 走审批（**现状 OPS_OFFICER 单步**，非 roadmap 写的 MLRO+SMO），Change 走 request-record + configHash 冲突检测；受众改由 `requiredTagsJson`（客户标签谓词）+ `validFrom/validTo`（限时窗）表达，`WithdrawQuoteService → resolveBestLevel()` 按谓词命中集合取最低费（binding 表已 2026-07-13 退役，见 BACKLOG 历史）
- 锚点：`withdraw-workflow.service.ts → createWithdrawal()/handleWithdrawalCreated()/initializeTransactionScreen()/checkScreenPass()/initiatePayoutPhase()/onPayoutLegConfirmed()/releaseLock()/archivePostKyt()` ｜ `withdraw-transactions.service.ts → saveValuationSnapshot()`（no-clobber 守卫）｜ `withdraw-approval.constant.ts → shouldRequireApproval()` ｜ `transaction-limits/transaction-limit-gate.service.ts → evaluate()`（L1 金额限额引擎）｜ `withdrawal-fee-level/*-workflow.service.ts` ｜ `withdraw-quote.service.ts → resolveBestLevel()`

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
`withdrawal-fee-level/`：`*-creation/change-workflow.service.ts` ｜ `withdrawal-fee-level.service.ts`（executeChange + configHash）｜ `withdraw-quote.service.ts`
共享：`funds-order.service.ts` ｜ `approval.constants.ts → WITHDRAW_LARGE_VALUE_APPROVAL / WITHDRAWAL_FEE_LEVEL_*` ｜ `asset-treasury/transaction-limits/transaction-limit-gate.service.ts`（L1 金额限额引擎）、`transaction-limit-rules.service.ts → getLargeApprovalThreshold()`（D1 阈值来源）｜ 前端 `client-web/Withdraw.tsx`（限额 `code` 友好文案映射）、`admin-web/WithdrawTransaction{List,Detail}.tsx`
