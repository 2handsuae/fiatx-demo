# 资金单（funds_orders）— 当前实现真相（跨版本共享域）

Last Verified: 2026-07-04（核对方式：符号级 grep + V4-V8 体检交叉佐证）

> 本文只描述"现在是什么样"。改代码必须同步本文。**跨版本共享域**：被 V4(充值)/V5(提现)/V6(兑换)/V8(对账) 引用——资金单状态机与执行引擎的唯一真相。各版本文档只描述"自己怎么用资金单"，状态机与共享 service 链到此。

---

## 0. 一句话定位

一笔真实资金移动（链上 tx / 银行指令）的执行单。**Round 2（2026-07-02）三合一**：payin/payout/internal_funds 七张旧表 rename 合并成**唯一一张 `funds_orders`**（payin/payout/outstanding/fee_accrual/settlement_batch/internal_transaction 全 DROP）。本文管：状态机、共享 service、三视图投影。**不**管：各交易流何时创建/推进资金单（去 v4/v5/v6）。

## 1. 状态机（`funds-order.dto.ts` + `funds-order-transitions.constant.ts`）

- **状态** `FundsOrderStatus`：`CREATED → SUBMITTED → CONFIRMING → CONFIRMED → CLEARED`（happy）；终态旁支 `FAILED / TIMEOUT`
- **动作** `FundsOrderAction`：`SUBMIT / OBSERVE_CONFIRMING / CONFIRM / CLEAR / FAIL / TIMEOUT`（逐步推进，不跳步）
- **crypto vs fiat**：`CRYPTO_TRANSITIONS`（签名→广播→确认→CLEAR，走 CONFIRMING）｜ `FIAT_TRANSITIONS`（银行 SUBMIT→CONFIRM→CLEAR，**跳过 CONFIRMING**），按 `asset.type` 选
- **direction** `IN / OUT / INTERNAL`；**assetType** `CRYPTO / FIAT`
- 锚点：`dto/funds-order.dto.ts → FundsOrderStatus/FundsOrderAction` ｜ `constants/funds-order-transitions.constant.ts → CRYPTO_TRANSITIONS/FIAT_TRANSITIONS`

## 2. 数据模型要点

- **父 FK 决定视角**：`depositTransactionId`（充值）｜ `withdrawTransactionId`（提现）｜ `swapTransactionId`（swap 腿）；`legSeq` 区分多腿
- **三视图投影**（对账消费，`funds-order-source.repo.ts`）：payin = depositTransactionId≠null ｜ payout = withdrawTransactionId≠null 且 legSeq=1 ｜ internal = swapTransactionId≠null 或 (withdrawTransactionId≠null 且 legSeq>1)
- **各交易流的腿结构**：充值=1 payin ｜ 提现=1 payout(本金)+1 fee(legSeq>1) ｜ swap=4 腿(legSeq 1-4) ｜ 字段 `txHash`/`referenceNo`/`effectiveDate`/`amount`/`fromWalletId`/`toWalletId`
- ⚠️ `InternalFundAuditLog` 关系在（`FundsOrder.auditLogs`），前端详情页渲染，但 Round 2 后**零写入方**（见 BACKLOG）
- 锚点：prisma `FundsOrder` ｜ `clearing-settle/reconciliation/data-source/funds-order-source.repo.ts`（三视图投影）

## 3. 关键流程（共享执行引擎，`funds-order.service.ts`）

- **创建**：`create(CreateFundsOrderInput)`（挂父 FK + legSeq，初态按 asset.type）
- **推进**：`advance(id, action, operatorId, tx?, opts?)` — 逐步状态机推进 + 记账（调 `AccountingService`）；`opts.effectiveDate` **平账回填透传口**（→ writeEvidence → account_flows）；`advanceByNo(fundsOrderNo, ...)` 按业务键
- **查询**：`findById`/`findByNo`/`findByParent`/`findAllForAdmin`；**`findNonTerminalByWallet(walletId)`** — V8 对账在途识别（非终态资金单 ↔ 孤儿外部行配对）
- **CLEAR 时记账**：充值两步 / 提现 post+fee / swap 四腿两阶段——具体记账口径见 accounting-coa.md
- 锚点：`funds-orders/funds-order.service.ts → create()/advance()/advanceByNo()/findNonTerminalByWallet()` ｜ admin `funds-orders.admin.controller.ts`（列表/详情 + ⚡模拟推进 + 推单）

## 4. ⚠️ 已知缺口（详见 BACKLOG.md）

- **InternalFund 命名债**：swap 腿等操作 funds_orders，但类/枚举/RBAC 权限（`INTERNAL_FUND_READ`）+ 审计实体仍用 rename 前旧名，应统一 `FUNDS_ORDER_*`
- **Deposit/资金单层无 txHash 唯一约束**（仅信号层 dedupeKey 有）→ 同 txHash 可能多单
- **推单/sim-advance 端点用 _READ 权限门控变更操作**（应新增写/处置权限）
- swap 腿推单排除（通用推单不接 swap，走 Swap 详情页 advanceLeg 但无 effectiveDate 回填）

## 5. 锚点汇总

`funds-orders/`：`funds-order.service.ts`（执行引擎主）｜ `dto/funds-order.dto.ts`（状态/动作枚举）｜ `constants/funds-order-transitions.constant.ts`（crypto/fiat 状态机）｜ `funds-orders.admin.controller.ts`（admin + 推单）
消费方投影：`clearing-settle/reconciliation/data-source/funds-order-source.repo.ts`（三视图）
记账口径：见 [accounting-coa.md](accounting-coa.md)
