# V4 充值流程 — 当前实现真相

Last Verified: 2026-07-17（核对方式：deposit-min below-min 挂起/PASS/没收两腿落地逐符号核实，e2e + verify:coa 通过；余节沿用 2026-07-03 三路 subagent 走查基线）

> 本文只描述"现在是什么样"。改代码必须同步本文。计划看 roadmap，欠账看 BACKLOG.md。

---

## 1. 充值资金单（funds_orders 充值切片）

> 📖 资金单状态机 / 共享执行引擎 → [funds-orders.md](funds-orders.md)。本节只写充值切片。

充值资金单 = `depositTransactionId` 非空的 `funds_order`（Payin 表已并入）。虚拟币走 CRYPTO 状态机（含 CONFIRMING），法币出生即 `CONFIRMED`（跳过 CONFIRMING）→ CLEARED。**一笔充值可挂两个 funds_order**：`legSeq=1` 是 payin 本体；`legSeq=2`（仅没收执行时才建）是没收动腿（客户充值钱包→平台 F_FEE 钱包）——两者同挂 `depositTransactionId`，`funds-order.service.ts → directionOf()` 按父 FK 判 `direction`，两条腿都算 `IN`（`legSeq` 不影响 direction，只影响文档里描述的 payin/internal 分桶概念，该分桶现无中央投影代码消费，详见 [funds-orders.md](funds-orders.md) §2）。`handleFundsOrderChanged` 明确只处理 `legSeq===1` 事件，`legSeq>1` 由 `executeConfiscation` 自己驱动，不会误入 `onPayinConfirmed`/`onPayinFailed`。
- **锚点**：`funds-order-transitions.constant.ts → CRYPTO_IN_TRANSITIONS` ｜ `deposit-transactions.service.ts → detected()`（法币出生态 initialStatus）｜ `deposit-workflow.service.ts → handleFundsOrderChanged()`（`legSeq !== 1` 直接 return）

## 2. 充值订单（DepositTransaction）状态机

九态：`PAYIN_PENDING → COMPLIANCE_PENDING → SUCCESS`（happy）；异常态 `ACTION_PENDING / FROZEN / REJECTED / FAILED / EXPIRED`（转移路径已铺，见第 5 节）；治理终态 `CONFISCATED`（`COMPLIANCE_PENDING → CONFISCATED` 或 `FROZEN → CONFISCATED` 两条弧都落 CONFISCATED，见第 6 节）。

- **新增字段** `limitHoldReason`（nullable，现仅一个取值 `'BELOW_MIN'`）：L1 金额下限挂起标记，充值出生时由 `detected()` 落标，`clearLimitHold()`（PASS）清除
- **锚点**：`deposit-transactions.service.ts` 状态枚举 + `getNextStatus`（`CONFISCATED` 入 `TERMINAL` 集合）

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
  - **没收（Confiscate as Fee）**（`POST /deposit-transactions/:id/confiscate`，maker-checker，`OPS_OFFICER` 单步审批，理由必填）：`initiateConfiscation()` 只读校验 + 防重复（同 deposit 不可有两个 PENDING 没收审批）+ 开审批 case（`ApprovalActionTypes.DEPOSIT_CONFISCATION`，snapshot 含 T&C 依据），**不写 deposit 表**（Rule 5：workflow 不直接改状态）。审批 `APPROVED` 后 `onConfiscationDecided()`（监听 `workflow.deposit-confiscation.decided`）触发 `executeConfiscation()`：**先重新校验一遍 `status===COMPLIANCE_PENDING && limitHoldReason==='BELOW_MIN'`**（发起→裁决之间可能被并发 PASS 或 REJECT 漂移出可没收态；漂移则不记账不建单不改状态，只审计 `DEPOSIT_CONFISCATION_FAILED`），通过则先记两腿账、成功后才把状态推 `CONFISCATED`（先账后状态）
- **锚点**：`deposit-transactions.service.ts → detected()`（落标）/ `clearLimitHold()`（PASS 清标）｜ `deposit-workflow.service.ts → checkAutoApproval()`（挂起判定，先于 L2）/ `waiveLimitHold()`（PASS）/ `initiateConfiscation()`（没收发起）/ `onConfiscationDecided()`（裁决监听 + 漂移防护）/ `executeConfiscation()`（两腿记账 + 状态推进）｜ `deposit-confiscation-approval.service.ts`（`DepositConfiscationApprovalService`，V1 审批处理器绑定 `DEPOSIT_CONFISCATION` actionType）

## 6. 没收记账（两腿，均在 `asset.tbLedgerId` 内）

`executeConfiscation()` 落两条 TB 转账，先记账后状态（`先账后状态`）：

- **Leg1**（还原 Step1）：`DR DEPOSIT_SUSPENSE(CUSTOMER) / CR CLIENT_ASSET(SYSTEM)`——把已过 Step1 的暂扣清零，客户身份 Σ `CLIENT_ASSET` == Σ(`CLIENT_PAYABLE`+`DEPOSIT_SUSPENSE`) 两侧同减仍平。这条腿即 roadmap V4 ⚖️P0「已记账异常终态 TB 回退」的**第一块砖**（本轮只做了没收这一种异常终态的回退，REJECTED/FAILED/EXPIRED 仍无反向分录，见第 7 节）
- **Leg2**（确认手续费收入）：`DR FIRM_ASSET(SYSTEM) / CR FIRM_FEE(SYSTEM)`——公司身份 `FIRM_ASSET` == Σ(`FIRM_OPS`+`FIRM_SET`+`FIRM_FEE`+`FIRM_LIQ`) 两侧同加仍平
- **TB 转账码**：`DEPOSIT_CONFISCATE_SUSPENSE_TO_ASSET` / `DEPOSIT_CONFISCATE_FIRM_FEE`；两腿 `isExternalCrossing: false`（托管内重分类，非外部穿越，不产生对账 BREAK）
- **legSeq=2 funds_order**：`executeConfiscation()` 建一个 `depositTransactionId` 挂靠、`legSeq=2` 的 funds_order（客户充值钱包 → 平台 `F_FEE` 钱包，出生态 CONFIRMED 后立即推进 CLEARED），作为该没收动作的按钱包对账锚点；幂等（复跑找已存在的 legSeq=2 单）
- **验证**：`verify:coa` 全恒等 PASS（FIRM +50 AED 手续费收入）
- **锚点**：`deposit-workflow.service.ts → executeConfiscation()`｜ `tb-transfer-codes.constant.ts → DEPOSIT_CONFISCATE_SUSPENSE_TO_ASSET/DEPOSIT_CONFISCATE_FIRM_FEE`

## 7. 异常分支现状（骨架已铺，闭环缺失）

| 分支 | 状态态 | 转移路径 | 记账回退 | MLRO 门 |
|---|---|---|---|---|
| ACTION_PENDING 补材料 | ✅ | ✅ COMPLIANCE↔ACTION_PENDING（RESUME）| 无需 | — |
| FROZEN 制裁 | ✅ | L1 入口自动冻结 ✅；APPROVE/CONFISCATE 路径在 | ❌ 无 | ❌ 无 |
| REJECTED | ✅ | ✅ 转移在 | ❌ **无反向分录** | — |
| Payin FAILED | ✅ | ✅ `onPayinFailed` | ❌ **无反向分录** | — |
| EXPIRED | ✅ | ✅ ACTION_PENDING→EXPIRED | ❌ **无反向分录** | — |
| BELOW_MIN 没收 | ✅ | ✅ COMPLIANCE_PENDING/FROZEN→CONFISCATED | ✅ 两腿反向+确认收入（见第 6 节）| ✅ OPS_OFFICER maker-checker |
| 法币名义不符 | ❌ | 无（`InboundTransferSignal` 无 `senderName` 字段）| — | — |
| 法币银行退汇 bounce | ❌ | 无（无 bounce 字段/入口）| — | — |
| KYT FAILED | ⚠️ | **死胡同**：不转 FROZEN 不转终态，永挂 COMPLIANCE_PENDING | — | — |

- 🔴 **半截桥风险（缩小但未消除）**：`adminReject`/`adminFreeze` 端点已上线，但 deposit 模块对 REJECTED/FAILED/EXPIRED **仍零回退分录代码**——已过 Step1 的充值被拒 → 钱永久滞留 DEPOSIT_SUSPENSE。本轮**只给 BELOW_MIN 没收一条路径**补上了反向分录（第 6 节 Leg1），其余异常终态仍是半截桥。临时守卫卡片 task_16af8187（见 BACKLOG）。
- **CONFISCATE 新增了治理化正门，但旧侧门未关**：本轮新增的 `POST :id/confiscate` 走 `initiateConfiscation → 审批 → onConfiscationDecided → executeConfiscation` 治理链（两腿记账落地才推状态）；但 `PATCH :id/status` 的 `default` 分支对 `action='confiscate'` **仍直调** `deposit-transactions.service.ts → updateStatus()`，只受 `ACCOUNTING_TERMINALS={SUCCESS}` 守卫（`DEPOSIT_APPROVE_WORKFLOW_ONLY`），不拦 CONFISCATE——`getNextStatus` 的 `COMPLIANCE_PENDING/FROZEN → CONFISCATED` 转移弧对 PATCH 和 workflow 内部调用一视同仁。即：admin 仍可用旧 PATCH 端点把状态直接拍成 `CONFISCATED`，**零记账、零审批、零 funds_order**——比 D7 之前更危险（此前 CONFISCATED 只是状态壳，现在它被记账语义绑定，裸拍会产生"状态已终态但两腿未入账"的账实不符）。此洞是既存技术债（见 BACKLOG"Admin PATCH deposit status 部分绕过 workflow"）的延伸，D9 未收口，仍待后续 PATCH 硬化
- **锚点**：`deposit-workflow.service.ts → runGate0()`（L1 冻结）｜ `deposit-transactions.controller.ts → updateStatus()`（PATCH 路由，仅 SUCCESS 被拦；CONFISCATE 治理正门是独立 `:id/confiscate` 端点，但 PATCH 侧门未关）｜ `deposit-transactions.service.ts → updateStatus()`（`DEPOSIT_APPROVE_WORKFLOW_ONLY` 守卫）

## 8. 支撑项（均 ✅ 存活）

事件驱动编排（Payin/funds_order 事件 → DepositWorkflowService）｜ KYT/TR 模拟端点 ｜ Admin Deposit 列表/详情（含 BELOW MIN 徽章 + PASS/Confiscate 处置按钮）｜ Client 三 Tab（Crypto/Fiat/History）+ QR + VIBAN ｜ **Tipping-off 映射**（FROZEN/ACTION_PENDING/COMPLIANCE_PENDING 对客户统一显示 `Processing`，`Deposit.tsx getCustomerFacingStatus`；BELOW_MIN 挂起走服务端隐藏而非文案映射，见第 5 节）｜ Overview 余额读 TB。

## 9. 已确认技术债（详见 BACKLOG.md）

txHash 唯一约束仅在信号层（Deposit/资金单层缺）｜ TB 记账失败仅记 `DEPOSIT_ACCOUNTING_BLOCKED` 审计后卡住、无 repair surface ｜ `deposit.status.changed` 用 `emit` 非 `emitAsync`（异常不传播）｜ PATCH 仅 SUCCESS 被守卫（FREEZE **和** CONFISCATE 仍可绕——CONFISCATE 虽新增了独立治理端点，PATCH 侧门本身未关，详见第 7 节）｜ ERC-20 合约失败未过滤 ｜ KYT 超时转人工未做 ｜ 区块重组自动回退未做 ｜ 原路退回 / below-min 计次自动冻结 / 自动没收 cron 均 deferred（见 BACKLOG）。
