# 重构计划：Deposit Workflow Orchestrator (编排器优化)

我将重写 `DepositWorkflowService`，将其定位为纯粹的“胶水层”，严格按照编排逻辑串联物理资金流与业务交易流。

## **1. 基础设施准备**

* **幂等性检查**: 在 `DepositWorkflowService` 中实现 `isProcessed(entityId, eventType)` 辅助方法。利用数据库的审计日志表（或新增任务表）确保同一动作只触发一次。

* **后缀计算**: 实现 `getSuffix(payin)` 方法，逻辑为：若 `payin.type === 'fiat'` 或其关联资产的 `assetClass === 'FIAT'`，则后缀为 `FIAT`；否则为 `CRYPTO`。

## **2. 实现 PayIn 监听逻辑 (`payin.status.changed`)**

* **Case: DETECTED**

  * 检查并创建对应的 `DepositTransaction`（若不存在）。

  * 调用 `DepositTransactionsService` 将状态设为 `PAYIN_PENDING`。

* **Case: FAILED**

  * 调用 `DepositTransactionsService` 将状态设为 `REJECTED`（注：Deposit 状态机中无 FAILED，对应终局为 REJECTED）。

* **Case: CONFIRMED**

  * 调用 `DepositTransactionsService` 将状态设为 `COMPLIANCE_PENDING`。

  * 发送事件 `EVT_DEPOSIT_CONFIRMED__{suffix}`。

  * **记账**: 若 `deposit.ownerType === 'CUSTOMER'`，调用 `JournalsService` 记账。

  * **回推**: 在上述动作成功后，调用 `PayinsService.updateStatus` 将 PayIn 设为 `CLEARED`。

## **3. 实现 Deposit 监听逻辑 (`deposit.status.changed`)**

* **Case: SUCCESS**

  * 发送事件 `EVT_DEPOSIT_SUCCESS__{suffix}`。

  * **记账**: 若 `deposit.ownerType === 'CUSTOMER'`，调用 `JournalsService` 记账。

    <br />

## **4. 约束检查与验证**

* **禁止跨域**: 确保 `PayInsService` 和 `DepositTransactionsService` 的代码中没有任何互相调用的逻辑（之前已清理，本次重点在 Workflow 层）。

* **审计日志**: 每次编排动作完成后，记录 `updated_payin_status`、`updated_deposit_status`、`emitted_events` 及 `journal_entry_ids` 到审计日志。

**请确认以上编排逻辑，确认后我将开始代码实现。**
