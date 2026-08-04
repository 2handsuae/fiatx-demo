# V5 提现流程 — 当前实现真相

Last Verified: 2026-08-04（核对方式：提现域全流转升级 12-task 施工序列（A 状态机重写/B 引擎+七列迁移/C 费腿硬化+RETURNED+L3/D FROZEN 双审批弧/E 前端双端/F e2e 收官）落地后逐符号复核——本文整篇重写，取代 2026-07-16 的旧 12 态版本（`CREATED`/`PENDING_COMPLIANCE`/`UNDER_REVIEW`/`APPROVED`/`HELD`/`CANCELLED` 等旧枚举已随 Task 1 状态机重写整体删除，本文不再提及；新状态机 10 状态/13 动作/20 边逐边核对代码 `withdraw-transactions.service.ts → transitions`；Sumsub 集成从"仅模拟端点"升级为真实单笔提交引擎，逐符号核对 `submitSumsubTxn()`/`applyKytVerdict()`；e2e 收官阶段跑通 `test/withdraw-money-arcs.e2e-spec.ts`(7/7) + `test/withdraw-sumsub-scenarios.e2e-spec.ts`(9/9) 时发现并修复一处真 bug——`onLegCleared()` 的"全部资金单已 CLEARED"判定原样对 `findByParent()` 的全部历史行取 `every()`，费腿重试后老的 FAILED attempt 行永久卡在结果集里，导致任何经历过一次费腿失败重试的提现即使后续成功结算也永远到不了 SUCCESS——已修复为按 legSeq 只取最新 attempt 判定，详见第 5 节）。

> 本文只描述"现在是什么样"。改代码必须同步本文。计划看 roadmap，欠账看 BACKLOG.md。

---

## 0. 一句话定位

客户提现（crypto + fiat 共用一条工作流 `WithdrawWorkflowService`）：出生即着陆 `COMPLIANCE_PENDING`（大额直接落 `PENDING_APPROVAL`）→ Sumsub KYT 单笔裁决驱动 10 态状态机 → `PAYOUT_PENDING` 两腿（本金+费）并行结算 → `SUCCESS`。制裁/MLRO 冻结（`FROZEN`）只能经双审批弧（解冻/退款）离场。**不**管：内部转账、Cold→Hot 归集（V7）、真实链上广播/银行出金通道（本域只管状态机+记账，不管出账渠道本身）。

## 1. 提现资金单（funds_orders 提现切片）

> 📖 资金单状态机 / 共享执行引擎 → [funds-orders.md](funds-orders.md)。本节只写提现切片。

提现资金单 = `withdrawTransactionId` 非空的 `funds_order`（Payout/InternalFund 已并入）。**一笔提现最多挂两类 funds_order**：`legSeq=1` 是本金 payout 腿（`netAmount`，出生态 `CREATED`，`initiatePayoutPhase()` 在 `PAYOUT_PENDING` 阶段创建，仅此一份，永不重建）；`legSeq=2` 是费腿（仅 `feeAmount>0` 时创建，出生态 `CREATED`），**费腿允许多次重建**——`onFeeLegFailed()` 的三级梯：FAILED 时若 `attempt<3` 就以新 `attempt` 重建同 `legSeq=2` 的新单（`WITHDRAW_FEE_LEG_REBUILT` 审计），`attempt===3` 仍 FAILED 则耗尽停手（`markNeedsReview()` + `WITHDRAW_FEE_SETTLE_STUCK` 审计，withdraw 状态留 `PAYOUT_PENDING`，**不建第 4 次**）。`funds-order.service.ts → directionOf()` 对 `withdrawTransactionId` 非空恒判 `OUT`（两腿共享，不按 legSeq 分叉）。`handleFundsOrderChanged()` 按 `legSeq` 分流：`legSeq===1` 走 `onPayoutLegConfirmed`/`onPayoutLegFailed`；`legSeq===2` 走 `onFeeLegConfirmed`/`onFeeLegFailed`；`CLEARED` 状态（任一 legSeq）统一走 `onLegCleared()` 判断"是否两腿都已 CLEARED"。

- **锚点**：`funds-order-transitions.constant.ts → FIAT_OUT_TRANSITIONS/CRYPTO_OUT_TRANSITIONS`（`directionOf()` 对 withdraw 恒 `OUT`）｜ `withdraw-workflow.service.ts → initiatePayoutPhase()`（两腿创建）/`handleFundsOrderChanged()`（legSeq 分流）/`onFeeLegFailed()`（三级梯）

## 2. 提现订单（WithdrawTransaction）状态机

**10 状态 / 13 动作 / 20 边**（定稿于 `.superpowers/sdd/task-1-brief.md`，2026-08-03 落地）。

**10 个状态**：`PENDING_APPROVAL`/`COMPLIANCE_PENDING`/`ACTION_PENDING`/`MANUAL_CHECKING`/`FROZEN`/`PAYOUT_PENDING`/`SUCCESS`/`REJECTED`/`FAILED`/`RETURNED`。**4 个终态**（零出边）：`SUCCESS`/`REJECTED`/`FAILED`/`RETURNED`。

**13 个动作**：`gate_approve`/`reject`/`approve`/`success`/`fail`/`return`/`action_pending`/`kyt_rejected`/`sla_breach`/`freeze`/`reject_refund`/`resume` 共 12 个在转移表里有出边；`require_approval` 是**死枚举**（历史遗留，转移表零引用，代码零调用点，见第 9 节 BACKLOG）。

**20 条边**（`withdraw-transactions.service.ts → transitions`，逐条穷举；同表有一条守则性单测逐边断言防再次漂移）：

```
PENDING_APPROVAL                              ← 大额闸出生落点（非转移表内的"出生路由"写，见下）
  gate_approve     → COMPLIANCE_PENDING
  reject           → REJECTED

COMPLIANCE_PENDING                             ← 出生态（"出生即着陆"，见下）
  approve          → PAYOUT_PENDING
  action_pending   → ACTION_PENDING
  kyt_rejected     → MANUAL_CHECKING
  sla_breach       → MANUAL_CHECKING
  freeze           → FROZEN

ACTION_PENDING
  approve          → PAYOUT_PENDING
  kyt_rejected     → MANUAL_CHECKING
  freeze           → FROZEN
  sla_breach       → MANUAL_CHECKING

MANUAL_CHECKING
  approve          → PAYOUT_PENDING
  action_pending   → ACTION_PENDING
  freeze           → FROZEN
  reject_refund    → REJECTED

FROZEN                                         ← 双审批弧，唯二合法出口（见第 6 节）
  resume           → COMPLIANCE_PENDING
  reject_refund    → REJECTED

PAYOUT_PENDING
  success          → SUCCESS
  fail             → FAILED
  return           → RETURNED
```

**出生即着陆（Task 2）**：每笔提现在 `createWithdrawal()` 的 `$transaction` 内直接落 `COMPLIANCE_PENDING`（同时建 TB 两笔 pending 锁），不再有独立"CREATED"枚举态。`handleWithdrawalCreated()`（`WITHDRAWAL_CREATED` 事件，fire-and-forget `emit()`）随后估值 AED、判断是否需大额审批：**不需要** → 原地留 `COMPLIANCE_PENDING` 直接 `submitSumsubTxn()`；**需要** → `openApprovalGate()` 开 `WITHDRAW_LARGE_VALUE_APPROVAL`（`SENIOR_MANAGEMENT_OFFICER` 单步 48h）审批案后，`landOnPendingApproval()` **绕过 `updateStatus`/转移表**直写 `PENDING_APPROVAL`（这是唯一的"出生路由"写，转移表故意没有这条边——它不是业务转移，是大额单出生后落点）；批准后 `gate_approve → COMPLIANCE_PENDING` 走正规转移表边，再 `submitSumsubTxn()`。

**`reject_refund` 的两个起点是刻意的**：`MANUAL_CHECKING`（officer 在 Sumsub 侧对一笔已进人工复核的单打 `REJECT_REFUND` 处置 tag，`applyKytRejected()` 直接落地，无需审批——officer 已经在人工复核阶段，判断权已下放）与 `FROZEN`（制裁/MLRO 冻结单只能经 `WITHDRAW_SANCTION_REFUND` 双审批弧的 `onRefundApproved()` 才能走这条边，**同一 tag 若在 FROZEN 态到达会被忽略**（`WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED` 审计，见第 6 节）——两个起点共享同一目标边，但 `FROZEN` 分支被结构性收紧，绝不允许系统自动打的 tag 单方面解除制裁冻结。

**`applyKytVerdict()` 的状态感知 no-op 护栏**：终态（`SUCCESS`/`REJECTED`/`FAILED`/`RETURNED`）收到任何裁决直接 no-op；`FROZEN` 收到迟到的 `approved` 裁决**跳过写回/存证**（保护制裁证据不被覆写，见第 4 节）、收到 `awaitUser`/未打 tag 的 `rejected` 均 no-op（不抛错）；`PAYOUT_PENDING`（payout 已广播）收到任何裁决只审计 `WITHDRAW_POST_BROADCAST_VERDICT` + （`rejected` 时）`markNeedsReview()`，不做状态机动作（没有对应边，广播后的钱已在飞行中）。

- **锚点**：`dto/withdraw-transaction.dto.ts → WithdrawTransactionStatus/WithdrawTransactionAction`（10/13）｜ `withdraw-transactions.service.ts → transitions`（20 边；`assertStatusUpdateSourceAllowed()` 挡 ADMIN_API 直推 `PAYOUT_PENDING`/终态三个）｜ `withdraw-workflow.service.ts → createWithdrawal()`（出生态写 + TB 两笔 pending）/`handleWithdrawalCreated()`/`openApprovalGate()`/`landOnPendingApproval()`（出生路由）｜ `withdraw-transactions.service.spec.ts`（20 边逐条守则性单测）

## 3. Happy Path（crypto/fiat 共用一条工作流，均 ✅ 验证）

`createWithdrawal()`（客户端 `POST /client/withdraw-transactions`，需先 `POST /withdraw-transactions/quotes` 拿报价）→ 地址注册硬校验（见下）→ L1 资格门 + 金额限额门 → TB 两笔 pending 锁（`CLIENT_PAYABLE→CLIENT_ASSET`，net + fee）→ 出生落 `COMPLIANCE_PENDING` → 大额判定（通常不需要）→ `submitSumsubTxn()` 报单笔 Sumsub 交易 → webhook `approved` 裁决 → `initiatePayoutPhase()`（绑源钱包 + 建两腿）→ `PAYOUT_PENDING` → 两腿各自 `CONFIRMED`（外部确认，crypto txHash / fiat 银行到账同一入口）→ POST 记账 + `CLEAR` → 两腿全 `CLEARED` → `assertWithdrawSettled()` 断言完整（fail-closed）→ `SUCCESS`。

- **地址注册硬校验（Task 3）**：`createWithdrawal()` 在建单前查 `withdrawalAddress` 表——crypto 按 `toAddress` 精确匹配 `status='ACTIVE'`（`counterpartyIsVasp` 由命中行的 `addressType==='VASP'` 派生）；fiat 按 `toIban` 精确匹配 `status='ACTIVE' AND addressType='BANK'`。未命中 → 400 `WITHDRAWAL_ADDRESS_NOT_REGISTERED`，**订单不生、quote 不耗**（与 L1/D1 闸门同一原则）。
- **源钱包绑定（R4 不变量，`ensureSourceWalletBound()`）**：`initiatePayoutPhase()` 时才绑定（不在建单时），FIAT 必须是客户自己的 `C_VIBAN` 钱包，CRYPTO 必须是 `C_DEP` 钱包——均 `ownerType=CUSTOMER`；找不到活跃钱包抛 `IllegalSourceWalletError`（400），绝不静默落到平台池钱包（修复历史回归：FIAT 曾误绑 `C_CMA`+`PLATFORM`）。
- **TB 记账**（客户侧统一 `CLIENT_PAYABLE↔CLIENT_ASSET` real-time 1:1，公司侧 `FIRM_ASSET→FIRM_FEE`）：
  - 锁定（建单时）：`executePendingTransfer()`，`WITHDRAW_NET_PENDING`(10)/`WITHDRAW_FEE_PENDING`(13)
  - 结算（各腿 CONFIRMED 时）：`postPendingTransfer()`（`WITHDRAW_NET_POST`=11/`WITHDRAW_FEE_POST`=14）+ 费腿另收 `executeTransfer()`（`WITHDRAW_FEE_FIRM`=16，`DR FIRM_ASSET/CR FIRM_FEE`）
  - 解锁（拒绝/失败/退款批准）：`releaseLock() → voidPendingTransferBestEffort()`（净额+费两笔一起 void）
- **顺序守卫（Task 6，见第 5 节）**：费腿绝不能先于本金腿结算——若费腿先 `CONFIRMED`，`onFeeLegConfirmed()` 直接 defer（log + return），等本金腿 `CLEARED` 时 `onPayoutLegConfirmed()` 的"回捞"逻辑主动补跑。
- **锚点**：`customer-withdraw.controller.ts → create()`（L1 前置）｜ `withdraw-workflow.service.ts → createWithdrawal()`（地址校验+限额门+TB 锁）/`ensureSourceWalletBound()`（R4）/`initiatePayoutPhase()`（两腿创建）/`onPayoutLegConfirmed()`（回捞）/`onLegCleared()`（终局判定，Task 12 e2e 修复见第 5 节）/`assertWithdrawSettled()`

## 4. Sumsub 单笔提交 + webhook 驱动（Task 3-5，2026-08-03）

一笔提现 → 一笔 Sumsub KYT 交易（direction=`out`），复用充值域已有的 `SUMSUB_TXN_CLIENT` provider + `resolveKytTxnType()` 判定器（**跨域直接复用同一份，不是 fork**——`withdraw-workflow.service.ts` 直接 `import { resolveKytTxnType } from '../../deposit-sumsub/kyt-txn-type.resolver'`）。VARA TR 阈值判定同 §4.5（USDT≥1000/AED≥3500 且 `counterpartyIsVasp===true` → `travelRule`，否则 `finance`）；`SUMSUB_SINGLE_TXN_SUBMIT==='true' || SUMSUB_MOCK_MODE==='true'` 时才用判定结果，否则恒交 `finance`（同一硬前提：合规须先确认 Sumsub 规则 `types` 已挂 `travelRule`）。

- **数据模型（七列，2026-08-03 迁移 `20260804010000_withdraw_sumsub_single_txn`）**：`sumsubTxnId`/`sumsubTxnType`(`finance|travelRule`)/`sumsubVerdict`(`approved|rejected|awaitUser|onHold`)/`sumsubScore`/`sumsubScoredAt`/`sumsubTxnDetailJson`/`counterpartyIsVasp`——与充值 §4.5 收敛后的七列命名逐字一致（**不是**充值早期已废的 `preKyt*`/`kyt*` 双列模型）。
- **提交（`submitSumsubTxn()`，COMPLIANCE_PENDING 入口触发，幂等 on `sumsubTxnId`）**：客户无 `sumsubApplicantId` → warn 后原地留 `COMPLIANCE_PENDING`（不抛、待人工）；整个调用 try/catch 包裹（外部 HTTP 失败绝不能 strand 提现，充值 I2 教训直接应用）；成功后 `WITHDRAW_SUMSUB_SUBMITTED` 审计带 `sumsubTxnId`/`txnType`/判定 `reason`。
- **`WithdrawKytVerdictHandler`（提现专用 fork，与充值 `DepositKytVerdictHandler` 逐字同构但不共用代码）**：webhook type 归一 `KytVerdict`（`applicantKytTxnApproved/Rejected/AwaitingUser` + `applicantKytOnHold`）；`rejected`/`awaitUser` 才读 `typedTags`——场景 tag `SANCTION`/`PEP`（`SCENE_TAGS`），处置 tag `FROZEN_BY_MLRO`/`REJECT_REFUND`（`DISPO_TAGS`，**与充值的 `RETURN_TO_SENDER` 不同**——提现没有"退回发件人"语义，官方处置统一叫"退款"）；按 `sumsubTxnId`（即 webhook 的 `kytTxnId`）反查 withdraw，找不到 → warn "orphan"，不崩。
- **`applyKytVerdict()` 四分支转移表**（详见第 2 节状态机）：

| verdict | 场景/处置 tag | 目标动作 | 备注 |
|---|---|---|---|
| `approved` | — | `approve` | `MANUAL_CHECKING` 额外记 `WITHDRAW_MANUAL_APPROVED`（翻案）；`FROZEN` 收到直接 no-op（跳过写回/存证） |
| `awaitUser` | 无 tag | `action_pending`，`manualReason='CLIENT_ACTION'` | 幂等 on 已 `ACTION_PENDING`；`FROZEN` no-op |
| `awaitUser` | `PEP` | `action_pending`，`manualReason='EDD_PEP'` | 同上 |
| `onHold` | — | 非转移边，只刷 `slaDeadline`（+7d）+ 审计 `WITHDRAW_ONHOLD` | 仅 `COMPLIANCE_PENDING` 时生效，其余状态 no-op |
| `rejected` | `SANCTION` 或 `FROZEN_BY_MLRO` | `freeze` | 免审批，收紧方向；已 `FROZEN` 幂等 no-op |
| `rejected` | `REJECT_REFUND` | `reject_refund`（仅 `MANUAL_CHECKING`）| `FROZEN` 收到**忽略**（`WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED`，见第 2/6 节）；其余状态落地为 `kyt_rejected`（"退款 tag 早到，先进人工复核待重打"） |
| `rejected` | 无 tag | `kyt_rejected` | → `MANUAL_CHECKING`；已在此态幂等 no-op；`FROZEN` no-op |

- **SLA 定时器（`WithdrawSlaService`，mirror of `DepositSlaService`）**：`@Cron('*/5 * * * *', {timeZone:'Asia/Dubai'})` 扫 `COMPLIANCE_PENDING`/`ACTION_PENDING` 且 `slaDeadline<now && slaBreached=false` 的行，驱动 `sla_breach → MANUAL_CHECKING` + 落 `slaBreached=true`。`onHold`/`awaitUser` 的 SLA 窗口均 7 天（`ONHOLD_SLA_DAYS`/`ACTION_SLA_DAYS` 常量）。
- **L3 归档（`archivePostKyt()`，crypto-only，fire-and-forget）**：`SUCCESS` 落地后把链上 `txHash` PATCH 回 Sumsub KYT 交易（`sumsubTxnClient.archiveTxHash()`），供未来交易追溯；无 `sumsubTxnId`/`txHash` 则跳过 + warn。
- **锚点**：`withdraw-workflow.service.ts → submitSumsubTxn()`/`applyKytVerdict()`/`applyKytApproved()`/`applyKytAwaitUser()`/`applyKytOnHold()`/`applyKytRejected()`/`archivePostKyt()` ｜ `withdraw-kyt-verdict.handler.ts`（`VERDICT_BY_TYPE`/`SCENE_TAGS`/`DISPO_TAGS`）｜ `withdraw-sla.service.ts` ｜ `withdraw-webhook.router.ts`（前置分流，命中即返回 `true`，两域路由不重叠）｜ `deposit-sumsub/kyt-txn-type.resolver.ts → resolveKytTxnType()`（跨域共享，非 fork）

## 5. 资金腿记账（顺序守卫 + 三级梯 + bounce，Task 6-7）

**顺序守卫**：本金腿（legSeq=1）必须先于费腿（legSeq=2）结算——`onFeeLegConfirmed()` 开头查本金腿状态，非 `CONFIRMED`/`CLEARED` 就 defer（log + return，不 throw，费腿留 `CONFIRMED` 原地等）；本金腿的 `onPayoutLegConfirmed()` 在自己 POST+CLEAR 之后主动"回捞"——若费腿已经 `CONFIRMED`（先到但被 defer），立即代为调用 `onFeeLegConfirmed()`，避免深埋的费腿永远等不到重新触发。并发再入守卫：`onFeeLegConfirmed()` 结算体内二次读费腿当前状态，非 `CONFIRMED`（已被并发赢家结算/已终态）直接幂等跳过。

**费腿失败三级梯**（`onFeeLegFailed()`，`MAX_FEE_LEG_ATTEMPTS=3`）：
```
attempt 1 FAILED → 重建 attempt 2（WITHDRAW_FEE_LEG_REBUILT），withdraw 留 PAYOUT_PENDING
attempt 2 FAILED → 重建 attempt 3（WITHDRAW_FEE_LEG_REBUILT），withdraw 留 PAYOUT_PENDING
attempt 3 FAILED → 耗尽：markNeedsReview() + WITHDRAW_FEE_SETTLE_STUCK 审计，withdraw 留 PAYOUT_PENDING（不建 attempt 4，无自动重触发出口——见第 9 节 BACKLOG）
```
本金腿从不重建——`onPayoutLegFailed()` 一失败直接 withdraw `FAIL`（终态）+ `releaseLock()`（P6 修复：净额+费两笔 TB pending 一起 void，客户余额完整恢复）。

**费腿"结算失败"（TB 侧瞬时故障，与上面的"FAILED 状态"三级梯是两回事）**：`onFeeLegConfirmed()` 结算体（POST + 公司侧收费 + CLEAR）整体 try/catch——TB 瞬时故障 → `incrementFeeSettleAttempts()`，<3 次静默 return（费腿留 `CONFIRMED`，等下次重投/人工 re-advance 重试）；第 3 次同样 `markNeedsReview()` + `WITHDRAW_FEE_SETTLE_STUCK`，**费腿的 `funds_order.status` 永久停在 `CONFIRMED`**（不同于上面的"FAILED 三级梯"会重建新 attempt——这条路径从未真正 FAIL 过，只是反复来 TB 报错，视图上会显得"费腿一直在 CONFIRMED 从未推进"，见第 9 节 BACKLOG）。

**Task 12 e2e 修复：`onLegCleared()` 的"全部已 CLEARED"判定** ——原判定对 `findByParent({withdrawTransactionId},{})` 返回的**全部历史行**取 `every(status===CLEARED)`；费腿一旦经历过失败重建（FAILED 的老 attempt 行永久留存作历史），这些老 FAILED 行会被永远算进这次 `every()` 里，导致哪怕后续新 attempt 真的结算成功，判定也永远 `false`——**任何经历过一次费腿失败重试的提现，即使本金和最新费腿都已 CLEARED，也永远到不了 SUCCESS**。修复：按 `legSeq` 分组只取每组最新 `attempt` 判定（mirror `onPayoutLegConfirmed()` 回捞逻辑已有的 `feeLegs[feeLegs.length-1]` 取最新写法）。`test/withdraw-money-arcs.e2e-spec.ts` 场景 3（费腿 FAILED×3→STUCK→修复重跑→SUCCESS）实测踩中并验证修复。

**Bounce（退汇，Task 7，`onBounce()`，仅 admin，`POST :id/bounce`）**：本金腿已 POST（真实钱已出）但银行/链上事后退汇——仅 `PAYOUT_PENDING` 状态 + 已存在 `WITHDRAW_NET_POST` evidence 才可调用（否则 400，未广播的失败走 `FAIL` 而非 bounce）。反向分录 `DR CLIENT_ASSET/CR CLIENT_PAYABLE`（`WITHDRAW_BOUNCE_REENTRY`=17）先落账，再 `RETURN → RETURNED`（**先账后状态**，中途崩溃留 `PAYOUT_PENDING` 可重试而非丢分录）。**费腿处置分两支**（Fix Round 1 review 发现：本金 POST 不代表费腿也 POST——Task 6 顺序守卫下"本金 POST、费腿仍 pending"是常态窗口而非罕见竞态）：费腿已 POST（`WITHDRAW_FEE_POST` evidence 存在）→ `feeDisposition='fee retained (collected)'`，不退（bounce 手续费归公司）；费腿未 POST → 该笔 pending 锁 void（费退回客户可用余额）+ 费 `funds_order` 尽力标 `FAILED`（视图一致性，吞掉状态机报错——TB void 才是真money-path，视图落后不该回滚已完成的钱）。**Fee 恒不退是设计如此**（无论哪个分支，一旦费已 POST 就归公司）。

- **锚点**：`withdraw-workflow.service.ts → onPayoutLegConfirmed()`（回捞）/`onFeeLegConfirmed()`（顺序守卫+并发再入+settle-failure 三级梯）/`onFeeLegFailed()`（FAILED 三级梯）/`onPayoutLegFailed()`（P6 releaseLock）/`onLegCleared()`（Task 12 修复，按 legSeq 取最新 attempt）/`onBounce()`（先账后状态+费腿双支）｜ `withdraw-transactions.controller.ts → bounce()`

## 6. FROZEN 双审批弧（Task 8-9，2026-08-03）

`FROZEN` 只有两条合法出边（第 2 节），均需 V1 maker-checker 单步 `MLRO` 审批（`ApprovalActionTypes.WITHDRAW_UNFREEZE`/`WITHDRAW_SANCTION_REFUND`，48h 超时，`allowCancel:true`）——**发起侧只读+开案，不写 withdraw 表**（Rule 5）；**执行侧**由各自的 `workflow.withdraw-{unfreeze|sanction-refund}.decided` 监听器在 APPROVED 时驱动。

**解冻（`initiateUnfreeze()`/`onUnfreezeApproved()`）**：`orderRef`（解冻令文书号）+ `reason` 必填；防重复开案（同类 PENDING 审批只能有一个）。批准后：**零记账**（钱在 FROZEN 期间从未离开客户的 TB pending 锁，无反向分录）→ `resume → COMPLIANCE_PENDING` → 审计 `WITHDRAW_UNFROZEN`（reason 带 orderRef）→ `triggerUnfreezeRescore()` 触发 Sumsub `rescore(sumsubTxnId)`（try/catch 包裹，外部 HTTP 失败只 warn 不回滚——状态已提交，靠人工/下次 webhook 兜底；`sumsubTxnId` 为空则跳过）。

**退款（`initiateRefund()`/`onRefundApproved()`）**：仅 `reason` 必填（无 orderRef——这是退款处置，不是解除冻结）。批准后：`reject_refund → REJECTED` → `releaseLock()`（P6 原语，净额+费两笔 TB pending 一起 void，客户可用余额完整恢复）→ 审计 `WITHDRAW_SANCTION_REFUNDED`（reason 注明"客户账户层面的升级处置是人工——V2 冻结账户 API 尚未建成，见 BACKLOG"，见第 9 节）。

**制裁证据保护**：`applyKytVerdict()` 对 `FROZEN` 态收到迟到的 `approved` 裁决**跳过**闸门写回+存证（不覆写既有的制裁裁决报文），但仍然 no-op（不放行）——避免一笔已冻结的单被迟到重评的 approved webhook 静默抹去制裁证据。`REJECT_REFUND` tag 若在 `FROZEN` 态到达（原本合法处置但为时已晚）**被忽略**（`WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED` 审计留痕），必须走这里的双审批弧而非系统自动 tag 单方面解除。

- **锚点**：`withdraw-workflow.service.ts → initiateUnfreeze()/initiateRefund()/onUnfreezeDecided()/onRefundDecided()/onUnfreezeApproved()/onRefundApproved()/triggerUnfreezeRescore()/fetchApprovedOrderRef()` ｜ `withdraw-unfreeze-approval.service.ts`/`withdraw-sanction-refund-approval.service.ts`（V1 处理器）｜ `governance/approvals/constants/approval.constants.ts → ApprovalActionTypes.WITHDRAW_UNFREEZE/WITHDRAW_SANCTION_REFUND`（均单步 MLRO 48h）｜ `withdraw-transactions.controller.ts → unfreeze()/refund()`

## 7. 异常分支现状

| 分支 | 状态 | 转移路径 | 记账 | officer/MLRO 门 |
|---|---|---|---|---|
| ACTION_PENDING 补材料 | ✅ | `awaitUser` 进（`manualReason` 按 tag 区分 CLIENT_ACTION/EDD_PEP）／`approve` 出 | 无需 | — |
| onHold 挂起 | ✅ | 留 `COMPLIANCE_PENDING` 不换态，只刷 `slaDeadline`；SLA 到期转 `MANUAL_CHECKING` | 无需 | ✅ officer 在 Sumsub 侧裁决后发新 webhook |
| FROZEN 制裁/官方冻结 | ✅ | `rejected`(SANCTION tag 或 FROZEN_BY_MLRO tag) → `freeze` 进；出边仅 `resume`/`reject_refund` 两条 | **零记账（设计如此）**：钱留在 TB pending 锁，不反转不释放 | ✅ 双审批弧（第 6 节），无正门可绕 |
| MANUAL_CHECKING 人工复核 | ✅ | `kyt_rejected`(无 tag) 或 `sla_breach` 进；`approve`(翻案记 `WITHDRAW_MANUAL_APPROVED`)/`action_pending`/`freeze`/`reject_refund`(仅此态可直接执行，无需审批) 出 | 翻案批准才记账 | — |
| PAYOUT_PENDING 本金失败 | ✅ | `fail → FAILED`（终态） | ✅ `releaseLock()` 净额+费两笔 void（P6） | — |
| PAYOUT_PENDING 费腿 FAILED | ✅ | 不换 withdraw 态；三级梯重建/耗尽 STUCK（见第 5 节） | 本金腿记账不受影响；费腿耗尽后视图残留（见第 9 节） | ✅ needsReview 供 operator 人工介入 |
| PAYOUT_PENDING 费腿"结算失败"(TB瞬时故障) | ⚠️ | withdraw/费腿状态均不换（费腿卡 `CONFIRMED`），耗尽同样 STUCK | 无自动重试出口（见第 9 节） | ✅ needsReview |
| Bounce 退汇 | ✅ | `PAYOUT_PENDING --return--> RETURNED`（仅本金已 POST 才可调用） | ✅ 反向分录先账后状态；费腿按已/未 POST 分支处置（第 5 节） | ✅ admin 专用端点，非状态机自动 |
| SUCCESS 后退汇 | ❌ | 无（`onBounce()` 硬性要求 `PAYOUT_PENDING`，SUCCESS 已终态无法二次进入） | — | — |
| 热钱包余额不足 | ❌ | 无（Payout 前不查 Outbound Wallet 余额） | — | — |

- **admin 无直接拒绝能力**：`PATCH :id/status` 侧门连同其唯一动作 `AdminWithdrawTransactionAction.REJECT` 已整体删除（该动作绕过 `releaseLock()`，会把净额+费两笔 TB pending 锁永久搁置，违反「REJECTED=解锁退回」不变量；镜像充值域同期的 admin 无拒绝能力收窄）。合法的拒绝/终止路径改走各自 workflow 端点，均正确释放锁：大额审批拒绝（`onLargeValueApprovalDecided()` → `REJECT` → `releaseLock()`）、官方 `REJECT_REFUND` tag（`applyKytVerdict()`）、`WITHDRAW_SANCTION_REFUND` 双审批批准（`onRefundApproved()`）。`assertStatusUpdateSourceAllowed()` 仍在，继续挡 `ADMIN_API` 来源直推 `PAYOUT_PENDING`/三个终态。
- **锚点**：`withdraw-workflow.service.ts`（全部分支逻辑，见第 2/4/5/6 节锚点汇总）｜ `withdraw-transactions.service.ts → assertStatusUpdateSourceAllowed()`

## 8. 支撑项（均 ✅ 存活）

事件驱动编排（`funds_order.status.changed`/`WITHDRAWAL_CREATED` → `WithdrawWorkflowService`）｜ Sumsub 单笔 KYT 引擎（第 4 节）｜ Admin 提现列表/详情（9 区块 + Frozen/Payout Disposition 侧栏 + Simulation 面板，见第 10 节）｜ Client 提现页（脱敏 + 字段白名单，见第 10 节）｜ 报价引擎 `WithdrawQuoteService`（`resolveBestLevel()` 按客户标签谓词取最低费）｜ L1 金额限额门（`TransactionLimitGateService`，单笔 min/max + AED 累计窗口）｜ D1 大额审批阈值（`transaction_limit_rules` 表 `LARGE_APPROVAL` 行，种子 200000 AED）｜ SLA 定时器（`WithdrawSlaService`，第 4 节）。

## 9. 已知缺口（详见 BACKLOG.md「技术债 — V5 提现」节）

- **`require_approval` 死枚举**：动作枚举保留但转移表零引用、代码零调用点，待清理。
- **费腿 STUCK 后无自动重触发出口**：三级梯耗尽（FAILED 三级梯）/settle-failure 耗尽（TB 瞬时故障三级梯）均只 `markNeedsReview` + 落审计，无专用 repair 端点；本任务 e2e 里用"手动 `fundsOrders.create()` 建新 attempt + 驱动 CONFIRMED"验证过恢复路径可行，但生产无对应 admin 按钮。
- **费腿"结算失败"三级梯的视图残留**：耗尽后费腿 `funds_order.status` 永久停在 `CONFIRMED`，Linked Funds Orders 卡片看起来像"一直在途"，无可见 STUCK 标记（信号只在 withdraw 的 `needsReview` + 审计里）。
- **`slaBreached` 不复位**：`WithdrawSlaService` 只把它从 `false` 置 `true`，从无任何路径重置回 `false`；若一笔单解冻/翻案回 `COMPLIANCE_PENDING` 后重新进入 onHold 拿到全新 `slaDeadline`，SLA 扫描器仍会因 `slaBreached=true` 永久跳过它——两域 parity（充值 `DepositSlaService` 同一设计，同一缺口）。
- **`POST /client/withdraw-transactions` 创建响应未过白名单**：`CustomerWithdrawController.create()` 直接 `return this.workflow.createWithdrawal(...)`，返回未经 `toCustomerWithdrawView()` 裁剪的完整原始行（`sumsubTxnId`/`manualReason`/`slaDeadline`/`statusHistory`/`tbPendingNetId`/`tbPendingFeeId`/`approvalNo`/`traceId` 等悉数在内）——真机验证时实测复现（见 task-12-report.md）。列表/详情/`GET :id` 三个读端点均已正确走白名单（`findAllForCustomer`/`findOneForCustomer`），仅创建这一个响应体是漏网之鱼。
- **真实 VASP 归因服务未接**：`counterpartyIsVasp` 由客户自己注册地址时的 `addressType==='VASP'` 自报，无外部 VASP 名录/归属服务校验这个自报是否属实（与充值 §4.5 的"客户端弹窗自选 VASP"同一性质缺口，提现这边至少是从已注册地址派生，非每笔手选）。
- **SUCCESS 后退汇无处理**：`onBounce()` 硬性要求 `PAYOUT_PENDING`，一笔已 `SUCCESS` 的提现若数日后被银行/链上退汇，本域没有对应入口——应走对账（recon）子系统匹配外部退汇流水，而非 withdraw workflow 自身处理终态之后的事。
- **看门狗①「Created 回执丢单锚」未做（deposit/withdraw 两域共有）**：`funds_order` 建单后若外部回执（链上确认/银行到账信号）从未真正抵达，该腿会永久停在 `CREATED`/`SUBMITTED`，无定时巡检任务扫描"创建超过 N 分钟仍未推进"的孤儿腿并重新锚定/告警——两域将来一起补，非提现独有。
- **V2 冻户升级仅审计**：`onRefundApproved()` 的"客户账户层面升级"只落一行审计说明（"manual, V2 freeze API not yet built"），无法调用真实 freeze API 联动——关联 BACKLOG 既有条目「冻结/解冻无统一 workflow + 无 MLRO 解冻门」（V2 客户合规节），本次在提现退款弧上又踩到同一个洞。
- **demo/business seed 无 withdrawalAddress 种子**（Task 5 已登记，见 BACKLOG「demo:deposit/demo:withdraw 在全新 worktree 上必炸」条）：trading-ready 门 + 本域自己的地址硬校验双重依赖 `withdrawalAddress` 表，`demo-lib.ts` 从未播种，全新 worktree 直接跑 demo 脚本会卡门/400。
- 其余既存（Sumsub KYT 真实集成本轮已完成，不再是缺口；热钱包余额校验无 / 提现成功通知未接 / repair surface 偏薄 / 在途提现守卫靠字符串匹配 / L3 命名与交易风控 L3 撞名）详见 BACKLOG.md。

## 10. 前端现状（admin + client，Task 10-11 落地，Task 12 真机 API 验证）

**两张状态映射表，单一真相源**：`admin-web/src/utils/withdrawStatusMap.ts`（`getWithdrawStatusMeta`，如实展示 **10 态**全量 + `adm-*` 令牌徽章色 + `WITHDRAW_STATUS_FILTERS` 分组筛选，`Processing` 组合并 `COMPLIANCE_PENDING`+`PENDING_APPROVAL`）与 `client-web/src/utils/withdrawStatusView.ts`（`getWithdrawStatusView`，面向客户脱敏）。

**客户端执法态收敛（mirror 充值 2026-08-02 定稿）**：`FROZEN`/`MANUAL_CHECKING`/`PENDING_APPROVAL`/`ACTION_PENDING` 之外的三个（不含 `ACTION_PENDING`，它有独立的"需要补料"文案）与 `COMPLIANCE_PENDING` **逐字段完全一致**——`{label:'PROCESSING', tone:'neutral'}`，无 `note`。`PENDING_APPROVAL`（内部大额闸）也并入同一伪装集合——区分出来本身就是"这笔被加强审查"的信号。**已知边界**（本次真机验证实测确认，见下）：这层脱敏只在**前端渲染层**生效（`getWithdrawStatusView()` 把原始 status 映射成显示 label）——`GET /client/withdraw-transactions/:id` 的**原始 JSON 响应体本身仍带真实 status 值**（如 `"status":"FROZEN"`），字段白名单只保证不泄露 `sumsubTxnId`/`manualReason`/`typedTags` 等调查性字段，不掩盖 status 这一列的原始值；DevTools Network 面板检查仍能看到真实值。此为**与充值域同一设计**（`toCustomerDepositView()`/`toCustomerWithdrawView()` 均同构，2026-08-02 业主定稿），非本轮新增缺口，据实记录。

**Admin 详情页（`WithdrawTransactionDetail.tsx`）9 区块 + 2 侧栏组**：① Hero（状态徽章+金额+类型+Owner）② Transaction Details ③ Compliance（L1 资格 + L2 单笔 Sumsub 裁决一行展示）④ Sumsub References（Applicant ID + 单个 Txn ID/Type/Verdict/Received At）⑤ Sumsub Transaction Detail（score/verdict/matchedRules/applicantActionIds/原文折叠）⑥ Internal Approvals（大额/解冻/退款三种审批反查，仅单头）⑦ Linked Funds Orders（本金 Payout + 费 Internal Fund 并列）⑧ Status History ⑨ ⚡ Simulation（`simEnabled` 门控，独立于后端 `SUMSUB_MOCK_MODE`，9 个裁决按钮）。侧栏：`PAYOUT_PENDING` 态显示 **Payout Disposition**（Bounce 按钮）；`FROZEN` 态显示 **Frozen Disposition**（Initiate Unfreeze / Initiate Refund 两个 modal，均开审批案而非直接执行）。`needsReview` 横幅（顶部红条）**兼任 STUCK 信号**——费腿三级梯耗尽（第 5/9 节两种）与"裁决迟到于广播"共享同一个 `needsReview` 布尔位 + 同一条横幅文案，不区分具体成因（成因需读 Status History/审计明细）。

**⚡ Simulation 演示引擎（Task 10）**：`SUMSUB_MOCK_MODE=true` 时 `WithdrawSumsubModule` 才注册 `AdminWithdrawDemoController`（`POST /admin/withdraw-sumsub/demo/run-verdict`，body `{withdrawId, verdict}`）——生产环境该 controller 压根不存在（模块 controllers 数组条件化，非 guard 拦）。`WithdrawDemoScenarioService.runVerdict()` 按提现当前 `sumsubTxnType` 现铸官方形状报文、prime mock client、驱动真实 `SumsubIngestionService.ingest()` 走完整 ingest→router→handler→workflow 链路——**与 e2e 测试用的是同一份生产代码路径**，不是测试自己拼报文。9 个按钮定义于 `withdraw-sumsub/fixtures/verdict-buttons.ts`（mirror 充值版，唯一差异是 ⑥ 处置 tag 用 `REJECT_REFUND` 而非充值的 `RETURN_TO_SENDER`）。

**真机 API 验证（Task 12，2026-08-04，worktree self 栈）**：`bash scripts/stack.sh up` 起栈（`SUMSUB_MOCK_MODE=true`）→ `db:base:sync` + 重启后端（拾取新 RBAC 权限码）→ 用 seed admin（`admin@fiatx.com`，SUPER_ADMIN 绕过审批角色校验）+ seed 客户（`demo_frank@example.com`）真实走 HTTP：创建报价+提现 → Simulation 端点喂 `V4_REJECTED_SANCTION` → `FROZEN` → `POST :id/unfreeze` 开审批 → `POST /admin/control-gates/approvals/:id/approve` → `COMPLIANCE_PENDING` → 喂 `V1_APPROVED` → `PAYOUT_PENDING` → `POST /admin/funds-orders/:no/advance`（SUBMIT→CONFIRM）驱动两腿 → `SUCCESS`；另一笔走 `V5_REJECTED_FROZEN_MLRO` → `FROZEN` → `POST :id/refund` → 审批批准 → `REJECTED`。两笔均分别 `GET` 了 admin 详情端点（9 区块字段齐全，`sumsubDetail`/`approvals[]`/`statusHistory` 均实测有值）与客户端点（字段白名单确认无 `sumsubTxnId`/`manualReason`/`typedTags` 等调查性字段泄露，但如上一条所述，`status` 原始值本身未被脱敏——`toCustomerWithdrawView()` 与充值同构，非本轮回归）。原始 JSON 证据见 `task-12-report.md`。

- **锚点**：`admin-web/src/utils/withdrawStatusMap.ts`（`getWithdrawStatusMeta`/`WITHDRAW_STATUS_FILTERS`/`isWithdrawTerminalStatus`）｜ `admin-web/src/pages/WithdrawTransactionDetail.tsx`（9 区块 + Frozen/Payout Disposition + ⚡ Simulation）｜ `client-web/src/utils/withdrawStatusView.ts`（`getWithdrawStatusView`）｜ `client-web/src/pages/Withdraw.tsx`（`WithdrawTransaction` 接口 = 客户端字段契约）｜ `withdraw-transactions.service.ts → toCustomerWithdrawView()`（列表/详情白名单，**创建响应未走此白名单**，见第 9 节）｜ `withdraw-sumsub/demo-scenario.service.ts`/`admin-withdraw-demo.controller.ts`（演示端点）｜ `withdraw-sumsub/withdraw-sumsub.module.ts`（`SUMSUB_MOCK_MODE` 条件化 controller 注册）｜ `withdraw-sumsub/fixtures/verdict-buttons.ts`（9 按钮定义）
