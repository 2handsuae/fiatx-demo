# V4 充值流程 — 当前实现真相

Last Verified: 2026-07-28（核对方式：充值状态机·计划1 引擎 12 task 落地后 symbol-level 复核，新增第 4.1/4.2 节 + 状态机/异常分支表同步）

> 本文只描述"现在是什么样"。改代码必须同步本文。计划看 roadmap，欠账看 BACKLOG.md。

---

## 1. 充值资金单（funds_orders 充值切片）

> 📖 资金单状态机 / 共享执行引擎 → [funds-orders.md](funds-orders.md)。本节只写充值切片。

充值资金单 = `depositTransactionId` 非空的 `funds_order`（Payin 表已并入）。虚拟币走 CRYPTO 状态机（含 CONFIRMING），法币出生即 `CONFIRMED`（跳过 CONFIRMING）→ CLEARED。
- **锚点**：`funds-order-transitions.constant.ts → CRYPTO_IN_TRANSITIONS` ｜ `deposit-transactions.service.ts → detected()`（法币出生态 initialStatus）

## 2. 充值订单（DepositTransaction）状态机

Happy path：`PAYIN_PENDING → COMPLIANCE_PENDING → SUCCESS`；异常态 `ACTION_PENDING / FROZEN / REJECTED / FAILED / EXPIRED`（转移路径已铺，见第 5 节）。

充值状态机·计划1 引擎（2026-07 落地）新增 `MANUAL_CHECKING`（人工复核）/ `RETURNING`（原路退回处理中）/ `SEIZING`（没收处理中）三个中间态，均**已接线进转移表**（见第 5 节）。枚举里另有 `RETURNED` / `SEIZED` / `CONFISCATING` 三个值，本计划**仅占位/未真正接线**——`RETURNED` 可经 `RETURNING→RETURNED_DONE` 到达但该 action 无业务 workflow 调用方（只能走 admin PATCH 直改）；`SEIZED` 只出现在终态判定集合里，转移表没有任何 action 能转入；`CONFISCATING` 在转移表里 0 引用，是尚未使用的孤儿枚举值。两腿 pending→post 结算 + 审批管道 + 解冻回炉留计划2（见 BACKLOG）。

- **锚点**：`deposit-transaction.dto.ts → DepositTransactionStatus/DepositTransactionAction` 枚举 ｜ `deposit-transactions.service.ts → getNextStatus()` 转移表

## 3. Happy Path（双链路，均 ✅ 验证）

**虚拟币**：链上到账 → 资金单 CONFIRMED → **TB Step1**（`CLIENT_ASSET → DEPOSIT_SUSPENSE`）→ Deposit COMPLIANCE_PENDING → **L1 资格门** → **L2 交易筛查**（kyt + TR 双状态）→ 自动审批 → **TB Step2**（`DEPOSIT_SUSPENSE → CLIENT_PAYABLE`）→ SUCCESS。

**法币**：VIBAN 到账（`InboundTransferSignal` 信号入口）→ 资金单出生即 CONFIRMED（无确认阶段）→ Step1 → L1 → L2（KYT；**TR 硬写 NOT_REQUIRED**）→ Step2 → SUCCESS。

- **TB 两步借贷**（实时 1:1 后新 COA，旧 CUSTODY/BANK 已改）：Step1 `CLIENT_ASSET(1) → DEPOSIT_SUSPENSE(101)`；Step2 `DEPOSIT_SUSPENSE(101) → CLIENT_PAYABLE(100)`
- **L1 时点**：在**信号创建时**即调 `onboardingService.assertTradingEligibility(customerId, 'DEPOSIT')`（比"生成 Deposit 后"更前置）
- **L2 收敛**：`kytStatus === 'PASSED'` 且 `travelRuleStatus ∈ {PASSED, NOT_REQUIRED}` 才自动审批——本段描述的是第 4.2 节的老 mock kyt-check/tr-check 路径；充值状态机·计划1 引擎新增的真实 Sumsub webhook 驱动路径见第 4.1 节，**两条路径并存**，各自可独立把 deposit 推到 SUCCESS。
- **锚点**：`deposit-workflow.service.ts → checkAutoApproval()`（自动审批）｜ `→ executeDepositAccounting()`（两步记账）｜ `inbound-transfer-signals.service.ts → createForCustomer()`（L1）

## 4. 合规门字段与分发

充值状态机·计划1 引擎（2026-07 落地，新模块 `deposit-sumsub/`）落地后，**两条并行的合规裁决路径同时存活**——新路径（4.1）是真实 Sumsub webhook 驱动的主路径；老路径（4.2）是模拟端点驱动，未删未改，仍可独立把 deposit 推到 SUCCESS。

### 4.1 KYT-only 真实 Sumsub webhook 驱动（新，主路径）

- **字段**：`Customer.sumsubApplicantId`（唯一）；`Deposit.sumsubFinanceTxnId` / `sumsubTravelRuleTxnId`（Sumsub 侧 txnId）/ `manualReason`（`EDD_PEP`/`CLIENT_ACTION`）/ `slaDeadline` / `slaBreached`。
- **提交**：进 COMPLIANCE_PENDING（Gate 0 通过后）时 `submitSumsubTxns()` 向 Sumsub 提交交易——法币只提 `finance` 腿，虚拟币提 `finance` + `travelRule` 两腿；`applicantId` 取 `customer.sumsubApplicantId`，取不到则告警跳过（充值留在 COMPLIANCE_PENDING 等人工处理，不报错不卡流程）；以 `sumsubFinanceTxnId` 是否已存在做幂等（防 `runGate0` 重入重复提交）；写 `DEPOSIT_SUMSUB_SUBMITTED` 审计。
- **webhook 前置分流**：`sumsub-ingestion.service.ts → dispatch()` 在旧 if/else 分支**之前**新增一段——`payload.type` 以 `applicantKytTxn` 开头即整段转交 `DepositWebhookRouter.route()`，复用 `SumsubWebhookEvent` 既有的去重/retry/dead-letter，只是路由目标不同。`applicantAction*` 事件**不**进这条分支，仍走 dispatch() 里更早的老 Clue 3 分支（材料时效重检，消费方是 V2 `materialRefreshService`）——两者互不干扰；客户补料后 Sumsub 侧自动重评发出的仍是 `applicantKytTxn*`，走新分支，无需专门的 action handler 接住补料事件本身。
- **DepositWebhookRouter**（`deposit-sumsub/deposit-webhook.router.ts`）：按 `payload.type` 二次分流——`applicantKytTxnApproved/Rejected/AwaitingUser/OnHold` → `DepositKytVerdictHandler.handle()`；`applicantKytTxnReviewed` → 归一为 `ignore`，不推进状态机；`applicantKytTxnCreated` → 只记 debug 回执，no-op；其余未知 type → warn 记 orphan。
- **DepositKytVerdictHandler**（`deposit-sumsub/deposit-kyt-verdict.handler.ts`）：把 webhook type 归一成 `KytVerdict`（`approved/rejected/awaitUser/onHold`）；只有 `rejected`/`awaitUser` 才回调 `SumsubTxnClient.getTxn(kytTxnId)` 读 `typedTags`，挑出 scene tag（`SANCTION`/`PEP`）和 officer 处置 tag（`FROZEN_BY_MLRO`/`RETURN_TO_SENDER`）；按 `kytTxnId`（即 `sumsubFinanceTxnId` 或 `sumsubTravelRuleTxnId`，稳定业务键非 `id`）反查 deposit（`findBySumsubTxnId`），查不到记 orphan warn；再调 `DepositWorkflowService.applyKytVerdict(depositId, { verdict, sceneTag?, dispoTag? })`。
- **applyKytVerdict 状态转移**（`deposit-workflow.service.ts`；state-aware：已终态直接 no-op 防迟到 webhook，已在目标态也 no-op 防重复 webhook）：
  - `approved` → 若当前 `MANUAL_CHECKING`，先补一条 `DEPOSIT_MANUAL_APPROVED`"翻案"审计，再统一调 `approveDeposit()`（TB Step2 `DEPOSIT_SUSPENSE→CLIENT_PAYABLE`）→ `SUCCESS`。
  - `awaitUser` → 非终态 → `ACTION_PENDING`；`manualReason` 按 `sceneTag==='PEP'` 写 `EDD_PEP`，否则 `CLIENT_ACTION`；`slaDeadline = now + 7d`。
  - `onHold` → **不换状态**，留在 `COMPLIANCE_PENDING`，只刷新 `slaDeadline = now + 7d`，记 `DEPOSIT_ONHOLD` 审计，等 officer 在 Sumsub 侧裁决。
  - `rejected` → 按 tag 三分支：`sceneTag===SANCTION` 或 `dispoTag===FROZEN_BY_MLRO` → `FREEZE` → `FROZEN`（零记账，见下）；`dispoTag===RETURN_TO_SENDER` → `RETURN` → `RETURNING`（只落状态位，两腿回款结算留计划2）；两种 tag 都没有 → `MANUAL_CHECK` → `MANUAL_CHECKING`（转人工复核）。
- **FROZEN 语义（已校正）**：钱仍停在 Step1 记的 `DEPOSIT_SUSPENSE`（COMPLIANCE_PENDING 入口已借记），FROZEN 不触发任何额外记账——不反转、不释放、**不建 `CLIENT_BLOCKED` 类科目**。
- **SLA 定时器**：`DepositSlaService`（`deposit-sumsub/deposit-sla.service.ts`）`@Cron('*/5 * * * *', { timeZone: 'Asia/Dubai' })` 扫 `COMPLIANCE_PENDING`（onHold 留在此态）/`ACTION_PENDING` 且 `slaDeadline < now` 且 `slaBreached=false` 的 deposit，逐条驱动 `MANUAL_CHECK` → `MANUAL_CHECKING`，`extraData` 写 `slaBreached=true`（防重复扫），记 `DEPOSIT_SLA_BREACHED` 审计。
- **锚点**：`deposit-workflow.service.ts → submitSumsubTxns()/applyKytVerdict()`（+ 私有 `applyKyt*` 分支方法）｜ `sumsub-ingestion.service.ts → dispatch()`（前置分流）｜ `deposit-sumsub/deposit-webhook.router.ts` ｜ `deposit-sumsub/deposit-kyt-verdict.handler.ts` ｜ `deposit-sumsub/deposit-sla.service.ts` ｜ `deposit-sumsub/sumsub-txn-client.{interface,http,mock}.ts` ｜ `deposit-transactions.service.ts → setSumsubTxnIds()/findBySumsubTxnId()/setSlaDeadline()/findSlaBreachCandidates()`

### 4.2 老 mock kyt-check/tr-check 路径（deposit-only 未拆，仍并存）

- **字段**：Deposit 表 `kytStatus`（PENDING→PASSED/FAILED）+ `travelRuleRequired` + `travelRuleStatus`（PENDING→PASSED/FAILED/NOT_REQUIRED），法币 TR 初值 NOT_REQUIRED——本计划**未删未改**这套字段。
- **分发**：`POST /admin/sumsub/simulate/kyt-check` + `tr-check` 仍走 Sumsub ingest 同一管道 → `applyKytResult()`/`applyTrResult()` → `checkAutoApproval()`（KYT+TR 双通过 + 客户合规状态正常 + trading-ready 地址就绪才 `approveDeposit()`）。与 4.1 的 `applyKytVerdict()` 是**两条独立入口**：`applyKytVerdict()` 走这条新路径时**不**经过 `checkAutoApproval()` 的 trading-ready 门（两条路径的门禁不对称，本计划未收敛，如实记录）。
- **锚点**：`admin-sumsub-simulation.controller.ts → simulateKytCheck()/simulateTrCheck()` ｜ `deposit-workflow.service.ts → applyKytResult()/applyTrResult()/checkAutoApproval()`

## 5. 异常分支现状（计划1 后：KYT-only webhook 驱动为主，骨架仍有缺口）

| 分支 | 状态态 | 转移路径 | 记账 | officer/MLRO 门 |
|---|---|---|---|---|
| ACTION_PENDING 补材料 | ✅ | ✅ COMPLIANCE_PENDING↔ACTION_PENDING（awaitUser verdict 进 / RESUME 出）| 无需 | — |
| onHold 挂起（新）| ✅ | 留在 COMPLIANCE_PENDING 不换态，只刷 `slaDeadline`；SLA 到期转 MANUAL_CHECKING | 无需 | ✅ officer 在 Sumsub 侧裁决后发新 webhook |
| FROZEN 制裁/官方冻结 | ✅ | rejected(SANCTION tag 或 officer 打 FROZEN_BY_MLRO tag) → FREEZE 进；APPROVE/CONFISCATE/RETURN/SEIZE/RESUME 出边都在 | **零记账（设计如此，非缺口）**：钱留在 Step1 记的 DEPOSIT_SUSPENSE，不反转不释放 | ✅ officer 打 `FROZEN_BY_MLRO` tag 驱动进 |
| MANUAL_CHECKING 人工复核（新）| ✅ | rejected(无处置tag) 或 SLA breach → MANUAL_CHECK 进；APPROVE(翻案记 `DEPOSIT_MANUAL_APPROVED`)/FREEZE/RETURN 出边都在 | 翻案批准才记账（走 approved 分支的 `approveDeposit`）| — |
| RETURNING 原路退回中（新，止于此）| ✅进 / ❌出 | rejected(RETURN_TO_SENDER tag) → RETURN 进；出边 `RETURNED_DONE`→`RETURNED` 无 workflow 方法调用，只能靠 admin PATCH 直改触发 | ❌ 两腿回款记账未做（计划2）| — |
| SEIZING 没收处理中（新，止于此）| ✅进 / ❌出 | FROZEN → SEIZE 进（同上，只能 admin PATCH 直改，无 workflow 调用）；转移表未定义任何离开 SEIZING 的 action，进了出不来 | ❌ 未做（计划2）| — |
| REJECTED | ✅ | ✅ 转移在 | ❌ **无反向分录** | — |
| Payin FAILED | ✅ | ✅ `onPayinFailed` | ❌ **无反向分录** | — |
| EXPIRED | ✅ | ✅ ACTION_PENDING→EXPIRED | ❌ **无反向分录** | — |
| 法币名义不符 | ❌ | 无（`InboundTransferSignal` 无 `senderName` 字段）| — | — |
| 法币银行退汇 bounce | ❌ | 无（无 bounce 字段/入口）| — | — |
| 老 mock 路径 KYT FAILED（4.2）| ⚠️ | **死胡同**：`checkAutoApproval()` 只在 `kytStatus==='PASSED'` 才继续，FAILED 不转 FROZEN 不转终态，永挂 COMPLIANCE_PENDING（本计划未碰这条老路径）| — | — |

- 🔴 **半截桥风险（未变）**：`adminReject`/`adminFreeze` 端点已上线，但 deposit 模块**零回退分录代码**（全仓 grep reverse/void/rollback 为空）——已过 Step1 的充值被拒 → 钱永久滞留 DEPOSIT_SUSPENSE。临时守卫卡片 task_16af8187（见 BACKLOG）。
- **CONFISCATE**（FROZEN→CONFISCATED，pre-existing）/ **RETURNED_DONE**（RETURNING→RETURNED，新）/ **SEIZE**（FROZEN→SEIZING，新）均走 PATCH `updateStatus()` 的 default 分支直改状态，绕过 workflow 与记账——本计划新增的两个 action 沿用了同一老口子，未收窄。
- **枚举里 `SEIZED`/`CONFISCATING` 是纯占位**：`SEIZED` 只出现在终态判定集合里，转移表没有任何 action 能把状态转成 `SEIZED`（`SEIZING` 无出边）；`CONFISCATING` 在 `deposit-transactions.service.ts` 转移表里 0 引用，是尚未使用的孤儿枚举值。两腿 pending→post 结算 + 审批管道 + 解冻回炉 + below-min→CONFISCATING 全留计划2（见 BACKLOG）。
- **锚点**：`deposit-workflow.service.ts → runGate0()`（L1 冻结）｜ `deposit-transactions.controller.ts → updateStatus()`（PATCH 路由，仅 APPROVE/REJECT/FREEZE 走 workflow，其余 action 走 default 直改）｜ `deposit-transactions.service.ts → updateStatus()/getNextStatus()`（转移表）

## 6. 支撑项（均 ✅ 存活）

事件驱动编排（Payin/funds_order 事件 → DepositWorkflowService）｜ KYT/TR 模拟端点 ｜ Admin Deposit 列表/详情 ｜ Client 三 Tab（Crypto/Fiat/History）+ QR + VIBAN ｜ **Tipping-off 映射**（FROZEN/ACTION_PENDING/COMPLIANCE_PENDING 对客户统一显示 `Processing`，`Deposit.tsx getCustomerFacingStatus`）｜ Overview 余额读 TB。

## 7. 已确认技术债（详见 BACKLOG.md）

txHash 唯一约束仅在信号层（Deposit/资金单层缺）｜ TB 记账失败仅记 `DEPOSIT_ACCOUNTING_BLOCKED` 审计后卡住、无 repair surface ｜ `deposit.status.changed` 用 `emit` 非 `emitAsync`（异常不传播）｜ PATCH 仅 SUCCESS 被守卫（FREEZE/CONFISCATE 可绕）｜ ERC-20 合约失败未过滤 ｜ KYT 超时转人工未做 ｜ 区块重组自动回退未做。
