# V4 充值流程 — 当前实现真相

Last Verified: 2026-07-28（核对方式：① 充值状态机·计划1 引擎 12 task 落地后 symbol-level 复核，新增第 4.1/4.2 节 + 状态机/异常分支表同步，同日终审修复 I1/I2/onHold/awaitUser 原子化；② 没收改异步两阶段——CONFISCATING 中间态 + startConfiscation/settleConfiscation + 资金单 legSeq=2 判 INTERNAL + pending→post 幂等逐符号核实，below-min 挂起/PASS 沿用该轮基线；③ 2026-07-28 两支合并后交叉复核第 2/7 节——`CONFISCATING` 已由"孤儿占位"转为真实接线，没收路径已有反向分录，两处旧表述已校正；④ 2026-07-28 计划2·A1（地基补齐）落地——`SEIZING→SEIZED_DONE→SEIZED` 转移边补上（此前 `SEIZING` 零出边、`SEIZED` 不可达），第 2/7 节同步校正；A1 仅铺地基（转移边 + COA 科目 `FIRM_SEIZED`=204 + TB 转账码 5-9/20 + 12 个审计常量），零 workflow/记账/审批接线，故记账列仍标 ❌；⑤ 2026-07-28 计划2·A2（退回/上缴/解冻审批扩展）落地——复刻没收 maker-checker 范式，新增 `DEPOSIT_RETURN`(MLRO 单步)/`DEPOSIT_SEIZE`(SENIOR_MANAGEMENT_OFFICER→MLRO 双步)/`DEPOSIT_UNFREEZE`(MLRO 单步)三个 V1 actionType + 3 个 handler service + `initiateReturn/initiateSeize/initiateUnfreeze` + 3 个 decided 监听器；**本轮只接审批骨架**，批准后的执行侧（`onReturnApproved`/`onSeizeApproved`/`onUnfreezeApproved`）是桩（只打日志，不落转移/记账），真正执行留 A3(退回)/A4(上缴)/A5(解冻)；`applyKytRejected` 的 `RETURN_TO_SENDER` 分支同步改为调 `initiateReturn()` 开审批而非直推 `RETURNING`（deposit 现留 `MANUAL_CHECKING`），第 4.1/7 节同步校正；余节沿用 2026-07-03 三路 subagent 走查基线）

> 本文只描述"现在是什么样"。改代码必须同步本文。计划看 roadmap，欠账看 BACKLOG.md。

---

## 1. 充值资金单（funds_orders 充值切片）

> 📖 资金单状态机 / 共享执行引擎 → [funds-orders.md](funds-orders.md)。本节只写充值切片。

充值资金单 = `depositTransactionId` 非空的 `funds_order`（Payin 表已并入）。虚拟币走 CRYPTO 状态机（含 CONFIRMING），法币出生即 `CONFIRMED`（跳过 CONFIRMING）→ CLEARED。**一笔充值可挂两个 funds_order**：`legSeq=1` 是 payin 本体；`legSeq=2`（仅没收成立时才建）是没收动腿（客户充值钱包→平台 F_FEE 钱包，**出生态 `CREATED`**）——两者同挂 `depositTransactionId`，但 `funds-order.service.ts → directionOf()` 按 `父FK + legSeq` 判 `direction`：`legSeq=1` 算 `IN`，**`legSeq>1` 算 `INTERNAL`**（内部重分类腿，出生 `CREATED`，走 INTERNAL/OUT 迁移表逐步推进——`IN` 表无 `CREATED` 首段，payin 出生即 SUBMITTED/CONFIRMED，详见 [funds-orders.md](funds-orders.md) §2）。`handleFundsOrderChanged` 按 legSeq 分流：`legSeq===1` 走 payin 事件（`onPayinConfirmed`/`onPayinFailed`）；`legSeq===2` 走 `onConfiscationLegChanged`（该腿 CONFIRMED 触发没收结算，见第 6 节）；其余 legSeq 直接 return，绝不误入 payin 路径。
- **锚点**：`funds-order-transitions.constant.ts → CRYPTO_IN_TRANSITIONS` ｜ `deposit-transactions.service.ts → detected()`（法币出生态 initialStatus）｜ `deposit-workflow.service.ts → handleFundsOrderChanged()`（`legSeq===1` 走 payin / `legSeq===2` 走 `onConfiscationLegChanged` / 其余 return）

## 2. 充值订单（DepositTransaction）状态机

Happy path：`PAYIN_PENDING → COMPLIANCE_PENDING → SUCCESS`；异常态 `ACTION_PENDING / FROZEN / REJECTED / FAILED / EXPIRED`（转移路径已铺，见第 7 节）。

充值状态机·计划1 引擎（2026-07 落地）新增 `MANUAL_CHECKING`（人工复核）/ `RETURNING`（原路退回处理中）/ `SEIZING`（没收处理中）三个中间态，均**已接线进转移表**（见第 7 节）。没收链路另有 `CONFISCATING`（**中间态，非终态**）→ 治理终态 `CONFISCATED`。**两条没收弧**：below-min 走 `COMPLIANCE_PENDING --CONFISCATE_START--> CONFISCATING --CONFISCATE_SETTLE--> CONFISCATED`（异步两阶段，见第 6 节）；制裁走 `FROZEN --CONFISCATE--> CONFISCATED`（单跳，路径不变）。

枚举里两个终态均**已铺转移边、仍未接线进 workflow**：`RETURNED` 可经 `RETURNING→RETURNED_DONE` 到达；`SEIZED` 可经 `SEIZING→SEIZED_DONE` 到达（计划2·A1 新增，2026-07-28，`SEIZING` 此前零出边）——两个 action 均无业务 workflow 调用方（只能走 admin PATCH 直改）。RETURNING/SEIZING 两腿资金结算 + 解冻回炉留计划2 后续任务（见 BACKLOG）。

- **新增字段** `limitHoldReason`（nullable，现仅一个取值 `'BELOW_MIN'`）：L1 金额下限挂起标记，充值出生时由 `detected()` 落标，`clearLimitHold()`（PASS）清除；没收不清标（CONFISCATING/CONFISCATED 仍带 `BELOW_MIN`，故对客户面持续隐藏，见第 5 节）
- **锚点**：`deposit-transaction.dto.ts → DepositTransactionStatus/DepositTransactionAction` 枚举 ｜ `deposit-transactions.service.ts → getNextStatus()` 转移表（`CONFISCATED` 入 `TERMINAL` 集合；**`CONFISCATING` 不在 TERMINAL**，仅 `CONFISCATE_SETTLE` 一条出弧）

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
- **提交**：进 COMPLIANCE_PENDING（Gate 0 通过后）时 `submitSumsubTxns()` 向 Sumsub 提交交易——法币只提 `finance` 腿，虚拟币提 `finance` + `travelRule` 两腿；`applicantId` 取 `customer.sumsubApplicantId`，取不到则告警跳过（充值留在 COMPLIANCE_PENDING 等人工处理，不报错不卡流程）；以 `sumsubFinanceTxnId` 是否已存在做幂等（防 `runGate0` 重入重复提交）；写 `DEPOSIT_SUMSUB_SUBMITTED` 审计。`runGate0()` 里这次调用整段包 try/catch（终审修复 I2）：真 HTTP 抛错（缺 creds/超时/5xx）只记 `logger.error` 降级，不再中断 `runGate0`——`initializeComplianceGates()` 照常执行，deposit 留 COMPLIANCE_PENDING 等人工/后续重试，不会 strand。
- **webhook 前置分流**：`sumsub-ingestion.service.ts → dispatch()` 在旧 if/else 分支**之前**新增一段——`payload.type` 以 `applicantKytTxn` 开头即整段转交 `DepositWebhookRouter.route()`，复用 `SumsubWebhookEvent` 既有的去重/retry/dead-letter，只是路由目标不同。`applicantAction*` 事件**不**进这条分支，仍走 dispatch() 里更早的老 Clue 3 分支（材料时效重检，消费方是 V2 `materialRefreshService`）——两者互不干扰；客户补料后 Sumsub 侧自动重评发出的仍是 `applicantKytTxn*`，走新分支，无需专门的 action handler 接住补料事件本身。
- **DepositWebhookRouter**（`deposit-sumsub/deposit-webhook.router.ts`）：按 `payload.type` 二次分流——`applicantKytTxnApproved/Rejected/AwaitingUser/OnHold` → `DepositKytVerdictHandler.handle()`；`applicantKytTxnReviewed` → 归一为 `ignore`，不推进状态机；`applicantKytTxnCreated` → 只记 debug 回执，no-op；其余未知 type → warn 记 orphan。
- **DepositKytVerdictHandler**（`deposit-sumsub/deposit-kyt-verdict.handler.ts`）：把 webhook type 归一成 `KytVerdict`（`approved/rejected/awaitUser/onHold`）；只有 `rejected`/`awaitUser` 才回调 `SumsubTxnClient.getTxn(kytTxnId)` 读 `typedTags`，挑出 scene tag（`SANCTION`/`PEP`）和 officer 处置 tag（`FROZEN_BY_MLRO`/`RETURN_TO_SENDER`）；按 `kytTxnId`（即 `sumsubFinanceTxnId` 或 `sumsubTravelRuleTxnId`，稳定业务键非 `id`）反查 deposit（`findBySumsubTxnId`），查不到记 orphan warn；再调 `DepositWorkflowService.applyKytVerdict(depositId, { verdict, sceneTag?, dispoTag? })`。
- **applyKytVerdict 状态转移**（`deposit-workflow.service.ts`；state-aware：已终态直接 no-op 防迟到 webhook，已在目标态也 no-op 防重复 webhook）：
  - `approved` → 先过 `assertTradingReadyOrHold()`（trading-ready 闸，见下方 4.2 节"已收敛"说明），不通过则原地 hold（不改状态）+ 记 `DEPOSIT_HELD_NOT_TRADING_READY` 审计、直接 return；通过后若当前 `MANUAL_CHECKING`，先补一条 `DEPOSIT_MANUAL_APPROVED`"翻案"审计，再统一调 `approveDeposit()`（TB Step2 `DEPOSIT_SUSPENSE→CLIENT_PAYABLE`）→ `SUCCESS`。
  - `awaitUser` → 非终态 → `ACTION_PENDING`；`manualReason` 按 `sceneTag==='PEP'` 写 `EDD_PEP`，否则 `CLIENT_ACTION`；`slaDeadline = now + 7d` 与 `manualReason` 折进同一次 `updateStatus` 的 `extraData`，一次原子写（终审修复，原为两步写）。
  - `onHold` → 仅当当前 `status===COMPLIANCE_PENDING` 才生效（终审修复，加状态守卫防迟到 webhook 重写 SLA/记多余审计）：**不换状态**，留在 `COMPLIANCE_PENDING`，只刷新 `slaDeadline = now + 7d`，记 `DEPOSIT_ONHOLD` 审计，等 officer 在 Sumsub 侧裁决；若已转到其它状态则直接 no-op。
  - `rejected` → 按 tag 三分支：`sceneTag===SANCTION` 或 `dispoTag===FROZEN_BY_MLRO` → `FREEZE` → `FROZEN`（零记账，见下）；`dispoTag===RETURN_TO_SENDER` → **（计划2·A2 改）** 调 `initiateReturn()` 开 `DEPOSIT_RETURN` maker-checker 审批（MLRO 单步），deposit 留 `MANUAL_CHECKING`（此前直推 `RETURNING`）；审批 `APPROVED` 后 `onReturnDecided()` 现仅调 `onReturnApproved()` 桩（只打日志，真正的 `RETURN`→`RETURNING` 转移 + 两腿回款记账留 A3）；重复 webhook 命中已有 PENDING 审批时捕获 `ConflictException` 幂等 no-op；两种 tag 都没有 → `MANUAL_CHECK` → `MANUAL_CHECKING`（转人工复核）。
- **FROZEN 语义（已校正）**：钱仍停在 Step1 记的 `DEPOSIT_SUSPENSE`（COMPLIANCE_PENDING 入口已借记），FROZEN 不触发任何额外记账——不反转、不释放、**不建 `CLIENT_BLOCKED` 类科目**。
- **SLA 定时器**：`DepositSlaService`（`deposit-sumsub/deposit-sla.service.ts`）`@Cron('*/5 * * * *', { timeZone: 'Asia/Dubai' })` 扫 `COMPLIANCE_PENDING`（onHold 留在此态）/`ACTION_PENDING` 且 `slaDeadline < now` 且 `slaBreached=false` 的 deposit，逐条驱动 `MANUAL_CHECK` → `MANUAL_CHECKING`，`extraData` 写 `slaBreached=true`（防重复扫），记 `DEPOSIT_SLA_BREACHED` 审计。
- **锚点**：`deposit-workflow.service.ts → submitSumsubTxns()/applyKytVerdict()`（+ 私有 `applyKyt*` 分支方法，`RETURN_TO_SENDER` 分支现调 `initiateReturn()`）｜ `sumsub-ingestion.service.ts → dispatch()`（前置分流）｜ `deposit-sumsub/deposit-webhook.router.ts` ｜ `deposit-sumsub/deposit-kyt-verdict.handler.ts` ｜ `deposit-sumsub/deposit-sla.service.ts` ｜ `deposit-sumsub/sumsub-txn-client.{interface,http,mock}.ts` ｜ `deposit-transactions.service.ts → setSumsubTxnIds()/findBySumsubTxnId()/setSlaDeadline()/findSlaBreachCandidates()`

### 4.2 老 mock kyt-check/tr-check 路径（deposit-only 未拆，仍并存）

- **字段**：Deposit 表 `kytStatus`（PENDING→PASSED/FAILED）+ `travelRuleRequired` + `travelRuleStatus`（PENDING→PASSED/FAILED/NOT_REQUIRED），法币 TR 初值 NOT_REQUIRED——本计划**未删未改**这套字段。
- **分发**：`POST /admin/sumsub/simulate/kyt-check` + `tr-check` 仍走 Sumsub ingest 同一管道 → `applyKytResult()`/`applyTrResult()` → `checkAutoApproval()`（KYT+TR 双通过 + 客户合规状态正常 + trading-ready 地址就绪才 `approveDeposit()`）。与 4.1 的 `applyKytVerdict()` 是**两条独立入口**，但 trading-ready 闸已收敛：两条路径的 approve 分支共享同一个私有 helper `assertTradingReadyOrHold()`（终审修复，此前 `applyKytVerdict()` 走新路径时不经过这道门，2026-07-28 已统一，消除两路门禁漂移）。
- **锚点补充**：`deposit-workflow.service.ts → assertTradingReadyOrHold()`（`checkAutoApproval()` 与 `applyKytApproved()` 共享）
- **锚点**：`admin-sumsub-simulation.controller.ts → simulateKytCheck()/simulateTrCheck()` ｜ `deposit-workflow.service.ts → applyKytResult()/applyTrResult()/checkAutoApproval()`

## 5. 充值最低限额挂起（BELOW_MIN，2026-07-17 落地）

充值是被动入金——L1 金额下限判定**不拒绝**，只落标挂起，等 ops 处置（区别于提现/兑换的建单前拒绝）。

- **判定 + 落标**：`detected()` 出生时调 `TransactionLimitRulesService.getSingleRule('DEPOSIT', assetId)`；`amount < minAmount` 则 `limitHoldReason='BELOW_MIN'`。Deposit 仍正常 CREATED、Step1 仍照常记账入 `DEPOSIT_SUSPENSE`（写模型不变）——挂起只影响客户可见性与自动审批
- **L1 挂起（永久，非临时）**：`checkAutoApproval()` 第一件事就查 `limitHoldReason==='BELOW_MIN'`（先于 KYT/TR），命中则审计 `DEPOSIT_HELD_BELOW_MIN`（每笔充值去重 1 次，同 `DEPOSIT_HELD_NOT_TRADING_READY` 挂起模式）并 return，**永不自动审批**——金额是死的，不会像"客户补材料"那样自愈，必须 ops 显式处置
- **客户面隐藏（D4，服务端强制，非前端过滤）**：客户列表 `findAllForCustomer` 在 `findAll` 上叠加 `limitHoldReason: null`；客户详情 `findOneForCustomer` 对 `limitHoldReason != null` 的记录抛 `NotFoundException`（与"记录不存在"用同一异常，不泄露存在性），同时兼作 IDOR 守卫（`ownerId` 不符也抛同一 404）。Admin 端点（`findAll`/`findOne`）不做此过滤，能看到全部
- **两个处置动作**（均 admin，`deposit-transactions.controller.ts`，均 `assertAdmin` 守卫）：
  - **PASS**（`POST /deposit-transactions/:id/waive-limit`，单人操作，无 maker-checker）：`waiveLimitHold()` 校验 `limitHoldReason==='BELOW_MIN' && status===COMPLIANCE_PENDING` → `clearLimitHold()` 清标 → 审计 `DEPOSIT_LIMIT_WAIVED` → 重跑 `checkAutoApproval()`。**豁免金额下限不等于豁免合规**——清标后照常走 KYT/TR/trading-ready 等 L2 闸门
  - **没收（Confiscate as Fee）**（`POST /deposit-transactions/:id/confiscate`，maker-checker，`OPS_OFFICER` 单步审批，理由必填）：`initiateConfiscation()` 只读校验 + 防重复（同 deposit 不可有两个 PENDING 没收审批）+ 开审批 case（`ApprovalActionTypes.DEPOSIT_CONFISCATION`，snapshot 含 T&C 依据），**不写 deposit 表**（Rule 5：workflow 不直接改状态）。审批 `APPROVED` 后 `onConfiscationDecided()`（监听 `workflow.deposit-confiscation.decided`）触发**异步两阶段没收**（见第 6 节）：**先重新校验一遍 `status===COMPLIANCE_PENDING && limitHoldReason==='BELOW_MIN'`**（发起→裁决之间可能被并发 PASS 或 REJECT 漂移出可没收态；漂移则不记账不建单不改状态，只审计 `DEPOSIT_CONFISCATION_FAILED`）；已 `CONFISCATING`/`CONFISCATED`（启动/结算完成）为幂等 no-op；通过则调 `startConfiscation()`（阶段一：pending 锁两腿 + 建 legSeq=2 资金单 `CREATED` + 状态推 `CONFISCATING`），落地（POST 两腿 + 状态 `CONFISCATED`）由 `settleConfiscation()` 在 legSeq=2 资金单 CONFIRMED 时完成
- **锚点**：`deposit-transactions.service.ts → detected()`（落标）/ `clearLimitHold()`（PASS 清标）｜ `deposit-workflow.service.ts → checkAutoApproval()`（挂起判定，先于 L2）/ `waiveLimitHold()`（PASS）/ `initiateConfiscation()`（没收发起）/ `onConfiscationDecided()`（裁决监听 + 漂移防护 + 幂等）/ `startConfiscation()`（阶段一：pending 锁两腿 + 建 legSeq=2 资金单 + 状态→CONFISCATING）/ `onConfiscationLegChanged()`（legSeq=2 资金单 CONFIRMED 触发）/ `settleConfiscation()`（阶段二：POST 两腿 + 状态→CONFISCATED，3 重试）｜ `deposit-confiscation-approval.service.ts`（`DepositConfiscationApprovalService`，V1 审批处理器绑定 `DEPOSIT_CONFISCATION` actionType）

## 6. 没收记账（异步两阶段，两腿均在 `asset.tbLedgerId` 内）

**没收改异步两阶段**（旧同步单跳 `executeConfiscation` 已拆两段）：**阶段一 `startConfiscation()` 锁账** → ops 手动步进 legSeq=2 资金单 → **阶段二 `settleConfiscation()` 结算 + 落终态**。两腿的账目方向不变，变的是"pending 锁 → post 结"两步走，每段内均"先账后状态"。

- **阶段一 `startConfiscation()`**（审批 APPROVED 后由 `onConfiscationDecided` 触发）：对两腿各调 `accountingService.executePendingTransfer`（**只锁不结**，create pending，`legIndex=1`），建 legSeq=2 资金单（出生 `CREATED`），再把 deposit 推 `CONFISCATING`（`CONFISCATE_START`）。审计 `DEPOSIT_CONFISCATION_STARTED`。
- **阶段二 `settleConfiscation()`**（`FUNDS_ORDER_STATUS_CHANGED` 事件满足 `legSeq===2 && newStatus===CONFIRMED && deposit 仍 CONFISCATING` 才触发）：对两腿各调 `accountingService.postPendingTransfer` 结算——pending id 由 `deterministicTransferId('DEPOSIT', depositNo, eventCode, 1)` **按阶段一同一业务键重算复现**（所以两处 `eventCode` + `legIndex(=1)` 是载荷键，两阶段必须逐字一致），再把 deposit 推 `CONFISCATED`（`CONFISCATE_SETTLE`）。审计 `DEPOSIT_CONFISCATION_EXECUTED`。
- **Leg1**（还原 Step1，`eventCode='CONFISCATE_REVERSE_SUSPENSE'`）：`DR DEPOSIT_SUSPENSE(CUSTOMER) / CR CLIENT_ASSET(SYSTEM)`——把已过 Step1 的暂扣清零，客户身份 Σ `CLIENT_ASSET` == Σ(`CLIENT_PAYABLE`+`DEPOSIT_SUSPENSE`) 两侧同减仍平。这条腿即 roadmap V4 ⚖️P0「已记账异常终态 TB 回退」的**第一块砖**（本轮只做了没收这一种异常终态的回退，REJECTED/FAILED/EXPIRED 仍无反向分录，见第 7 节）
- **Leg2**（确认手续费收入，`eventCode='CONFISCATE_FIRM_FEE'`）：`DR FIRM_ASSET(SYSTEM) / CR FIRM_FEE(SYSTEM)`——公司身份 `FIRM_ASSET` == Σ(`FIRM_OPS`+`FIRM_SET`+`FIRM_FEE`+`FIRM_LIQ`) 两侧同加仍平
- **TB 转账码**：`DEPOSIT_CONFISCATE_SUSPENSE_TO_ASSET`(=3) / `DEPOSIT_CONFISCATE_FIRM_FEE`(=4)；两腿 `isExternalCrossing: false`（托管内重分类，非外部穿越，不产生对账 BREAK）
- **legSeq=2 funds_order**：`startConfiscation()` 建一个 `depositTransactionId` 挂靠、`legSeq=2` 的 funds_order（客户充值钱包 → 平台 `F_FEE` 钱包），**出生态 `CREATED`、不自动推进**——`directionOf` 判其 `INTERNAL`（非 `IN`），ops 经 ⚡ 模拟面板逐步推进 `CREATED→SUBMITTED→CONFIRMED`（走 INTERNAL/OUT 迁移表；`IN` 表无 `CREATED` 首段），到 `CONFIRMED` 即触发阶段二结算；作为该没收动作的按钱包对账锚点；幂等（复跑找已存在的 legSeq=2 单）
- **失败自愈（阶段二）**：`settleConfiscation` post 失败重试 3×；**全失败则 deposit 保持 `CONFISCATING`（不回退、不 rethrow，异步监听器内静默停）** + 审计 `DEPOSIT_CONFISCATION_FAILED` 待人工介入。`postPendingTransfer`/`voidPendingTransfer` 现对 TB 的 `pending_transfer_already_posted`/`pending_transfer_already_voided` 幂等放行（重放 → 干净 no-op，见 [accounting-coa.md](accounting-coa.md) §3 关键流程），故"leg1 已 post、leg2 瞬断"的半截 split 可被下一次重试自愈
- **锚点**：`deposit-workflow.service.ts → startConfiscation()/onConfiscationLegChanged()/settleConfiscation()`｜ `accounting.service.ts → executePendingTransfer()/postPendingTransfer()`｜ `tb-id.util.ts → deterministicTransferId()`｜ `tb-transfer-codes.constant.ts → DEPOSIT_CONFISCATE_SUSPENSE_TO_ASSET/DEPOSIT_CONFISCATE_FIRM_FEE`

## 7. 异常分支现状（计划1 + 没收异步两阶段后：KYT-only webhook 驱动为主，骨架仍有缺口）

| 分支 | 状态态 | 转移路径 | 记账 | officer/MLRO 门 |
|---|---|---|---|---|
| ACTION_PENDING 补材料 | ✅ | ✅ COMPLIANCE_PENDING↔ACTION_PENDING（awaitUser verdict 进 / RESUME 出）| 无需 | — |
| onHold 挂起（新）| ✅ | 留在 COMPLIANCE_PENDING 不换态，只刷 `slaDeadline`；SLA 到期转 MANUAL_CHECKING | 无需 | ✅ officer 在 Sumsub 侧裁决后发新 webhook |
| FROZEN 制裁/官方冻结 | ✅ | rejected(SANCTION tag 或 officer 打 FROZEN_BY_MLRO tag) → FREEZE 进；APPROVE/CONFISCATE/RETURN/SEIZE/RESUME 出边都在 | **零记账（设计如此，非缺口）**：钱留在 Step1 记的 DEPOSIT_SUSPENSE，不反转不释放 | ✅ officer 打 `FROZEN_BY_MLRO` tag 驱动进；计划2·A2 新增 `POST :id/seize`(SENIOR_MANAGEMENT_OFFICER→MLRO 双步)/`POST :id/unfreeze`(MLRO 单步)审批正门，但批准后执行仍是桩（见下方 bullet） |
| MANUAL_CHECKING 人工复核（新）| ✅ | rejected(无处置tag) 或 SLA breach → MANUAL_CHECK 进；APPROVE(翻案记 `DEPOSIT_MANUAL_APPROVED`)/FREEZE/RETURN 出边都在 | 翻案批准才记账（走 approved 分支的 `approveDeposit`）| ✅ 计划2·A2 新增：`RETURN_TO_SENDER` 现调 `initiateReturn()` 开 `DEPOSIT_RETURN` 审批（MLRO 单步），批准后执行仍是桩 |
| RETURNING 原路退回中（新，止于此）| ⚠️进(仅 admin PATCH 侧门) / ❌出 | 计划2·A2 前：rejected(RETURN_TO_SENDER tag) 直接 RETURN 进；A2 后该路径已改走审批（deposit 留 MANUAL_CHECKING，不再自动到这里），`RETURNING` 现仅可经 admin PATCH `action='return'` 侧门或（A3 落地后）审批批准执行触达；出边 `RETURNED_DONE`→`RETURNED` 仍无 workflow 方法调用，只能靠 admin PATCH 直改触发 | ❌ 两腿回款记账未做（计划2，留 A3）| — |
| SEIZING 没收处理中（新）| ⚠️进(仅 admin PATCH 侧门) / ❌出 | FSM 边 FROZEN→SEIZE 未变，但计划2·A2 新增 `POST :id/seize` 审批正门；批准后执行仍是桩（`onSeizeApproved` 只打日志），故目前仍只能经 admin PATCH `action='seize'` 侧门直改触达 `SEIZING`；`SEIZING → SEIZED_DONE → SEIZED` 出边已铺（计划2·A1，2026-07-28），同样无 workflow 调用方 | ❌ 未做（计划2，留 A4）| — |
| REJECTED | ✅ | ✅ 转移在 | ❌ **无反向分录** | — |
| Payin FAILED | ✅ | ✅ `onPayinFailed` | ❌ **无反向分录** | — |
| EXPIRED | ✅ | ✅ ACTION_PENDING→EXPIRED | ❌ **无反向分录** | — |
| BELOW_MIN 没收 | ✅ | ✅ COMPLIANCE_PENDING→CONFISCATING→CONFISCATED（异步两阶段）| ✅ 两腿反向+确认收入（pending→post，见第 6 节）| ✅ OPS_OFFICER maker-checker |
| 法币名义不符 | ❌ | 无（`InboundTransferSignal` 无 `senderName` 字段）| — | — |
| 法币银行退汇 bounce | ❌ | 无（无 bounce 字段/入口）| — | — |
| 老 mock 路径 KYT FAILED（4.2）| ⚠️ | **死胡同**：`checkAutoApproval()` 只在 `kytStatus==='PASSED'` 才继续，FAILED 不转 FROZEN 不转终态，永挂 COMPLIANCE_PENDING（本计划未碰这条老路径）| — | — |

- 🔴 **半截桥风险（缩小但未消除）**：`adminReject`/`adminFreeze` 端点已上线，但 deposit 模块对 REJECTED/FAILED/EXPIRED **仍零回退分录代码**——已过 Step1 的充值被拒 → 钱永久滞留 DEPOSIT_SUSPENSE。**只有 BELOW_MIN 没收一条路径**补上了反向分录（第 6 节 Leg1），其余异常终态仍是半截桥。临时守卫卡片 task_16af8187（见 BACKLOG）。
- **CONFISCATE 正门治理 + PATCH 侧门已封**：`POST :id/confiscate` 走 `initiateConfiscation → 审批 → onConfiscationDecided → startConfiscation →（ops 步进 legSeq=2 资金单）→ settleConfiscation` 治理链（先 pending 锁账推 CONFISCATING，资金单 CONFIRMED 才 POST 落 CONFISCATED）；而 `PATCH :id/status` 的 `default` 分支虽仍直调 `deposit-transactions.service.ts → updateStatus()`，但 `ACCOUNTING_TERMINALS` 现已从 `{SUCCESS}` 扩到 **`{SUCCESS, CONFISCATED, CONFISCATING}`**——ADMIN_API 来源的 PATCH 若把 `nextStatus` 推向这三者即被 `DEPOSIT_APPROVE_WORKFLOW_ONLY` 拒绝。即 admin **不再能**用旧 PATCH 裸拍 `CONFISCATED`/`CONFISCATING`（`confiscate`/`confiscate_start`/`confiscate_settle` 三个 action 全被拦），"状态已终态但两腿未入账"的账实不符已堵。
- **⚠️ 其余 PATCH 侧门仍开**：`FROZEN`/`RETURNING`/`SEIZING`/`RETURNED`/`SEIZED` 均 ∉ `ACCOUNTING_TERMINALS`，故 PATCH `action='freeze'`（→FROZEN）/ `'returned_done'`（RETURNING→RETURNED）/ `'seize'`（FROZEN→SEIZING）/ `'seized_done'`（SEIZING→SEIZED，计划2·A1 新增）仍可走 `updateStatus()` 的 default 分支直改状态，绕过 workflow 与记账。计划1 新增的 `RETURNED_DONE`/`SEIZE`、计划2·A1 新增的 `SEIZED_DONE` 都沿用了这个老口子、未收窄（既存技术债，见 BACKLOG"Admin PATCH deposit status 部分绕过 workflow"）。
- **枚举里 `SEIZED` 曾是纯占位，现已铺出边**：计划2·A1（2026-07-28）新增 `SEIZING → SEIZED_DONE → SEIZED` 转移边（与既有 `RETURNED_DONE` 同构：无 workflow 调用方，仅 admin PATCH 侧门可达，见上表）。`SEIZED` 也 ∉ `ACCOUNTING_TERMINALS`，PATCH `action='seized_done'` 同样不受 `DEPOSIT_APPROVE_WORKFLOW_ONLY` 拦。RETURNING/SEIZING 两腿资金结算 + 解冻回炉留计划2 后续任务（见 BACKLOG）。**注**：`CONFISCATING` 曾在计划1 阶段是孤儿枚举值，没收异步两阶段落地后已真实接线（`CONFISCATE_START` 进 / `CONFISCATE_SETTLE` 出），不再是占位。
- **计划2·A2 落地（2026-07-28）：退回/上缴/解冻接上 maker-checker 审批正门，但执行侧仍是桩**——复刻没收范式：`initiateReturn()`（deposit 需 `MANUAL_CHECKING`，由 KYT `RETURN_TO_SENDER` 自动触发，无 admin 端点）/ `initiateSeize()`/`initiateUnfreeze()`（均需 `FROZEN`，`POST :id/seize`/`POST :id/unfreeze` admin 端点，`orderRef` 必填）均只读校验 + 防重复（同 deposit 不可有两个 PENDING 同类审批）+ 开审批 case（`ApprovalActionTypes.DEPOSIT_RETURN`/`DEPOSIT_SEIZE`/`DEPOSIT_UNFREEZE`），**不写 deposit 表**（Rule 5）。三个 decided 监听器（`workflow.deposit-{return|seize|unfreeze}.decided`）APPROVED 后转调 `onReturnApproved()`/`onSeizeApproved()`/`onUnfreezeApproved()`——**本轮这三个是桩**（只打日志 + TODO，不 throw、不落转移、不记账），真正驱动 `RETURN`/`SEIZE`/`RESUME` 转移 + 记账分别留 A3/A4/A5；DECLINED/CANCELLED/EXPIRED 均只留日志，deposit 原地不动（审批引擎自身已记该决策的审计）。旧 PATCH 侧门（`freeze`/`return`/`seize`/`seized_done`/`returned_done`）不受影响，仍可绕过这三道新审批门直改状态（既存技术债延续，见上一条 bullet）。
- **锚点**：`deposit-workflow.service.ts → runGate0()`（L1 冻结）｜ `deposit-transactions.controller.ts → updateStatus()`（PATCH 路由；CONFISCATE/SEIZE/UNFREEZE 治理正门分别是独立 `:id/confiscate`/`:id/seize`/`:id/unfreeze` 端点）｜ `deposit-transactions.service.ts → updateStatus()/getNextStatus()`（转移表；`ACCOUNTING_TERMINALS={SUCCESS,CONFISCATED,CONFISCATING}` + `DEPOSIT_APPROVE_WORKFLOW_ONLY` 守卫；FREEZE/RETURNED_DONE/SEIZE 仍可绕）｜ `deposit-workflow.service.ts → initiateReturn()/initiateSeize()/initiateUnfreeze()/onReturnDecided()/onSeizeDecided()/onUnfreezeDecided()`（+ 私有 `on{Return|Seize|Unfreeze}Approved()` 桩）｜ `deposit-return-approval.service.ts`/`deposit-seize-approval.service.ts`/`deposit-unfreeze-approval.service.ts`（V1 审批处理器，分别绑定 `DEPOSIT_RETURN`/`DEPOSIT_SEIZE`/`DEPOSIT_UNFREEZE` actionType）

## 8. 支撑项（均 ✅ 存活）

事件驱动编排（Payin/funds_order 事件 → DepositWorkflowService）｜ KYT/TR 模拟端点 ｜ Admin Deposit 列表/详情（含 BELOW MIN 徽章 + PASS/Confiscate 处置按钮；**`CONFISCATING` 琥珀徽章 + 在途横幅**「步进下方资金单，确认后自动完成没收」；没收生命周期内（CONFISCATING/CONFISCATED）通用 Actions 组整组隐藏；关联的没收资金单以 `Fee · Confiscation` 与本金 `Principal · Payin` 并列展示，`DepositTransactionDetail.tsx`）｜ Client 三 Tab（Crypto/Fiat/History）+ QR + VIBAN ｜ **Tipping-off 映射**（FROZEN/ACTION_PENDING/COMPLIANCE_PENDING 对客户统一显示 `Processing`，`Deposit.tsx getCustomerFacingStatus`；BELOW_MIN 挂起走服务端隐藏而非文案映射，见第 5 节）｜ Overview 余额读 TB。

## 9. 已确认技术债（详见 BACKLOG.md）

txHash 唯一约束仅在信号层（Deposit/资金单层缺）｜ TB 记账失败仅记 `DEPOSIT_ACCOUNTING_BLOCKED` 审计后卡住、无 repair surface ｜ `deposit.status.changed` 用 `emit` 非 `emitAsync`（异常不传播）｜ PATCH 现守 `{SUCCESS,CONFISCATED,CONFISCATING}`（CONFISCATE 侧门已封，**FREEZE→FROZEN / RETURNED_DONE / SEIZE 仍可绕**，详见第 7 节）｜ ERC-20 合约失败未过滤 ｜ KYT 超时转人工未做 ｜ 区块重组自动回退未做 ｜ 原路退回两腿回款 / below-min 计次自动冻结 / 自动没收 cron 均 deferred（见 BACKLOG）。
