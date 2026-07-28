# V4 充值流程 — 当前实现真相

Last Verified: 2026-07-17（核对方式：没收改异步两阶段——CONFISCATING 中间态 + startConfiscation/settleConfiscation + 资金单 legSeq=2 判 INTERNAL + pending→post 幂等逐符号核实；below-min 挂起/PASS 沿用本轮基线；余节沿用 2026-07-03 三路 subagent 走查基线）

> 本文只描述"现在是什么样"。改代码必须同步本文。计划看 roadmap，欠账看 BACKLOG.md。

---

## 1. 充值资金单（funds_orders 充值切片）

> 📖 资金单状态机 / 共享执行引擎 → [funds-orders.md](funds-orders.md)。本节只写充值切片。

充值资金单 = `depositTransactionId` 非空的 `funds_order`（Payin 表已并入）。虚拟币走 CRYPTO 状态机（含 CONFIRMING），法币出生即 `CONFIRMED`（跳过 CONFIRMING）→ CLEARED。**一笔充值可挂两个 funds_order**：`legSeq=1` 是 payin 本体；`legSeq=2`（仅没收成立时才建）是没收动腿（客户充值钱包→平台 F_FEE 钱包，**出生态 `CREATED`**）——两者同挂 `depositTransactionId`，但 `funds-order.service.ts → directionOf()` 按 `父FK + legSeq` 判 `direction`：`legSeq=1` 算 `IN`，**`legSeq>1` 算 `INTERNAL`**（内部重分类腿，出生 `CREATED`，走 INTERNAL/OUT 迁移表逐步推进——`IN` 表无 `CREATED` 首段，payin 出生即 SUBMITTED/CONFIRMED，详见 [funds-orders.md](funds-orders.md) §2）。`handleFundsOrderChanged` 按 legSeq 分流：`legSeq===1` 走 payin 事件（`onPayinConfirmed`/`onPayinFailed`）；`legSeq===2` 走 `onConfiscationLegChanged`（该腿 CONFIRMED 触发没收结算，见第 6 节）；其余 legSeq 直接 return，绝不误入 payin 路径。
- **锚点**：`funds-order-transitions.constant.ts → CRYPTO_IN_TRANSITIONS` ｜ `deposit-transactions.service.ts → detected()`（法币出生态 initialStatus）｜ `deposit-workflow.service.ts → handleFundsOrderChanged()`（`legSeq===1` 走 payin / `legSeq===2` 走 `onConfiscationLegChanged` / 其余 return）

## 2. 充值订单（DepositTransaction）状态机

十态：`PAYIN_PENDING → COMPLIANCE_PENDING → SUCCESS`（happy）；异常态 `ACTION_PENDING / FROZEN / REJECTED / FAILED / EXPIRED`（转移路径已铺，见第 5 节）；没收链路含 `CONFISCATING`（**新增中间态，非终态**）→ 治理终态 `CONFISCATED`。**两条没收弧**：below-min 走 `COMPLIANCE_PENDING --CONFISCATE_START--> CONFISCATING --CONFISCATE_SETTLE--> CONFISCATED`（异步两阶段，见第 6 节）；制裁走 `FROZEN --CONFISCATE--> CONFISCATED`（单跳，路径不变）。

- **新增字段** `limitHoldReason`（nullable，现仅一个取值 `'BELOW_MIN'`）：L1 金额下限挂起标记，充值出生时由 `detected()` 落标，`clearLimitHold()`（PASS）清除；没收不清标（CONFISCATING/CONFISCATED 仍带 `BELOW_MIN`，故对客户面持续隐藏，见第 5 节）
- **锚点**：`deposit-transactions.service.ts` 状态枚举（10 个）+ `getNextStatus`（`CONFISCATED` 入 `TERMINAL` 集合；**`CONFISCATING` 不在 TERMINAL**，仅 `CONFISCATE_SETTLE` 一条出弧）

## 3. Happy Path（双链路，均 ✅ 验证）

**虚拟币**：链上到账 → 资金单 CONFIRMED → **TB Step1**（`CLIENT_ASSET → DEPOSIT_SUSPENSE`）→ Deposit COMPLIANCE_PENDING → **L1 资格门** → **L2 交易筛查**（kyt + TR 双状态）→ 自动审批 → **TB Step2**（`DEPOSIT_SUSPENSE → CLIENT_PAYABLE`）→ SUCCESS。

**法币**：VIBAN 到账（`InboundTransferSignal` 信号入口）→ 资金单出生即 CONFIRMED（无确认阶段）→ Step1 → L1 → L2（KYT；**TR 硬写 NOT_REQUIRED**）→ Step2 → SUCCESS。

- **TB 两步借贷**（实时 1:1 后新 COA，旧 CUSTODY/BANK 已改）：Step1 `CLIENT_ASSET(1) → DEPOSIT_SUSPENSE(101)`；Step2 `DEPOSIT_SUSPENSE(101) → CLIENT_PAYABLE(100)`
- **L1 时点**：在**信号创建时**即调 `onboardingService.assertTradingEligibility(customerId, 'DEPOSIT')`（比"生成 Deposit 后"更前置）
- **L2 收敛**：`kytStatus === 'PASSED'` 且 `travelRuleStatus ∈ {PASSED, NOT_REQUIRED}` 才自动审批
- **锚点**：`deposit-workflow.service.ts → checkAutoApproval()`（自动审批）｜ `→ executeDepositAccounting()`（两步记账）｜ `inbound-transfer-signals.service.ts → createForCustomer()`（L1）

## 4. 合规门字段与分发

- **字段**：Deposit 表 `kytStatus`（PENDING→PASSED/FAILED）+ `travelRuleRequired` + `travelRuleStatus`（PENDING→PASSED/FAILED/NOT_REQUIRED），法币 TR 初值 NOT_REQUIRED
- **分发**：KYT/TR 模拟端点 `POST /admin/sumsub/simulate/kyt-check` + `tr-check` 走 Sumsub ingest 同一管道；真实 Sumsub webhook 对 Deposit-KYT/TR 的消费链路**未见部署**（当前靠模拟端点驱动）
- **锚点**：`admin-sumsub-simulation.controller.ts → simulateKytCheck()/simulateTrCheck()` ｜ `sumsub-ingestion.service.ts → dispatch()`

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

## 7. 异常分支现状（骨架已铺，闭环缺失）

| 分支 | 状态态 | 转移路径 | 记账回退 | MLRO 门 |
|---|---|---|---|---|
| ACTION_PENDING 补材料 | ✅ | ✅ COMPLIANCE↔ACTION_PENDING（RESUME）| 无需 | — |
| FROZEN 制裁 | ✅ | L1 入口自动冻结 ✅；APPROVE/CONFISCATE 路径在 | ❌ 无 | ❌ 无 |
| REJECTED | ✅ | ✅ 转移在 | ❌ **无反向分录** | — |
| Payin FAILED | ✅ | ✅ `onPayinFailed` | ❌ **无反向分录** | — |
| EXPIRED | ✅ | ✅ ACTION_PENDING→EXPIRED | ❌ **无反向分录** | — |
| BELOW_MIN 没收 | ✅ | ✅ COMPLIANCE_PENDING→CONFISCATING→CONFISCATED（异步两阶段）| ✅ 两腿反向+确认收入（pending→post，见第 6 节）| ✅ OPS_OFFICER maker-checker |
| 法币名义不符 | ❌ | 无（`InboundTransferSignal` 无 `senderName` 字段）| — | — |
| 法币银行退汇 bounce | ❌ | 无（无 bounce 字段/入口）| — | — |
| KYT FAILED | ⚠️ | **死胡同**：不转 FROZEN 不转终态，永挂 COMPLIANCE_PENDING | — | — |

- 🔴 **半截桥风险（缩小但未消除）**：`adminReject`/`adminFreeze` 端点已上线，但 deposit 模块对 REJECTED/FAILED/EXPIRED **仍零回退分录代码**——已过 Step1 的充值被拒 → 钱永久滞留 DEPOSIT_SUSPENSE。本轮**只给 BELOW_MIN 没收一条路径**补上了反向分录（第 6 节 Leg1），其余异常终态仍是半截桥。临时守卫卡片 task_16af8187（见 BACKLOG）。
- **CONFISCATE 正门治理 + PATCH 侧门已封（本轮硬化）**：`POST :id/confiscate` 走 `initiateConfiscation → 审批 → onConfiscationDecided → startConfiscation →（ops 步进 legSeq=2 资金单）→ settleConfiscation` 治理链（先 pending 锁账推 CONFISCATING，资金单 CONFIRMED 才 POST 落 CONFISCATED）；而 `PATCH :id/status` 的 `default` 分支虽仍直调 `deposit-transactions.service.ts → updateStatus()`，但 `ACCOUNTING_TERMINALS` 现已从 `{SUCCESS}` 扩到 **`{SUCCESS, CONFISCATED, CONFISCATING}`**——ADMIN_API 来源的 PATCH 若把 `nextStatus` 推向这三者即被 `DEPOSIT_APPROVE_WORKFLOW_ONLY` 拒绝。即 admin **不再能**用旧 PATCH 裸拍 `CONFISCATED`/`CONFISCATING`（`confiscate`/`confiscate_start`/`confiscate_settle` 三个 action 全被拦），"状态已终态但两腿未入账"的账实不符已堵。**⚠️ FREEZE 侧门仍开**：`FROZEN ∉ ACCOUNTING_TERMINALS`，PATCH `action='freeze'` 仍可直拍 FROZEN（既存技术债，见 BACKLOG"Admin PATCH deposit status 部分绕过 workflow"）
- **锚点**：`deposit-workflow.service.ts → runGate0()`（L1 冻结）｜ `deposit-transactions.controller.ts → updateStatus()`（PATCH 路由；CONFISCATE 治理正门是独立 `:id/confiscate` 端点）｜ `deposit-transactions.service.ts → updateStatus()`（`ACCOUNTING_TERMINALS={SUCCESS,CONFISCATED,CONFISCATING}` + `DEPOSIT_APPROVE_WORKFLOW_ONLY` 守卫；FREEZE→FROZEN 仍可绕）

## 8. 支撑项（均 ✅ 存活）

事件驱动编排（Payin/funds_order 事件 → DepositWorkflowService）｜ KYT/TR 模拟端点 ｜ Admin Deposit 列表/详情（含 BELOW MIN 徽章 + PASS/Confiscate 处置按钮；**`CONFISCATING` 琥珀徽章 + 在途横幅**「步进下方资金单，确认后自动完成没收」；没收生命周期内（CONFISCATING/CONFISCATED）通用 Actions 组整组隐藏；关联的没收资金单以 `Fee · Confiscation` 与本金 `Principal · Payin` 并列展示，`DepositTransactionDetail.tsx`）｜ Client 三 Tab（Crypto/Fiat/History）+ QR + VIBAN ｜ **Tipping-off 映射**（FROZEN/ACTION_PENDING/COMPLIANCE_PENDING 对客户统一显示 `Processing`，`Deposit.tsx getCustomerFacingStatus`；BELOW_MIN 挂起走服务端隐藏而非文案映射，见第 5 节）｜ Overview 余额读 TB。

## 9. 已确认技术债（详见 BACKLOG.md）

txHash 唯一约束仅在信号层（Deposit/资金单层缺）｜ TB 记账失败仅记 `DEPOSIT_ACCOUNTING_BLOCKED` 审计后卡住、无 repair surface ｜ `deposit.status.changed` 用 `emit` 非 `emitAsync`（异常不传播）｜ PATCH 现守 `{SUCCESS,CONFISCATED,CONFISCATING}`（CONFISCATE 侧门已封，**仅 FREEZE→FROZEN 仍可绕**，详见第 7 节）｜ ERC-20 合约失败未过滤 ｜ KYT 超时转人工未做 ｜ 区块重组自动回退未做 ｜ 原路退回 / below-min 计次自动冻结 / 自动没收 cron 均 deferred（见 BACKLOG）。
