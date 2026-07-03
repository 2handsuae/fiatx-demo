# V4 充值流程 — 当前实现真相

Last Verified: 2026-07-03（核对方式：三路 subagent 逐条 file:line 走查 + 主线复核回退分录/守卫）

> 本文只描述"现在是什么样"。改代码必须同步本文。计划看 roadmap，欠账看 BACKLOG.md。

---

## 1. 充值资金单（funds_orders 充值切片）

充值资金单 = `depositTransactionId` 非空的 `funds_order`（Payin 表已并入 funds_orders）。

- **虚拟币状态机**：`SUBMITTED → CONFIRMING → CONFIRMED → CLEARED`
- **法币状态机**：出生即 `CONFIRMED`（跳过 CONFIRMING），→ `CLEARED`
- **锚点**：`funds-order-transitions.constant.ts:42-55` ｜ `deposit-transactions.service.ts:473-475`（法币出生态）

## 2. 充值订单（DepositTransaction）状态机

八态：`PAYIN_PENDING → COMPLIANCE_PENDING → SUCCESS`（happy）；异常态 `ACTION_PENDING / FROZEN / REJECTED / FAILED / EXPIRED`（转移路径已铺，见第 5 节）。

- **锚点**：`deposit-transactions.service.ts` 状态枚举 + `getNextStatus`

## 3. Happy Path（双链路，均 ✅ 验证）

**虚拟币**：链上到账 → 资金单 CONFIRMED → **TB Step1**（`CLIENT_ASSET → DEPOSIT_SUSPENSE`）→ Deposit COMPLIANCE_PENDING → **L1 资格门** → **L2 交易筛查**（kyt + TR 双状态）→ 自动审批 → **TB Step2**（`DEPOSIT_SUSPENSE → CLIENT_PAYABLE`）→ SUCCESS。

**法币**：VIBAN 到账（`InboundTransferSignal` 信号入口）→ 资金单出生即 CONFIRMED（无确认阶段）→ Step1 → L1 → L2（KYT；**TR 硬写 NOT_REQUIRED**）→ Step2 → SUCCESS。

- **TB 两步借贷**（实时 1:1 后新 COA，旧 CUSTODY/BANK 已改）：Step1 `CLIENT_ASSET(1) → DEPOSIT_SUSPENSE(101)`；Step2 `DEPOSIT_SUSPENSE(101) → CLIENT_PAYABLE(100)`
- **L1 时点**：在**信号创建时**即调 `onboardingService.assertTradingEligibility(customerId, 'DEPOSIT')`（比"生成 Deposit 后"更前置）
- **L2 收敛**：`kytStatus === 'PASSED'` 且 `travelRuleStatus ∈ {PASSED, NOT_REQUIRED}` 才自动审批
- **锚点**：`deposit-workflow.service.ts:173-210`（自动审批）｜ `:479-556`（两步记账）｜ `inbound-transfer-signals.service.ts:118`（L1）

## 4. 合规门字段与分发

- **字段**：Deposit 表 `kytStatus`（PENDING→PASSED/FAILED）+ `travelRuleRequired` + `travelRuleStatus`（PENDING→PASSED/FAILED/NOT_REQUIRED），法币 TR 初值 NOT_REQUIRED
- **分发**：KYT/TR 模拟端点 `POST /admin/sumsub/simulate/kyt-check` + `tr-check` 走 Sumsub ingest 同一管道；真实 Sumsub webhook 对 Deposit-KYT/TR 的消费链路**未见部署**（当前靠模拟端点驱动）
- **锚点**：`admin-sumsub-simulation.controller.ts:325-419` ｜ `sumsub-ingestion.service.ts:115-127`

## 5. 异常分支现状（骨架已铺，闭环缺失）

| 分支 | 状态态 | 转移路径 | 记账回退 | MLRO 门 |
|---|---|---|---|---|
| ACTION_PENDING 补材料 | ✅ | ✅ COMPLIANCE↔ACTION_PENDING（RESUME）| 无需 | — |
| FROZEN 制裁 | ✅ | L1 入口自动冻结 ✅；APPROVE/CONFISCATE 路径在 | ❌ 无 | ❌ 无 |
| REJECTED | ✅ | ✅ 转移在 | ❌ **无反向分录** | — |
| Payin FAILED | ✅ | ✅ `onPayinFailed` | ❌ **无反向分录** | — |
| EXPIRED | ✅ | ✅ ACTION_PENDING→EXPIRED | ❌ **无反向分录** | — |
| 法币名义不符 | ❌ | 无（`InboundTransferSignal` 无 `senderName` 字段）| — | — |
| 法币银行退汇 bounce | ❌ | 无（无 bounce 字段/入口）| — | — |
| KYT FAILED | ⚠️ | **死胡同**：不转 FROZEN 不转终态，永挂 COMPLIANCE_PENDING | — | — |

- 🔴 **半截桥风险**：`adminReject`/`adminFreeze` 端点已上线，但 deposit 模块**零回退分录代码**（全仓 grep reverse/void/rollback 为空）——已过 Step1 的充值被拒 → 钱永久滞留 DEPOSIT_SUSPENSE。临时守卫卡片 task_16af8187（见 BACKLOG）。
- **CONFISCATE** 走 PATCH default 分支直改状态，绕过 workflow 与记账。
- **锚点**：`deposit-workflow.service.ts:92-129`（L1 冻结）｜ `deposit-transactions.controller.ts:100-128`（PATCH 守卫，仅 SUCCESS 被拦）｜ `deposit-transactions.service.ts:212-221`

## 6. 支撑项（均 ✅ 存活）

事件驱动编排（Payin/funds_order 事件 → DepositWorkflowService）｜ KYT/TR 模拟端点 ｜ Admin Deposit 列表/详情 ｜ Client 三 Tab（Crypto/Fiat/History）+ QR + VIBAN ｜ **Tipping-off 映射**（FROZEN/ACTION_PENDING/COMPLIANCE_PENDING 对客户统一显示 `Processing`，`Deposit.tsx getCustomerFacingStatus`）｜ Overview 余额读 TB。

## 7. 已确认技术债（详见 BACKLOG.md）

txHash 唯一约束仅在信号层（Deposit/资金单层缺）｜ TB 记账失败仅记 `DEPOSIT_ACCOUNTING_BLOCKED` 审计后卡住、无 repair surface ｜ `deposit.status.changed` 用 `emit` 非 `emitAsync`（异常不传播）｜ PATCH 仅 SUCCESS 被守卫（FREEZE/CONFISCATE 可绕）｜ ERC-20 合约失败未过滤 ｜ KYT 超时转人工未做 ｜ 区块重组自动回退未做。
