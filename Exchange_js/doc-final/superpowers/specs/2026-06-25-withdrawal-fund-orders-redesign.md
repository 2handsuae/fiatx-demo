# 提现资金单重设计 + 订单统一展示 Linked Funds Orders

> 2026-06-25 · 分支 funds-realtime-1to1 · 续 swap 编排之后的资金单口径统一

## 背景 / 现状（已核实）

实时 1:1 模型下，虚拟币提现当前产生三样东西：

| 东西 | 是什么 | 记账 |
|---|---|---|
| **Payout**（本金） | 对外打款单，netAmount | `WITHDRAW_NET_PENDING`(请求锁) → `WITHDRAW_NET_POST`(付款确认)：DR CLIENT_PAYABLE / CR CLIENT_ASSET |
| **FUND_OUT InternalFund**（C_MAIN→C_OUT） | 旧"预归集跟踪单"，走 internal-transfer/白名单 | **无**（`onFundsFlowStatusChanged` 已 neuter，空挂着） |
| **手续费** | 仅 TB 记账，**无资金单** | 客户侧 `WITHDRAW_FEE_PENDING→POST`(DR CLIENT_PAYABLE/CR CLIENT_ASSET) + 公司侧 `WITHDRAW_FEE_FIRM`(DR FIRM_ASSET/CR FIRM_FEE) |

- 充值：payin（入金本金）经入金侦测创建→deposit 从 payin 派生；**无** C_DEP→C_MAIN 跟踪单、`feeAmount` 恒 0（**充值无手续费**）。
- 提现/充值详情页都是「Linked Funds Order(旧死卡，旧 InternalTransaction)」+ 单独「Linked Payout / Linked Payin」两张卡并存。

## 目标（用户口径）

1. 虚拟币提现**不再创建 C_MAIN→C_OUT 资金单**（删 FUND_OUT）。
2. 一个提现 = **1 个 Payout(本金) + 1 个 InternalFund(手续费)**。手续费变成可见资金单。
3. payin / payout / internalfund 都是「资金单」，在订单详情里**统一展示在 Linked Funds Orders** 下（提现=payout+fee fund；充值=payin；swap=4 腿，已完成）。

## 关键决策

- **手续费资金单 = 表示层，跟随提现自动**（用户选）：**进 PAYOUT_PENDING 时与 payout 一起创建（不在请求时建）**=CREATED → 付款确认=CLEAR → 作废=CANCELLED，**记账完全不变**（仍由 withdraw 流做 FEE_PENDING/POST/FIRM；请求时只锁 TB fee pending）。不手动推进、不做两阶段。与 Payout（同在 PAYOUT_PENDING 创建、记账由 withdraw 流做）对称。compliance/approval 阶段被拒的提现压根不产生资金单。
- **直挂提现**：给 `InternalFund` 加 `withdrawTransactionId`（迁移），跟当初 `swapTransactionId` 一样，不走 InternalTransaction。
- 删 FUND_OUT **账目安全**（它无记账）；本金链上数据(blockNo/gas)详情页改从 Payout 取（Payout 存 txHash/gasUsed/effectiveGasPrice/confirmations）。
- 充值无手续费、无跟踪单 → 充值仅做**展示统一**（Linked Funds Orders 列 payin）。

## 任务

1. **Schema**：`InternalFund.withdrawTransactionId String?` + `withdrawTransaction WithdrawTransaction? @relation("WithdrawInternalFunds")` + `@@index`；`WithdrawTransaction.internalFunds InternalFund[] @relation("WithdrawInternalFunds")`。迁移（加列，nullable，安全）。
2. **FundsFlowService**：`createWithdrawFeeFund({withdrawTransactionId,assetId,amount,...})`（仿 createSwapLeg，status CREATED）+ `setWithdrawFeeFundStatus(withdrawTransactionId,status)`（直接置 CLEAR/CANCELLED + 审计，非 transition map）；`findOneByNoForAdmin` include `withdrawTransaction{withdrawNo,status}`。
3. **withdraw-transactions.service.ts**：`findOne` 返回统一 `linkedFundOrders=[{kind:PAYOUT,...},{kind:INTERNAL_FUND,...}]`，去掉旧 `fundsOrders`。（请求锁费块只锁 TB fee pending，**不**建 fund——见任务 4 时序修正。）
4. **withdraw-workflow.service.ts**：删 `fundOut(...)` + 去掉 `FundTransferWorkflowService` 注入（fundReturn 仍由 repair 控制器用，service 保留）；**`initiatePayoutPhase`（进 PAYOUT_PENDING）payout 创建后、feeAmount>0 时建手续费资金单**（与 payout 同时，不在请求时建）；`finalizeWithdrawal` 费 POST 后置手续费资金单 CLEAR；`voidWithdrawPending` 置 CANCELLED。
5. **deposit-transactions.service.ts**：`findOne` 返回统一 `linkedFundOrders=[{kind:PAYIN,...}]`。
6. **前端**：WithdrawTransactionDetail（合并两卡→Linked Funds Orders 列 payout+fee fund；链上字段取 payout）、DepositTransactionDetail（合并→列 payin）、InternalFundDetailPage（认 withdrawTransaction 归属：显示所属提现+不给 simulate）。
7. **验收**：跑一笔 crypto 提现到 SUCCESS → 无 FUND_OUT、1 payout + 1 fee fund(CLEAR)、详情统一展示、`verify:coa` PASS；充值详情列 payin。

## 不做（deferred）

- 充值手续费资金单（充值目前无手续费）。
- 手续费资金单的手动推进/两阶段（按表示层处理）。
- 旧 FUND_OUT / internal-transfer-workflow 死码彻底删除（Phase C 统一清）。
